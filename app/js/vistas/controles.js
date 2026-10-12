// Controles que comparten varias pantallas. Cada uno se actualiza en el lugar
// (con `.actualizar(valor)`), así un toque no pierde el foco por repintar.

import { h, icono } from '../dom.js';
import { armarLista, cuantasPorComprar } from '../compras.js';
import { resumenBandeja } from '../datos.js';

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

/** Valoración de 0 a 5: tocar una estrella la elige y tocar la elegida la borra. */
export function estrellas(valor, alElegir, etiqueta = 'Valoración') {
  let actual = valor;
  const botones = [1, 2, 3, 4, 5].map(n => h('button', {
    type: 'button',
    'aria-label': n === 1 ? '1 estrella' : n + ' estrellas',
    onclick: () => {
      el.actualizar(n === actual ? 0 : n);
      alElegir(actual);
    },
  }, icono('estrella', 30)));
  const el = h('div', { class: 'estrellas', role: 'group', 'aria-label': etiqueta }, botones);
  el.actualizar = v => {
    actual = v;
    botones.forEach((b, i) => {
      b.classList.toggle('llena', i < v);
      b.setAttribute('aria-pressed', String(i + 1 === v));
    });
  };
  el.actualizar(valor);
  return el;
}

/** −/+ para elegir porciones, con el número en el medio. `alCambiar(n)` se llama con el nuevo número. */
export function contadorPorciones(valor, alCambiar, max = 99) {
  let actual = valor;
  const texto = h('span', { class: 'porciones-n', 'aria-live': 'polite' });
  const menos = h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Menos porciones',
    onclick: () => cambiar(actual - 1) }, icono('menos', 18));
  const mas = h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Más porciones',
    onclick: () => cambiar(actual + 1) }, icono('mas', 18));
  const el = h('div', { class: 'porciones-control' }, menos, texto, mas);
  function pintar() {
    texto.textContent = actual === 1 ? '1 porción' : actual + ' porciones';
    menos.disabled = actual <= 1;
    mas.disabled = actual >= max;
  }
  function cambiar(n) {
    actual = Math.min(Math.max(n, 1), max);
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
    const comprar = app.datos ? cuantasPorComprar(armarLista(app.datos.compras, app.datos.lugares)) : 0;
    const ayuda = resumenBandeja(app.datos?.bandeja).ayuda;
    const numeros = {
      compras: [comprar, comprar === 1 ? '1 cosa por comprar' : comprar + ' cosas por comprar'],
      bandeja: [ayuda, ayuda === 1 ? '1 link necesita ayuda' : ayuda + ' links necesitan ayuda'],
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
