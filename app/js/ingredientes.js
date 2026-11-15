// Ingredientes en la ficha: cómo se agrupan por sección y rol, cómo se escalan
// las cantidades y qué vistas de porciones tiene cada receta. Puro, sin DOM.

import { capitalizar, formatearCantidad, formatearMinutos, formatearNumero, porcionesTexto } from './formato.js';

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
  const cantidad = textoCantidad(ing.cantidad, ing.unidad, factor);
  const partes = [cantidad === 'a ojo' ? '' : cantidad, String(ing.nota || '').trim()].filter(Boolean);
  return partes.length ? ' (' + partes.join(', ') + ')' : '';
}

/** Los condimentos o los utensilios en una línea: «Sal, pimienta y comino (1 cdita)». */
export function enUnaLinea(ingredientes, factor = 1) {
  return capitalizar(unirConY(ingredientes.map(i => i.nombre + detalle(i, factor))));
}

const FRACCIONES = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
const CASI = 1e-9; // para que 29,000000000000004 cuente como 29

/** Al cuarto o al tercio más cercano, nunca menos de `minimo`. */
function aGrilla(x, minimo = 1 / 4) {
  const entero = Math.floor(x);
  const resto = x - entero;
  const fraccion = FRACCIONES.reduce((a, b) => (Math.abs(b - resto) < Math.abs(a - resto) ? b : a));
  return Math.max(entero + fraccion, minimo);
}

/** Gramos y mililitros: a entero desde 10; si no, a un decimal. */
const aMetrico = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
const aMil = x => Math.round(x * 1000) / 1000;

function numeroDe(cantidad) {
  return cantidad === null || cantidad === undefined || cantidad === '' ? NaN : Number(cantidad);
}

/**
 * Cantidad para otra cantidad de porciones (`factor` = porciones nuevas / originales),
 * en la misma unidad. Las «a ojo» y las vacías no cambian. Redondea con sentido: gramos
 * y mililitros desde 10, a entero; kilos y litros, a tres decimales; el resto, al cuarto
 * o al tercio más cercano (nunca menos de ¼). Para mostrar, textoCantidad(); para la
 * lista de compras, paraComprar().
 */
export function escalar(cantidad, unidad, factor = 1) {
  const n = numeroDe(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0 || !(factor > 0) || factor === 1) return cantidad;
  const x = n * factor;
  if (unidad === 'g' || unidad === 'ml') return aMetrico(x);
  if (unidad === 'kg' || unidad === 'l') return aMil(x);
  return aGrilla(x);
}

// Familias de unidades (SPEC_v2 §7.1). La taza es la de /recetas al convertir cups: 240 ml.
export const ML_CUCHARAS = { cdita: 5, cda: 15, taza: 240 };
export const CONTABLES = ['u', 'diente', 'lata', 'paquete', 'ramo'];
const TAZA = ML_CUCHARAS.taza;
const CDA = ML_CUCHARAS.cda;

/** Familia de una unidad: 'peso', 'metrico' (ml, l), 'cucharas', 'contable', 'pizca' u otra cosa. */
export function familiaDe(unidad) {
  if (unidad === 'g' || unidad === 'kg') return 'peso';
  if (unidad === 'ml' || unidad === 'l') return 'metrico';
  if (ML_CUCHARAS[unidad]) return 'cucharas';
  if (CONTABLES.includes(unidad) || !unidad) return 'contable';
  return unidad;
}

/** La unidad de cucharas más cómoda para `ml` (sin pasar a ml). `eraTaza`: la receta decía tazas. */
function enCucharas(ml, eraTaza) {
  const elegir = x => {
    if (x >= TAZA - CASI) return ['taza', aGrilla(x / TAZA)];
    if (x >= 4 * CDA - CASI) {
      const t = aGrilla(x / TAZA);
      if (eraTaza || Math.abs(t * TAZA - x) <= 2.5) return ['taza', t];
      return ['cda', Math.round((x / CDA) * 2) / 2];
    }
    if (x >= CDA - CASI) return ['cda', aGrilla(x / CDA)];
    return ['cdita', aGrilla(x / ML_CUCHARAS.cdita)];
  };
  // Si el redondeo tocó un umbral (3,9 cdas → 4 cdas), se vuelve a elegir: «¼ taza».
  const [u1, n1] = elegir(ml);
  const [unidad, cantidad] = elegir(n1 * ML_CUCHARAS[u1]);
  return { cantidad, unidad };
}

