// Lista de compras (#/compras): por lugar, con lo mismo de varias recetas sumado
// y «Revisá si tenés» al final. Marcar, mover, sumar y limpiar van por la cola
// (ediciones.js): se ven al instante y se mandan cuando hay conexión.

import { h, icono, rellenar } from '../dom.js';
import { LUGARES, REVISAR, armarLista, lugarPorRegla, nombreLugar, recetasEnLista, textoWhatsApp } from '../compras.js';
import { idAzar, nuevaEdicion } from '../ediciones.js';
import { navegacion } from './controles.js';

export function montar(contenedor, { app, editar }) {
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const zonaRecetas = h('div');
  const zonaLista = h('div', { class: 'compras-lista' });
  const zonaAcciones = h('div', { class: 'compras-acciones' });
  const dialogo = h('dialog', { class: 'hoja', 'aria-labelledby': 'titulo-mover',
    // Tocar afuera de la hoja (en el fondo oscuro) la cierra.
    onclick: e => {
      const r = dialogo.getBoundingClientRect();
      const afuera = e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
      if (e.target === dialogo && afuera) dialogo.close();
    } });
  const nav = navegacion('compras', app);

  // Sumar algo a mano. El formulario no se repinta nunca: no pierde lo escrito.
  const campo = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Sumar algo a la lista', placeholder: 'Sumar algo (ej.: servilletas)' });
  const sumar = h('form', { class: 'sumar', onsubmit: e => {
    e.preventDefault();
    const nombre = campo.value.trim();
    if (!nombre) return campo.focus();
    editar(nuevaEdicion('compras.agregar', { items: [{ id: idAzar('c'), nombre, unidad: 'a ojo', rol: 'principal' }] }));
    campo.value = '';
    pintar();
  } }, campo, h('button', { type: 'submit', class: 'boton-secundario boton-chico' }, icono('mas', 18), 'Sumar'));

  contenedor.append(h('div', { class: 'compras con-navegacion' },
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Compras'),
    sync,
    zonaRecetas,
    sumar,
    zonaLista,
    zonaAcciones,
    dialogo,
  ), nav);

  const lista = () => armarLista(app.datos?.compras, app.datos?.lugares);

  function marcar(fila, hecho) {
    editar(nuevaEdicion('compras.marcar', { ids: fila.ids, hecho }));
    pintar('c:' + fila.clave);
  }

  function mover(fila, lugar, siempre) {
    editar(nuevaEdicion('compras.mover', { ids: fila.ids, lugar }));
    if (siempre) editar(nuevaEdicion('lugares.asignar', { por: 'ingrediente', clave: fila.items[0].nombre, lugar }));
    pintar('m:' + fila.clave);
  }

  /** La hoja para mover una fila a otro lugar, con «Comprar siempre ahí». */
  function abrirMover(fila, actual) {
    const siempre = h('input', { type: 'checkbox' });
    const opcion = lugar => h('button', {
      type: 'button',
      class: 'opcion-lugar',
      'aria-pressed': String(lugar === actual),
      onclick: () => {
        dialogo.close();
        if (lugar !== actual || siempre.checked) mover(fila, lugar, siempre.checked && lugar !== REVISAR);
      },
    }, nombreLugar(lugar));
    rellenar(dialogo,
      h('h2', { id: 'titulo-mover' }, '¿Dónde comprás ' + fila.nombre.toLowerCase() + '?'),
      h('div', { class: 'opciones-lugar' }, LUGARES.map(opcion), opcion(REVISAR)),
      h('label', { class: 'casilla' }, siempre,
        h('span', { class: 'casilla-texto' }, 'Comprar siempre ' + fila.nombre.toLowerCase() + ' ahí')),
      h('button', { type: 'button', class: 'boton-secundario', onclick: () => dialogo.close() }, 'Cancelar'),
    );
    dialogo.showModal();
  }

  function fila(f, grupo) {
    const revisar = grupo.lugar === REVISAR;
    return h('li', { class: 'compra' + (f.hecho ? ' hecha' : '') + (f.opcional ? ' opcional' : '') },
      h('label', null,
        h('input', { type: 'checkbox', checked: f.hecho, 'data-foco': 'c:' + f.clave,
          'aria-label': (revisar ? 'Lo tengo: ' : 'Comprado: ') + f.nombre,
          onchange: e => marcar(f, e.target.checked) }),
        h('span', { class: 'compra-texto' },
          h('span', null, f.nombre, f.opcional ? h('span', { class: 'marca-opcional' }, 'opcional') : null),
          f.desglose ? h('span', { class: 'compra-desglose' }, f.desglose) : null),
        f.cantidad ? h('span', { class: 'cantidad' }, f.cantidad) : null),
      revisar
        ? h('button', { type: 'button', class: 'boton-texto', 'data-foco': 'm:' + f.clave, 'aria-label': 'Hay que comprar ' + f.nombre,
          onclick: () => mover(f, lugarPorRegla(f.items[0], app.datos.lugares), false) }, 'Comprar')
        : h('button', { type: 'button', class: 'boton-redondo', 'data-foco': 'm:' + f.clave, 'aria-label': 'Mover ' + f.nombre + ' a otro lugar',
          onclick: () => abrirMover(f, grupo.lugar) }, icono('mover', 20)),
    );
  }

  function pintarRecetas() {
    const recetas = recetasEnLista(app.datos?.compras);
    if (!recetas.length) return rellenar(zonaRecetas);
    rellenar(zonaRecetas, h('div', { class: 'compras-recetas' },
      h('h2', { class: 'etiqueta-seccion' }, recetas.length === 1 ? 'Receta' : 'Recetas'),
      h('ul', null, recetas.map(x => {
        const r = app.indice.porId.get(x.receta_id);
        const titulo = r ? r.titulo : 'Receta que ya no está';
        return h('li', null,
          h('a', { href: '#/compras/agregar/' + x.receta_id }, titulo,
            x.porciones ? h('span', { class: 'secundario' }, ' · ' + x.porciones + ' porciones') : null),
          h('button', { type: 'button', class: 'boton-texto', 'aria-label': 'Quitar ' + titulo + ' de la lista',
            onclick: () => {
              editar(nuevaEdicion('compras.quitar', { ids: x.ids }));
              pintar();
            } }, 'Quitar'));
      }))));
  }

  /** Repinta la lista y devuelve el foco al control equivalente (data-foco): el indicado o el que lo tenía. */
  function pintar(foco) {
    foco = foco || (document.activeElement && document.activeElement.getAttribute('data-foco'));
    const grupos = lista();
    pintarRecetas();
    if (!grupos.length) {
      rellenar(zonaLista, h('p', { class: 'vacio' }, !app.datos
        ? (app.sync.estado === 'sincronizando' ? 'Bajando la lista…' : 'Todavía no se bajó la lista.')
        : 'La lista está vacía. En una receta, tocá «Agregar a compras».'));
    } else {
      rellenar(zonaLista, grupos.map(g => h('section', { class: 'compras-grupo', 'aria-label': g.nombre },
        h('h2', { class: 'etiqueta-seccion' }, g.nombre),
        g.lugar === REVISAR ? h('p', { class: 'secundario' }, 'Tildá lo que ya tenés; si falta algo, tocá «Comprar».') : null,
        h('ul', { class: 'lista-compras' }, g.filas.map(f => fila(f, g))))));
    }

    const texto = textoWhatsApp(grupos);
    // Se limpian todos los ítems marcados; el número es el de filas tachadas, que es lo que se ve.
    const marcados = (app.datos?.compras || []).filter(c => c.hecho === true || c.hecho === 'true').map(c => c.id);
    const tachadas = grupos.reduce((n, g) => n + g.filas.filter(f => f.hecho).length, 0);
    rellenar(zonaAcciones,
      texto ? h('button', { type: 'button', class: 'boton-principal', onclick: () => mandar(texto) },
        icono('compartir', 20), 'Mandar por WhatsApp') : null,
      marcados.length ? h('button', { type: 'button', class: 'boton-secundario', onclick: () => {
        editar(nuevaEdicion('compras.quitar', { ids: marcados }));
        pintar();
      } }, 'Limpiar marcados' + (tachadas ? ' (' + tachadas + ')' : '')) : null,
      h('a', { class: 'boton-texto', href: '#/lugares' }, icono('mover', 18), 'Dónde compramos cada cosa'),
    );

    if (foco) {
      const el = contenedor.querySelector('[data-foco="' + foco + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  }

  function actualizar() {
    const pendientes = app.cola.length;
    sync.textContent = [
      app.sync.estado === 'sin_conexion' || app.sync.estado === 'error' ? app.sync.mensaje : '',
      pendientes === 1 ? '1 cambio sin mandar' : pendientes ? pendientes + ' cambios sin mandar' : '',
    ].filter(Boolean).join(' · ');
    sync.classList.toggle('error', app.sync.estado === 'error');
    nav.actualizar();
    // Con la hoja de mover abierta, lo que baja la sincronización espera a que se cierre.
    if (!dialogo.open) pintar();
  }

  actualizar();
  return {
    actualizar,
    desmontar() {
      if (dialogo.open) dialogo.close();
    },
  };
}

/** Comparte la lista (en Android abre el selector, con WhatsApp) o, si no se puede, abre WhatsApp Web. */
async function mandar(texto) {
  if (navigator.share) {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
}
