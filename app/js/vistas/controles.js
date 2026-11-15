// Controles que comparten varias pantallas. Cada uno se actualiza en el lugar
// (con `.actualizar(valor)`), así un toque no pierde el foco por repintar.

import { h, icono } from '../dom.js';
import { porcionesTexto } from '../formato.js';
import { armarLista, cuantasPorComprar } from '../compras.js';
import { cuantasFilas, resumenBandeja } from '../datos.js';
import { COMIDAS, diaCorto, diaYMes, diasDe, hoyIso, lunesDe, nuevaEntrada, platosQueFaltan, sumarDias, textoDia } from '../plan.js';
import { nuevaEdicion } from '../ediciones.js';

/**
 * Un <dialog> que se cierra al tocar afuera (en el fondo oscuro), como las hojas inferiores: con
 * `closedby="any"` donde existe y, si no (Safari), a mano, solo si el toque empieza y termina afuera.
 */
export function tocarAfueraCierra(dialogo) {
  dialogo.setAttribute('closedby', 'any');
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const afuera = e => {
      const r = dialogo.getBoundingClientRect();
      return e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
    };
    let empezoAfuera = false;
    dialogo.addEventListener('pointerdown', e => { empezoAfuera = afuera(e); });
    dialogo.addEventListener('pointerup', e => {
      if (empezoAfuera && afuera(e)) dialogo.close();
      empezoAfuera = false;
    });
  }
  return dialogo;
}

/**
 * Elegir el día de una semana (o «Sin día») y, si hay día, la comida: «Mover» en la semana y «Elegir día
 * y comida». Devuelve { el, valor() → { fecha, comida }, enfocar(), cambiarSemana(semana) }; al cambiar
 * de semana conserva el mismo día de la semana (el jueves sigue siendo jueves).
 */
export function elegirDia(semana, fecha = '', comida = 'cena') {
  let actual = { semana, fecha: diasDe(semana).includes(fecha) ? fecha : '', comida: comida || 'cena' };
  const comidas = segmentado('Comida', COMIDAS, actual.comida, v => { actual.comida = v; }, 'chico');
  const dias = h('div', { class: 'opciones-dias', role: 'group', 'aria-label': 'Día' });
  function pintar() {
    const opciones = [''].concat(diasDe(actual.semana));
    dias.replaceChildren(...opciones.map(f => h('button', { type: 'button', class: 'opcion-lugar opcion-dia',
      'aria-pressed': String(f === actual.fecha), 'aria-label': f ? textoDia(f) : 'Sin día', onclick: () => {
        actual.fecha = f;
        dias.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(opciones[i] === f)));
        comidas.hidden = !f;
      } }, f ? diaCorto(f) : 'Sin día')));
    comidas.hidden = !actual.fecha;
  }
  pintar();
  return {
    el: h('div', { class: 'elegir-dia' }, dias, comidas),
    valor: () => ({ fecha: actual.fecha, comida: actual.fecha ? actual.comida : '' }),
    enfocar: () => (dias.querySelector('[aria-pressed="true"]') || dias.querySelector('button')).focus(),
    cambiarSemana(nueva) {
      const i = diasDe(actual.semana).indexOf(actual.fecha);
      actual = Object.assign({}, actual, { semana: nueva, fecha: i >= 0 ? diasDe(nueva)[i] : '' });
      pintar();
    },
  };
}

/**
 * «Sumar a la semana» (SPEC_v2 §4.1), desde la ficha y desde las tarjetas de la Biblioteca: una hoja
 * con «Esta semana» y «La que viene» que pone la receta en «Sin día» (con `porciones`, o sin número
 * si la receta no las dice). `conElegir`: también «Elegir día y comida» (la ficha). Al cerrar, el foco
 * vuelve a donde estaba.
 */
export function sumarALaSemana({ app, editar, avisar }, receta, { porciones = null, conElegir = false } = {}) {
  const previo = document.activeElement;
  const hoy = hoyIso();
  const esta = lunesDe(hoy);
  const queViene = sumarDias(esta, 7);
  // El domingo (cuando suelen planificar) la principal es «La que viene»: «Esta semana» termina ese día.
  const domingo = sumarDias(esta, 6) === hoy;
  const botonSemana = (semana, principal) => h('button', { type: 'button', class: principal ? 'boton-principal' : 'boton-secundario',
    onclick: () => poner(semana) }, (semana === esta ? 'Esta semana' : 'La que viene') + ' (del ' + diaYMes(semana) + ')');
  const poner = semana => {
    editar(nuevaEdicion('plan.poner', { quien: app.config.quien,
      items: [nuevaEntrada({ semana, receta_id: receta.id, porciones })] }));
    dialogo.close();
    avisar('✓ En Sin día de ' + (semana === esta ? 'esta semana' : 'la que viene') + '.', { texto: 'Ver', href: '#/semana/' + semana });
  };
  const dialogo = tocarAfueraCierra(h('dialog', { class: 'hoja', 'aria-labelledby': 'titulo-sumar' },
    h('h2', { id: 'titulo-sumar' }, 'Sumar ' + receta.titulo),
    h('p', { class: 'secundario' }, 'Queda en «Sin día»: después la repartís en la semana.'),
    h('div', { class: 'hoja-botones' },
      domingo ? [botonSemana(queViene, true), botonSemana(esta, false)] : [botonSemana(esta, true), botonSemana(queViene, false)],
      conElegir ? h('a', { class: 'boton-texto', href: '#/semana/poner/' + receta.id, onclick: () => dialogo.close() }, icono('calendario', 18), 'Elegir día y comida') : null,
      h('button', { type: 'button', class: 'boton-texto', onclick: () => dialogo.close() }, 'Cancelar'))));
  dialogo.addEventListener('close', () => {
    dialogo.remove();
    if (previo && previo.isConnected && !location.hash.startsWith('#/semana/poner/')) previo.focus();
  });
  document.body.append(dialogo);
  dialogo.showModal();
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
 * Navegación inferior (§7.2 y SPEC_v2 §4.1): Recetas · Semana · Compras · Bandeja, con cuántos
 * platos faltan cocinar esta semana, cuántas cosas faltan comprar y cuántos links necesitan ayuda.
 * `.actualizar()` repinta los números.
 */
export function navegacion(activa, app) {
  const secciones = [
    { id: 'biblioteca', href: '#/', nombre: 'Recetas', icono: 'recetas' },
    { id: 'semana', href: '#/semana', nombre: 'Semana', icono: 'calendario' },
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
    const platos = app.datos ? platosQueFaltan(app.datos.plan, hoyIso()) : 0;
    const numeros = {
      semana: [platos, platos === 1 ? '1 plato por cocinar' : platos + ' platos por cocinar'],
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
