// Controles que comparten varias pantallas. Cada uno se actualiza en el lugar
// (con `.actualizar(valor)`), así un toque no pierde el foco por repintar.

import { h, icono } from '../dom.js';
import { porcionesTexto } from '../formato.js';
import { armarLista, cuantasPorComprar } from '../compras.js';
import { cuantasFilas, resumenBandeja } from '../datos.js';

/** Un <dialog> que se cierra al tocar afuera (en el fondo oscuro), como las hojas inferiores. */
export function tocarAfueraCierra(dialogo) {
  dialogo.addEventListener('click', e => {
    const r = dialogo.getBoundingClientRect();
    const afuera = e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
    if (e.target === dialogo && afuera) dialogo.close();
  });
  return dialogo;
}

/**
 * En lugar del confirm del navegador: una hoja inferior con el estilo de la app. Devuelve una
 * promesa con true si eligen `si`. Tocar afuera, Esc o `no` es false. El foco
 * arranca en `no` (lo que no pierde nada) y, al cerrar, vuelve a donde estaba.
 */
export function confirmar({ titulo, texto, si, no = 'Cancelar' }) {
  const previo = document.activeElement;
  return new Promise(resolver => {
    let respuesta = false;
    const dialogo = h('dialog', { class: 'hoja', 'aria-labelledby': 'titulo-confirmar',
      'aria-describedby': texto ? 'texto-confirmar' : null },
      h('h2', { id: 'titulo-confirmar' }, titulo),
      texto ? h('p', { id: 'texto-confirmar', class: 'secundario' }, texto) : null,
      h('div', { class: 'hoja-botones' },
        h('button', { type: 'button', class: 'boton-principal', onclick: () => { respuesta = true; dialogo.close(); } }, si),
        h('button', { type: 'button', class: 'boton-secundario', autofocus: true, onclick: () => dialogo.close() }, no)));
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (previo && previo.isConnected) previo.focus();
      resolver(respuesta);
    });
    document.body.append(tocarAfueraCierra(dialogo));
    dialogo.showModal();
  });
}

/**
 * Selector segmentado: opciones [{ valor, nombre }], con la elegida marcada.
 * `alElegir(valor)` se llama al tocar otra opción.
 */
export function segmentado(etiqueta, opciones, elegido, alElegir, clase = '') {
  let actual = elegido;
  const botones = opciones.map(o => h('button', {
    type: 'button',
    onclick: () => {
      if (o.valor === actual) return;
      el.actualizar(o.valor);
      alElegir(o.valor);
    },
  }, o.nombre));
  const el = h('div', { class: ('segmentado ' + clase).trim(), role: 'group', 'aria-label': etiqueta }, botones);
  el.actualizar = valor => {
    actual = valor;
    botones.forEach((b, i) => b.setAttribute('aria-pressed', String(opciones[i].valor === valor)));
  };
  el.actualizar(elegido);
  return el;
}

/**
 * Valoración de 0 a 5: tocar una estrella la elige y tocar la elegida la borra.
 * Cada botón dice lo que hace («Poner 4 estrellas», «Sacar la valoración») y el grupo, el valor.
 */
export function estrellas(valor, alElegir, etiqueta = 'Valoración') {
  let actual = valor;
  const botones = [1, 2, 3, 4, 5].map(n => h('button', {
    type: 'button',
    onclick: () => {
      el.actualizar(n === actual ? 0 : n, true);
      alElegir(actual);
    },
  }, icono('estrella', 30)));
  const el = h('div', { class: 'estrellas', role: 'group' }, botones);
  el.actualizar = (v, tocada = false) => {
    actual = v;
    el.setAttribute('aria-label', etiqueta + ': ' + (v ? v + ' de 5' : 'sin valorar'));
    botones.forEach((b, i) => {
      const n = i + 1;
      b.classList.toggle('llena', i < v);
      b.setAttribute('aria-label', n === v ? 'Sacar la valoración' : 'Poner ' + (n === 1 ? '1 estrella' : n + ' estrellas'));
    });
    if (tocada && v) rebotar(botones[v - 1]);
  };
  el.actualizar(valor);
  return el;
}

/** Vuelve a correr la animación «rebota» de un elemento (CSS la apaga si piden menos movimiento). */
function rebotar(el) {
  el.classList.remove('rebota');
  void el.offsetWidth;
  el.classList.add('rebota');
}

/**
 * −/+ para elegir porciones, con el número en el medio. `alCambiar(n)` se llama con el nuevo número.
 * En los límites los botones quedan con aria-disabled (no disabled), así el foco no se pierde.
 */
export function contadorPorciones(valor, alCambiar, max = 99) {
  let actual = valor;
  const texto = h('span', { class: 'porciones-n', 'aria-live': 'polite' });
  const menos = h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Menos porciones',
    onclick: () => cambiar(actual - 1) }, icono('menos', 18));
  const mas = h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Más porciones',
    onclick: () => cambiar(actual + 1) }, icono('mas', 18));
  const el = h('div', { class: 'porciones-control' }, menos, texto, mas);
  function pintar() {
    texto.textContent = porcionesTexto(actual);
    menos.setAttribute('aria-disabled', String(actual <= 1));
    mas.setAttribute('aria-disabled', String(actual >= max));
  }
  function cambiar(n) {
    n = Math.min(Math.max(n, 1), max);
    if (n === actual) return;
    actual = n;
    pintar();
    alCambiar(actual);
  }
  pintar();
  return el;
}

