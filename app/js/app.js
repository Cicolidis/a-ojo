// Arranque de A ojo: configuración, datos locales, rutas, ediciones y sincronización en segundo plano.

import { leerRuta } from './rutas.js';
import { leerConfig, guardarConfig, leerLinkConfig } from './config.js';
import { leer, guardar, borrar } from './db.js';
import { indexar } from './datos.js';
import { aplicarCola, aplicarEdicion } from './ediciones.js';
import { sincronizar, precargarFotos } from './sync.js';
import { h, rellenar } from './dom.js';
import * as biblioteca from './vistas/biblioteca.js';
import * as ficha from './vistas/ficha.js';
import * as cocina from './vistas/cocina.js';
import * as ingredientes from './vistas/ingredientes.js';
import * as agregar from './vistas/agregar.js';
import * as compras from './vistas/compras.js';
import * as lugares from './vistas/lugares.js';
import * as bandeja from './vistas/bandeja.js';
import * as elegir from './vistas/elegir.js';
import * as bienvenida from './vistas/bienvenida.js';

const CINCO_MIN_MS = 5 * 60 * 1000;
const REINTENTO_MS = 60 * 1000;
const contenedor = document.getElementById('app');

const app = {
  config: leerConfig(),
  datos: null,
  indice: indexar(null),
  // estado: inactivo · sincronizando · ok · sin_conexion · error
  sync: { estado: 'inactivo', mensaje: '' },
  ultimaSync: 0,
  // Ediciones que todavía no llegaron a la API (ver ediciones.js).
  cola: [],
  biblioteca: { texto: '', filtro: 'todas', scroll: 0 },
  // Porciones elegidas en cada ficha, mientras la app está abierta: id → número.
  porciones: new Map(),
};

let vista = null;
let recargarAlSalir = false;
let sincronizando = null;
let otraVez = false;
let reintento = null;

const mismaRuta = (a, b) => {
  const x = leerRuta(a);
  const y = leerRuta(b);
  return x.nombre === y.nombre && x.id === y.id;
};

/**
 * Vuelve a `destino`. Si se llegó desde ahí, con history.back() (así el botón
 * Atrás de Android queda coherente y la Biblioteca conserva el scroll); si no
 * (link directo o recarga), reemplazando la entrada actual.
 */
function volver(destino) {
  const desde = history.state && history.state.desde;
  if (desde !== undefined && mismaRuta(desde, destino)) history.back();
  else location.replace(destino);
}

/**
 * Va a `destino` en lugar de la pantalla actual, como si se hubiera llegado
 * desde `desde`: así su «volver» vuelve atrás en el historial hasta ahí.
 */
function reemplazar(destino, desde) {
  history.replaceState({ desde }, '', destino);
  mostrar({ enfocar: true });
}

function mostrar({ enfocar = false } = {}) {
  const ruta = leerRuta(location.hash);
  if (ruta.nombre === 'config') return configurar();
  if (recargarAlSalir && ruta.nombre !== 'cocina') return location.reload();

  if (vista && vista.desmontar) vista.desmontar();
  contenedor.replaceChildren();
  if (ruta.nombre !== 'biblioteca') window.scrollTo(0, 0);

  const ctx = { app, volver, reemplazar, editar, avisar, sincronizar: sincronizarAhora };
  if (!app.config) vista = bienvenida.montar(contenedor, ctx);
  else if (ruta.nombre === 'receta') vista = ficha.montar(contenedor, ctx, ruta.id);
  else if (ruta.nombre === 'cocina') vista = cocina.montar(contenedor, ctx, ruta.id);
  else if (ruta.nombre === 'ingredientes') vista = ingredientes.montar(contenedor, ctx, ruta.id);
  else if (ruta.nombre === 'agregar') vista = agregar.montar(contenedor, ctx, ruta.id);
  else if (ruta.nombre === 'compras') vista = compras.montar(contenedor, ctx);
  else if (ruta.nombre === 'elegir') vista = elegir.montar(contenedor, ctx);
  else if (ruta.nombre === 'lugares') vista = lugares.montar(contenedor, ctx);
  else if (ruta.nombre === 'bandeja') vista = bandeja.montar(contenedor, ctx);
  else vista = biblioteca.montar(contenedor, ctx);

  if (enfocar) {
    const titulo = contenedor.querySelector('h1, .paso-texto');
    if (titulo) titulo.focus({ preventScroll: true });
  }
}

/** Repinta lo que cambió por la sincronización, sin mover el scroll ni sacar a nadie del modo cocina. */
function refrescar() {
  if (vista && vista.actualizar) return vista.actualizar();
  if (vista && vista.enCocina) return;
  const y = window.scrollY;
  mostrar();
  window.scrollTo(0, y);
}

/**
 * Aplica una edición al instante (datos, índice y pantalla), la deja en la cola
 * y la manda cuando se pueda. Las vistas la arman con ediciones.js.
 */
function editar(edicion) {
  if (!app.datos) return;
  app.cola.push(edicion);
  app.datos = aplicarEdicion(app.datos, edicion);
  app.indice = indexar(app.datos);
  guardar('cola', app.cola).catch(err => console.warn('No se pudo guardar la cola:', err));
  guardar('datos', app.datos).catch(err => console.warn('No se pudieron guardar los datos:', err));
  sincronizarAhora();
}

