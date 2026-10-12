// Controles que comparten varias pantallas. Cada uno se actualiza en el lugar
// (con `.actualizar(valor)`), así un toque no pierde el foco por repintar.

import { h, icono } from '../dom.js';

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