/**
 * Navegación inferior (§7.2): Recetas · Compras · Bandeja, con cuántas cosas
 * faltan comprar y cuántos links necesitan ayuda. `.actualizar()` repinta los números.
 */
export function navegacion(activa, app) {
  const secciones = [
    { id: 'biblioteca', href: '#/', nombre: 'Recetas', icono: 'recetas' },
    { id: 'compras', href: '#/compras', nombre: 'Compras', icono: 'compras' },
    { id: 'bandeja', href: '#/bandeja', nombre: 'Bandeja', icono: 'bandeja' },
  ].map(s => {
    const cuenta = h('span', { class: 'nav-cuenta', 'aria-hidden': 'true', hidden: true });
    const lector = h('span', { class: 'solo-lector' });
    const link = h('a', { href: s.href, class: 'nav-item', 'aria-current': s.id === activa ? 'page' : null },
      h('span', { class: 'nav-icono' }, icono(s.icono, 24), cuenta), h('span', null, s.nombre), lector);
    return Object.assign(s, { link, cuenta, lector });
  });
  const el = h('nav', { class: 'navegacion', 'aria-label': 'Secciones' }, secciones.map(s => s.link));
  el.actualizar = () => {
    const comprar = app.datos ? cuantasPorComprar(armarLista(app.datos.compras, app.datos.lugares, app.datos.despensa)) : 0;
    const resumen = resumenBandeja(app.datos?.bandeja);
    const ayuda = resumen.ayuda;
    const numeros = {
      compras: [comprar, comprar === 1 ? '1 cosa por comprar' : comprar + ' cosas por comprar'],
      bandeja: [ayuda, cuantasFilas(ayuda, resumen.propiasAyuda) + (ayuda === 1 ? ' necesita ayuda' : ' necesitan ayuda')],
    };
    secciones.forEach(s => {
      const [n, texto] = numeros[s.id] || [0, ''];
      s.cuenta.hidden = !n;
      s.cuenta.textContent = n > 99 ? '99+' : String(n);
      s.lector.textContent = n ? ' (' + texto + ')' : '';
    });
  };
  el.actualizar();
  return el;
}

/**
 * Estado vacío: un ícono de trazo, un título corto, una explicación y, si hace falta,
 * acciones ([{ texto, href } o { texto, onclick }]). Con `h1`, el título es el de la pantalla.
 */
export function vacio({ figura, titulo, texto, acciones = [], h1 = false }) {
  return h('div', { class: 'vacio' },
    icono(figura, 40),
    h(h1 ? 'h1' : 'p', { class: 'vacio-titulo', tabindex: h1 ? '-1' : null }, titulo),
    texto ? h('p', { class: 'vacio-texto' }, texto) : null,
    acciones.length ? h('div', { class: 'vacio-acciones' }, acciones.map(a => (a.href
      ? h('a', { class: 'boton-secundario boton-chico', href: a.href }, a.texto)
      : h('button', { type: 'button', class: 'boton-secundario boton-chico', onclick: a.onclick }, a.texto)))) : null);
}

/** Primera carga, sin nada guardado: el logo, que respira, y qué se está bajando. */
export function cargando(texto) {
  return h('div', { class: 'cargando', role: 'status' },
    h('img', { class: 'cargando-logo', src: 'iconos/icono-192.png', alt: '', width: '72', height: '72' }),
    h('p', null, texto));
}

/**
 * Lo que muestran la ficha, el modo cocina, «Agregar a compras» y el editor cuando
 * no pueden mostrar la receta `id`: el logo mientras baja la primera sincronización,
 * lo que le falta a la receta para esa pantalla (`falta`: { titulo, texto }), con la
 * vuelta a la ficha, o «No encontramos esta receta».
 */
export function sinReceta(app, id, falta) {
  let contenido;
  if (!app.datos && app.sync.estado === 'sincronizando') {
    contenido = cargando('Bajando las recetas…');
  } else if (falta) {
    contenido = vacio({ figura: 'recetas', h1: true, titulo: falta.titulo, texto: falta.texto,
      acciones: [{ texto: 'Volver a la receta', href: '#/receta/' + id }] });
  } else {
    contenido = vacio({ figura: 'buscar', h1: true, titulo: 'No encontramos esta receta',
      texto: app.datos ? 'Puede que la hayan sacado de la planilla.' : 'Todavía no se bajaron las recetas.',
      acciones: [{ texto: 'Ir a las recetas', href: '#/' }] });
  }
  return h('div', { class: 'centrada' }, contenido);
}

/** Comparte un texto (en Android abre el selector, con WhatsApp) o, si no se puede, abre WhatsApp Web. */
export async function compartirTexto(texto) {
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
