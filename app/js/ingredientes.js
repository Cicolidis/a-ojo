// Ingredientes en la ficha: cómo se agrupan por sección y rol, cómo se escalan
// las cantidades y qué vistas de porciones tiene cada receta. Puro, sin DOM.

import { capitalizar, formatearCantidad } from './formato.js';

export const ROLES = ['principal', 'condimento', 'opcional', 'utensilio'];
export const NOMBRES_ROL = { principal: 'Principal', condimento: 'Condimento', opcional: 'Opcional', utensilio: 'Utensilio' };

// En seccion_usuario: sacaron el ingrediente de la sección que le puso /recetas (igual que en la API).
export const SIN_SECCION = '-';
const MAX_VISTAS = 6;

/** Rol con el que se muestra: el que eligieron ellos o el de /recetas. Las recetas viejas, sin rol, son principales. */
export function rolDe(ing) {
  const rol = ing.rol_usuario || ing.rol;
  return ROLES.includes(rol) ? rol : 'principal';
}

/** Sección con la que se muestra: la que eligieron ellos o la de /recetas («» si no tiene). */
export function seccionDe(ing) {
  if (ing.seccion_usuario === SIN_SECCION) return '';
  return String(ing.seccion_usuario || ing.seccion || '').trim();
}

/** Lo que se guarda en rol_usuario: vacío si coincide con el rol de /recetas. */
export function rolUsuario(elegido, original) {
  return elegido === (original || 'principal') ? '' : elegido;
}

/** Lo que se guarda en seccion_usuario: vacío si coincide con la de /recetas, SIN_SECCION si la sacaron. */
export function seccionUsuario(elegida, original) {
  return elegida === (original || '') ? '' : elegida || SIN_SECCION;
}

/**
 * Ingredientes de la ficha: por sección, en el orden en que aparecen, y dentro
 * de cada una por rol, sin perder el orden de uso. Los utensilios van aparte.
 * Devuelve { secciones: [{ nombre, principales, condimentos, opcionales }], utensilios }.
 * Lo que no tiene sección va primero; si hay una sola sección, va sin nombre (sin título).
 */
export function agrupar(ingredientes) {
  const secciones = new Map();
  const utensilios = [];
  for (const ing of ingredientes || []) {
    const rol = rolDe(ing);
    if (rol === 'utensilio') {
      utensilios.push(ing);
      continue;
    }
    const nombre = seccionDe(ing);
    if (!secciones.has(nombre)) secciones.set(nombre, { nombre, principales: [], condimentos: [], opcionales: [] });
    const s = secciones.get(nombre);
    (rol === 'condimento' ? s.condimentos : rol === 'opcional' ? s.opcionales : s.principales).push(ing);
  }
  let lista = [...secciones.values()];
  lista = lista.filter(s => !s.nombre).concat(lista.filter(s => s.nombre));
  if (lista.length === 1) lista[0].nombre = '';
  return { secciones: lista, utensilios };
}

/** «a, b y c». */
export function unirConY(partes) {
  return partes.length < 2 ? partes.join('') : partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

/** Cantidad y nota de un ingrediente entre paréntesis, si tiene: «(1 cdita, tostado)». La cantidad «a ojo» no se dice. */
function detalle(ing, factor) {
  const cantidad = formatearCantidad(escalar(ing.cantidad, ing.unidad, factor), ing.unidad);
  const partes = [cantidad === 'a ojo' ? '' : cantidad, String(ing.nota || '').trim()].filter(Boolean);
  return partes.length ? ' (' + partes.join(', ') + ')' : '';
}

/** Los condimentos o los utensilios en una línea: «Sal, pimienta y comino (1 cdita)». */
export function enUnaLinea(ingredientes, factor = 1) {
  return capitalizar(unirConY(ingredientes.map(i => i.nombre + detalle(i, factor))));
}

const FRACCIONES = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];

/**
 * Cantidad para otra cantidad de porciones (`factor` = porciones nuevas / originales).
 * Las «a ojo» y las vacías no cambian. Redondea con sentido: gramos y mililitros
 * desde 10, a entero; kilos y litros, a dos decimales; el resto, al cuarto o al
 * tercio más cercano (nunca menos de ¼).
 */
export function escalar(cantidad, unidad, factor = 1) {
  const n = cantidad === null || cantidad === undefined || cantidad === '' ? NaN : Number(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0 || !(factor > 0) || factor === 1) return cantidad;
  const x = n * factor;
  if (unidad === 'g' || unidad === 'ml') return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
  if (unidad === 'kg' || unidad === 'l') return Math.round(x * 100) / 100;
  const entero = Math.floor(x);
  const resto = x - entero;
  const fraccion = FRACCIONES.reduce((a, b) => (Math.abs(b - resto) < Math.abs(a - resto) ? b : a));
  return Math.max(entero + fraccion, 1 / 4);
}

/** Porciones originales de la receta, o null si no las dice (entonces no se escala). */
export function porcionesBase(receta) {
  const n = Number(receta.porciones);
  return n > 0 ? n : null;
}

/** Vistas guardadas («12,3» → [12, 3]), la última usada primero. */
export function vistasDe(receta) {
  return String(receta.porciones_vistas || '').split(',')
    .map(s => Number(s.trim()))
    .filter((n, i, lista) => Number.isInteger(n) && n > 0 && lista.indexOf(n) === i);
}

/** Con cuántas porciones abre la ficha: la última vista usada o, si no hay, las de la receta. */
export function porcionesIniciales(receta) {
  const base = porcionesBase(receta);
  return base ? vistasDe(receta)[0] || base : null;
}

/** Chips de la ficha: la original y las vistas guardadas, de menor a mayor. */
export function chipsPorciones(receta) {
  const base = porcionesBase(receta);
  if (!base) return [];
  return [...new Set([base, ...vistasDe(receta)])].sort((a, b) => a - b).map(n => ({ n, original: n === base }));
}

/** Las vistas después de usar (o quitar) `n`, como las guarda la API: «12,3». */
export function nuevasVistas(textoVistas, n, quitar = false) {
  const vistas = vistasDe({ porciones_vistas: textoVistas }).filter(x => x !== Number(n));
  if (!quitar) vistas.unshift(Number(n));
  return vistas.slice(0, MAX_VISTAS).join(',');
}

/**
 * ¿Hay que guardar la vista al empezar a cocinar con `n` porciones? No si ya es la
 * última usada, ni si es la original y no hay otras (nada que recordar).
 */
export function hayQueGuardarVista(receta, n) {
  const base = porcionesBase(receta);
  const vistas = vistasDe(receta);
  if (!base || !(n > 0) || vistas[0] === n) return false;
  return n !== base || vistas.length > 0;
}
