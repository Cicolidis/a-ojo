// Plan semanal (SPEC_v2 §4): fechas, semanas, lo que se muestra de cada una y la cuenta de la pestaña.
// Puro, sin DOM.
//
// Las fechas son días del calendario del celular, como texto «2026-11-16» (sin hora ni zona). Nunca
// pasan por new Date(texto) ni por fechaCorta(): eso las lee como medianoche en UTC y, en Buenos
// Aires, da el día anterior. Se parte el texto y se calcula con Date.UTC.

import { idAzar } from './ediciones.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

export const COMIDAS = [{ valor: 'almuerzo', nombre: 'Almuerzo' }, { valor: 'cena', nombre: 'Cena' }];

/** «2026-11-16» → milisegundos de esa medianoche en UTC, o NaN si no es una fecha de verdad. */
function aMs(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ''));
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : NaN;
}

const aTexto = ms => new Date(ms).toISOString().slice(0, 10);

/** ¿Es un día del calendario («2026-11-16»)? */
export function esFecha(texto) {
  return !isNaN(aMs(texto));
}

/** Hoy, en el calendario del celular (la hora local, no la de UTC). */
export function hoyIso(ahora = new Date()) {
  return aTexto(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}

export function sumarDias(fecha, n) {
  return aTexto(aMs(fecha) + n * DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
function diaDeLaSemana(fecha) {
  return new Date(aMs(fecha)).getUTCDay();
}

/** El lunes de la semana de esa fecha (la semana va de lunes a domingo). */
export function lunesDe(fecha) {
  return sumarDias(fecha, -((diaDeLaSemana(fecha) + 6) % 7));
}

/** ¿Es el lunes de una semana? (Lo que se acepta en la dirección #/semana/…) */
export function esSemana(texto) {
  return esFecha(texto) && lunesDe(texto) === texto;
}

/** Los siete días de la semana, de lunes a domingo. */
export function diasDe(semana) {
  return [0, 1, 2, 3, 4, 5, 6].map(n => sumarDias(semana, n));
}

/** «16/11». */
export function diaYMes(fecha) {
  const ms = aMs(fecha);
  if (isNaN(ms)) return '';
  const d = new Date(ms);
  return d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
}

/** «Semana del 16/11». */
export function textoSemana(semana) {
  return 'Semana del ' + diaYMes(semana);
}

/** «Lunes 16». */
export function textoDia(fecha) {
  return DIAS[diaDeLaSemana(fecha)] + ' ' + new Date(aMs(fecha)).getUTCDate();
}

/** «Lu», «Ma»… (los botones de «Mover»). */
export function diaCorto(fecha) {
  return DIAS_CORTOS[diaDeLaSemana(fecha)];
}

/**
 * Lo que tiene una semana para mostrarla: { sinDia, dias: [{ fecha, almuerzo, cena }], total }.
 * Cada entrada lleva su `receta` del índice (null si ya no está), en el orden en que se pusieron
 * (un lote comparte `creado`: desempata el orden en la hoja).
 */
export function armarSemana(plan, semana, porId = new Map()) {
  const entradas = (plan || []).map((e, i) => ({ e, i }))
    .filter(x => x.e.semana === semana)
    .sort((a, b) => String(a.e.creado || '').localeCompare(String(b.e.creado || '')) || a.i - b.i)
    .map(x => Object.assign({}, x.e, { receta: porId.get(x.e.receta_id) || null }));
  const dias = diasDe(semana).map(fecha => ({
    fecha,
    almuerzo: entradas.filter(e => e.fecha === fecha && e.comida === 'almuerzo'),
    cena: entradas.filter(e => e.fecha === fecha && e.comida === 'cena'),
  }));
  const ubicadas = new Set(dias.flatMap(d => d.almuerzo.concat(d.cena)).map(e => e.id));
  // Sin día, o con un día o una comida que no corresponden (no debería pasar: la API los valida).
  return { sinDia: entradas.filter(e => !ubicadas.has(e.id)), dias, total: entradas.length };
}

/** La cuenta de la pestaña Semana: los platos de esta semana de hoy en adelante, más los de «Sin día». */
export function platosQueFaltan(plan, hoy) {
  const semana = lunesDe(hoy);
  return (plan || []).filter(e => e.semana === semana && (!e.fecha || e.fecha >= hoy)).length;
}

/** Una entrada nueva del plan, con su id (la API lo usa tal cual: un reintento no la duplica). */
export function nuevaEntrada({ semana, fecha = '', comida = '', receta_id, porciones = null }) {
  return { id: idAzar('s'), semana, fecha: fecha || '', comida: fecha ? comida : '', receta_id, porciones: porciones || null };
}

/**
 * La compra de la semana (SPEC_v2 §4.2): las recetas de los días que todavía no pasaron (desde `hoy`) y
 * las de «Sin día», en el orden de la semana, con las porciones sumadas si una receta está más de una
 * vez (si alguna entrada no tiene porciones, cuentan las que sí). Las que no tienen ingredientes van
 * aparte. Las entradas cuya receta ya no está se saltean. Devuelve { recetas: [{ receta, porciones }], sinIngredientes }.
 */
export function compraDeLaSemana(plan, semana, hoy, porId) {
  const orden = e => (e.fecha || '9999') + (e.comida === 'cena' ? '2' : '1');
  const juntas = new Map();
  (plan || [])
    .filter(e => e.semana === semana && (!e.fecha || e.fecha >= hoy) && porId.has(e.receta_id))
    .sort((a, b) => orden(a).localeCompare(orden(b)))
    .forEach(e => {
      const x = juntas.get(e.receta_id) || { receta: porId.get(e.receta_id), porciones: 0 };
      x.porciones += Number(e.porciones) || 0;
      juntas.set(e.receta_id, x);
    });
  const todas = [...juntas.values()].map(x => ({ receta: x.receta, porciones: x.porciones || null }));
  return {
    recetas: todas.filter(x => x.receta.ingredientes.length),
    sinIngredientes: todas.filter(x => !x.receta.ingredientes.length).map(x => x.receta),
  };
}

/** ¿Hay algo para comprar de esa semana, de hoy en adelante (o en «Sin día»)? */
export function hayCompra(plan, semana, hoy) {
  return (plan || []).some(e => e.semana === semana && (!e.fecha || e.fecha >= hoy)) && sumarDias(semana, 6) >= hoy;
}