/** Gramos o mililitros totales en la unidad cómoda: kilos o litros desde 1000. */
function enMetrico(x, chica, grande) {
  if (x >= 1000 - CASI) return { cantidad: aMil(x / 1000), unidad: grande };
  const n = aMetrico(x);
  return n >= 1000 ? { cantidad: 1, unidad: grande } : { cantidad: n, unidad: chica };
}

/**
 * Peso y volumen en la unidad más cómoda (SPEC_v2 §7.2), sin cambiar de familia:
 * 1500 g → 1 ½ kg, 0,5 kg → 500 g, 4 cdas → ¼ taza, ½ cda → 1 ½ cditas. Lo demás
 * queda como está. `eraTaza`: la receta original decía tazas (entonces no baja a
 * cdas mientras sea ¼ taza o más). Devuelve { cantidad, unidad }.
 */
export function acomodar(cantidad, unidad, { eraTaza = unidad === 'taza' } = {}) {
  const n = numeroDe(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0) return { cantidad, unidad };
  const familia = familiaDe(unidad);
  if (familia === 'peso') return enMetrico(unidad === 'kg' ? n * 1000 : n, 'g', 'kg');
  if (familia === 'metrico') return enMetrico(unidad === 'l' ? n * 1000 : n, 'ml', 'l');
  if (familia === 'cucharas') return enCucharas(n * ML_CUCHARAS[unidad], eraTaza);
  return { cantidad: n, unidad };
}

const esEntero = n => Math.abs(n - Math.round(n)) < CASI;

/**
 * Cantidad para otra cantidad de porciones, en la unidad más cómoda (SPEC_v2 §7.2).
 * Devuelve { cantidad, unidad, hasta? }: `hasta` es el segundo número de «7 u 8»,
 * cuando lo que se cuenta cae entre dos enteros. Con factor 1, «a ojo» o sin
 * cantidad, devuelve lo mismo.
 * - Contables: si la receta dice enteros (3 huevos), a enteros, nunca menos de 1;
 *   si dice medios (½ cebolla), a medios; si dice otra fracción (¼), al cuarto o al tercio.
 * - Pizca: sin escala; desde el doble, «2 pizcas».
 */
export function escalarCantidad(cantidad, unidad, factor = 1) {
  const n = numeroDe(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0 || !(factor > 0) || factor === 1) return { cantidad, unidad };
  const x = n * factor;
  const familia = familiaDe(unidad);
  if (familia === 'peso' || familia === 'metrico' || familia === 'cucharas') return acomodar(x, unidad);
  if (familia === 'pizca') return { cantidad: factor >= 2 && n < 2 ? 2 : n, unidad };
  if (familia === 'contable') {
    if (esEntero(n)) {
      if (x < 1) return { cantidad: 1, unidad };
      const piso = Math.floor(x + CASI);
      const resto = x - piso;
      if (resto > 0.25 && resto < 0.75) return { cantidad: piso, unidad, hasta: piso + 1 };
      return { cantidad: resto >= 0.75 ? piso + 1 : piso, unidad };
    }
    if (esEntero(n * 2)) return { cantidad: Math.max(Math.round(x * 2) / 2, 1 / 2), unidad };
  }
  return { cantidad: aGrilla(x), unidad };
}

/** «7 u 8»: «u» antes de los números que suenan con o (8, 11, 80–89, 800–899…). */
function oU(n) {
  return String(n).startsWith('8') || n === 11 ? ' u ' : ' o ';
}