// Avisos breves abajo de la pantalla (por ejemplo, una edición que la API rechazó).
// Pueden traer un link: avisar('✓ Agregada a compras', { texto: 'Ver la lista', href: '#/compras' }).
const zonaAviso = h('div', { class: 'aviso', role: 'status', hidden: true });
document.body.append(zonaAviso);
let ocultarAviso = null;

function avisar(texto, link) {
  const ocultar = () => { zonaAviso.hidden = true; };
  rellenar(zonaAviso, h('span', null, texto),
    link ? h('a', { href: link.href, onclick: ocultar }, link.texto) : null);
  zonaAviso.hidden = false;
  clearTimeout(ocultarAviso);
  ocultarAviso = setTimeout(ocultar, link ? 8000 : 6000);
}

/** Link de configuración: guarda, borra el token de la barra de direcciones y sincroniza. */
async function configurar() {
  const { config, error } = leerLinkConfig(location.hash);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (error) {
    if (vista && vista.desmontar) vista.desmontar();
    contenedor.replaceChildren();
    vista = bienvenida.montar(contenedor, { app }, error);
    return;
  }
  const otraApi = !app.config || app.config.api !== config.api;
  guardarConfig(config);
  app.config = config;
  if (otraApi) {
    app.datos = null;
    app.indice = indexar(null);
    app.ultimaSync = 0;
    app.cola = [];
    await borrar('datos').catch(() => {});
    await borrar('cola').catch(() => {});
  }
  mostrar();
  sincronizarAhora();
}

function sincronizarAhora() {
  if (!app.config) return null;
  // Una edición durante la sincronización: se vuelve a sincronizar al terminar.
  if (sincronizando) {
    otraVez = true;
    return sincronizando;
  }
  clearTimeout(reintento);
  const antes = app.sync.estado;
  app.sync = { estado: 'sincronizando', mensaje: '' };
  if (!app.datos) refrescar();
  sincronizando = sincronizar(app.config, app.datos, app.cola)
    .then(({ datos, cambios, descartadas, pendiente }) => {
      // Las ediciones que se hicieron mientras bajaba `todo` también se ven.
      app.datos = aplicarCola(datos, app.cola);
      app.ultimaSync = Date.now();
      app.sync = pendiente
        ? { estado: 'error', mensaje: 'No se pudieron mandar los cambios: ' + pendiente.message }
        : { estado: 'ok', mensaje: '' };
      if (cambios) app.indice = indexar(app.datos);
      descartadas.forEach(d => avisar('No se pudo guardar un cambio: ' + d.mensaje));
      if (cambios || pendiente || antes === 'sin_conexion' || antes === 'error') refrescar();
      precargarFotos(datos.recetas.map(r => r.foto_url)).catch(() => {});
    })
    .catch(err => {
      if (err.codigo === 'red') {
        app.sync = { estado: 'sin_conexion', mensaje: app.datos ? 'Sin conexión · mostrando lo guardado' : 'Sin conexión. Cuando vuelva, bajamos las recetas.' };
      } else if (err.codigo === 'token_invalido') {
        app.sync = { estado: 'error', mensaje: 'El token no es válido. Pedí un link de configuración nuevo.' };
      } else {
        app.sync = { estado: 'error', mensaje: err.message || 'No se pudo sincronizar.' };
      }
      refrescar();
    })
    .finally(() => {
      sincronizando = null;
      if (otraVez) {
        otraVez = false;
        sincronizarAhora();
      } else if (app.cola.length) {
        reintento = setTimeout(sincronizarAhora, REINTENTO_MS);
      }
    });
  return sincronizando;
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Con una versión nueva de la app se recarga, salvo en el modo cocina: ahí espera a que se salga.
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControlador) return;
    if (leerRuta(location.hash).nombre === 'cocina') recargarAlSalir = true;
    else location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('No se pudo registrar el service worker:', err));
}

async function arrancar() {
  registrarServiceWorker();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  window.addEventListener('hashchange', evento => {
    // Cada entrada del historial recuerda de qué pantalla se llegó (las que se
    // revisitan con Atrás ya lo tienen).
    if (!history.state || history.state.desde === undefined) {
      history.replaceState({ desde: new URL(evento.oldURL).hash }, '');
    }
    mostrar({ enfocar: true });
  });
  window.addEventListener('online', () => sincronizarAhora());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (app.cola.length || Date.now() - app.ultimaSync > CINCO_MIN_MS) sincronizarAhora();
  });

  if (leerRuta(location.hash).nombre === 'config') return configurar();
  if (app.config) {
    try {
      app.cola = (await leer('cola')) || [];
      // Lo que quedó sin mandar se ve igual, aunque la app se haya cerrado antes de guardar los datos.
      app.datos = aplicarCola((await leer('datos')) || null, app.cola);
    } catch (err) {
      console.warn('No se pudieron leer los datos guardados:', err);
    }
    app.indice = indexar(app.datos);
  }
  mostrar();
  sincronizarAhora();
}

arrancar();