/** La cantidad escalada lista para mostrar: «1 ½ cditas», «¼ taza», «7 u 8», «3 o 4 dientes», «a ojo». */
export function textoCantidad(cantidad, unidad, factor = 1) {
  const r = escalarCantidad(cantidad, unidad, factor);
  if (r.hasta) return formatearNumero(r.cantidad) + oU(r.hasta) + formatearCantidad(r.hasta, r.unidad);
  return formatearCantidad(r.cantidad, r.unidad);
}

/**
 * Lo que va a la lista de compras, en la unidad de la receta: como escalar(), pero
 * lo que se cuenta va para arriba (7,5 huevos → 8; los medios, al medio de arriba).
 */
export function paraComprar(cantidad, unidad, factor = 1) {
  const n = numeroDe(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0) return cantidad;
  const f = factor > 0 ? factor : 1;
  const familia = familiaDe(unidad);
  if (familia === 'pizca') return escalarCantidad(n, unidad, f).cantidad;
  if (familia === 'contable' && esEntero(n)) return Math.max(Math.ceil(n * f - CASI), 1);
  if (familia === 'contable' && esEntero(n * 2)) return Math.max(Math.ceil(n * f * 2 - CASI) / 2, 1 / 2);
  return escalar(cantidad, unidad, f);
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

/** Un ingrediente en el texto para compartir: «Chocolate semiamargo: 200 g (picado)». */
function lineaCompartir(ing, factor, opcional) {
  const cantidad = textoCantidad(ing.cantidad, ing.unidad, factor);
  const nota = [String(ing.nota || '').trim(), opcional ? 'opcional' : ''].filter(Boolean)
    .filter((x, i, xs) => xs.indexOf(x) === i).join(', ');
  return '- ' + capitalizar(ing.nombre) + (cantidad === 'a ojo' ? '' : ': ' + cantidad) + (nota ? ' (' + nota + ')' : '');
}

/**
 * La receta como texto para mandar por WhatsApp: título, porciones, tiempo y molde;
 * ingredientes por sección (con las cantidades para `porciones`), pasos numerados con
 * su tip, y el link al video. Con el formato de WhatsApp (*negrita*).
 */
export function textoReceta(receta, porciones) {
  const base = porcionesBase(receta);
  const n = porciones || base;
  const factor = base && n ? n / base : 1;
  const datos = [
    n ? 'Para ' + porcionesTexto(n) : '',
    receta.tiempo_min ? formatearMinutos(receta.tiempo_min) : '',
    receta.molde ? 'Molde ' + receta.molde : '',
  ].filter(Boolean).join(' · ');

  const { secciones, utensilios } = agrupar(receta.ingredientes);
  const ingredientes = secciones.map(s => [
    s.nombre ? '_' + s.nombre + '_' : '',
    ...s.principales.map(i => lineaCompartir(i, factor, false)),
    s.condimentos.length ? '- ' + enUnaLinea(s.condimentos, factor) : '',
    ...s.opcionales.map(i => lineaCompartir(i, factor, true)),
  ].filter(Boolean).join('\n'));
  if (utensilios.length) ingredientes.push('También vas a necesitar: ' + enUnaLinea(utensilios, factor).replace(/^./, c => c.toLowerCase()));

  const pasos = (receta.pasos || []).map((p, i) => (i + 1) + '. ' + String(p.texto || '').trim() +
    (String(p.tip || '').trim() ? '\n   ' + String(p.tip).trim() : ''));
  const fuente = /^https?:\/\//i.test(String(receta.fuente_url || '')) ? receta.fuente_url : '';

  return [
    '*' + String(receta.titulo || '').trim() + '*' + (datos ? '\n' + datos : ''),
    ingredientes.length ? '*Ingredientes*\n' + ingredientes.join('\n\n') : '',
    factor !== 1 ? 'Ojo: los pasos dicen las cantidades para ' + base + '.' : '',
    pasos.length ? '*Pasos*\n' + pasos.join('\n') : '',
    fuente ? (receta.autor ? 'De ' + String(receta.autor).trim() + ': ' : 'El video: ') + fuente : '',
  ].filter(Boolean).join('\n\n');
}
