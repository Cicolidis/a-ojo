// Lista de compras (§7.2): en qué lugar se compra cada cosa, qué se agrega de una
// receta, cómo se juntan las mismas cosas de varias recetas y el texto para
// WhatsApp. Puro, sin DOM.

import { capitalizar, formatearCantidad, formatearNumero } from './formato.js';
import { normalizar } from './datos.js';
import { escalar, porcionesBase, rolDe } from './ingredientes.js';

// Los lugares, en el orden en que aparecen en la lista (igual que ENUMS.lugar en la API).
export const LUGARES = ['supermercado', 'verdulería', 'carnicería', 'panadería', 'almacenata', 'dietética', 'feria'];
// Pseudo-lugar: «Revisá si tenés». Ahí van los condimentos y los utensilios, salvo que los muevan.
export const REVISAR = 'revisar';
// Los tipos de producto (la góndola de cada ingrediente), en el orden en que se recorren.
export const TIPOS = ['verdulería', 'almacén', 'lácteos y huevos', 'carnicería', 'panadería', 'congelados', 'otros'];
const POR_DEFECTO = 'supermercado';
const A_REVISAR = ['condimento', 'utensilio'];

export function nombreLugar(lugar) {
  return lugar === REVISAR ? 'Revisá si tenés' : capitalizar(lugar);
}

/** Cómo se comparan los ingredientes de la hoja Lugares: sin tildes, en minúsculas y sin espacios de más (igual que la API). */
export function claveIngrediente(nombre) {
  return normalizar(nombre).replace(/\s+/g, ' ').trim();
}

const palabras = nombre => claveIngrediente(nombre).split(' ').filter(Boolean);

/** La misma palabra en singular o plural: huevo/huevos, limón/limones. */
function mismaPalabra(a, b) {
  return a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
}

/** ¿Es el mismo ingrediente? Sin tildes ni mayúsculas, y tolerante a plurales simples. */
export function mismoNombre(a, b) {
  const x = palabras(a);
  const y = palabras(b);
  return x.length > 0 && x.length === y.length && x.every((p, i) => mismaPalabra(p, y[i]));
}

/** ¿El nombre empieza con las palabras de la regla? «yogur» vale para «yogur griego». */
function empiezaCon(nombre, clave) {
  const x = palabras(nombre);
  const y = palabras(clave);
  return y.length > 0 && y.length <= x.length && y.every((p, i) => mismaPalabra(p, x[i]));
}

/** La regla de la hoja Lugares de ese ingrediente justo (no de uno que lo contenga), o null. */
export function reglaIngrediente(nombre, lugares) {
  return (lugares || []).find(r => r.por === 'ingrediente' && mismoNombre(r.clave, nombre)) || null;
}

/**
 * Dónde se compra según las reglas de la hoja Lugares: la del ingrediente (la más
 * larga que coincida: «yogur griego» le gana a «yogur»), la de su tipo o, si no
 * hay, el supermercado.
 */
export function lugarPorRegla(item, lugares) {
  let mejor = null;
  for (const r of lugares || []) {
    if (r.por !== 'ingrediente' || !LUGARES.includes(r.lugar) || !empiezaCon(item.nombre, r.clave)) continue;
    const n = palabras(r.clave).length;
    if (!mejor || n > mejor.n) mejor = { n, lugar: r.lugar };
  }
  if (mejor) return mejor.lugar;
  const tipo = (lugares || []).find(r => r.por === 'tipo' && r.clave === item.gondola && LUGARES.includes(r.lugar));
  return tipo ? tipo.lugar : POR_DEFECTO;
}

/** Dónde va un ítem de la lista: adonde lo movieron, «Revisá si tenés» (condimentos y utensilios) o el de la regla. */
export function lugarDe(item, lugares) {
  if (item.lugar === REVISAR || LUGARES.includes(item.lugar)) return item.lugar;
  if (A_REVISAR.includes(item.rol)) return REVISAR;
  return lugarPorRegla(item, lugares);
}

/** ¿El ingrediente va directo a «Revisá si tenés» al agregar la receta? */
export function vaARevisar(ingrediente) {
  return A_REVISAR.includes(rolDe(ingrediente));
}

/** Lo que arranca marcado en «Agregar a compras»: los principales (los opcionales, no). */
export function elegidosIniciales(receta) {
  return new Set(receta.ingredientes.filter(i => rolDe(i) === 'principal').map(i => i.id));
}

/**
 * Los ítems de compras.agregar para una receta: lo elegido para comprar más los
 * condimentos y utensilios (que van a «Revisá si tenés»), con las cantidades para
 * `porciones`. `elegidos` es un Set de ids de ingredientes; `nuevoId()` da un id c_….
 */
export function itemsDeReceta(receta, porciones, elegidos, nuevoId) {
  const base = porcionesBase(receta);
  const factor = base && porciones > 0 ? porciones / base : 1;
  return receta.ingredientes
    .filter(i => vaARevisar(i) || elegidos.has(i.id))
    .map(i => {
      const unidad = i.unidad || 'a ojo';
      const n = Number(escalar(i.cantidad, unidad, factor));
      return {
        id: nuevoId(),
        nombre: i.nombre,
        cantidad: unidad !== 'a ojo' && n > 0 ? n : null,
        unidad,
        gondola: i.gondola || '',
        rol: rolDe(i),
      };
    });
}

/** Las recetas que están en la lista: [{ receta_id, porciones, ids }], en el orden en que se agregaron. */
export function recetasEnLista(compras) {
  const mapa = new Map();
  for (const c of compras || []) {
    if (!c.receta_id) continue;
    if (!mapa.has(c.receta_id)) mapa.set(c.receta_id, { receta_id: c.receta_id, porciones: c.porciones, ids: [] });
    mapa.get(c.receta_id).ids.push(c.id);
  }
  return [...mapa.values()];
}

// Unidades que se pueden sumar entre sí: a gramos y a mililitros.
const FAMILIAS = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000] };

/** «400 g», «1,2 kg», «6», «200 g + 1 taza». Lo «a ojo» no suma; si todo es «a ojo», vacío. */
export function sumarCantidades(items) {
  const totales = new Map();
  for (const it of items) {
    const n = Number(it.cantidad);
    if (it.unidad === 'a ojo' || !(n > 0)) continue;
    const [unidad, factor] = FAMILIAS[it.unidad] || [it.unidad || 'u', 1];
    totales.set(unidad, (totales.get(unidad) || 0) + n * factor);
  }
  return [...totales].map(([unidad, n]) => {
    if ((unidad === 'g' || unidad === 'ml') && n >= 1000) {
      return formatearNumero(n / 1000, { fracciones: false }) + (unidad === 'g' ? ' kg' : ' l');
    }
    const metrica = unidad === 'g' || unidad === 'ml';
    return formatearCantidad(metrica && n >= 10 ? Math.round(n) : n, unidad);
  }).join(' + ');
}

/** «(3 + 1)» si la fila junta dos o más cantidades; con la unidad en cada una si no es la misma. */
function desglose(items) {
  const con = items.filter(i => i.unidad !== 'a ojo' && Number(i.cantidad) > 0);
  if (con.length < 2) return '';
  const unidad = con[0].unidad;
  const misma = con.every(i => i.unidad === unidad);
  return '(' + con.map(i => (misma
    ? formatearNumero(Number(i.cantidad), { fracciones: unidad !== 'g' && unidad !== 'ml' })
    : formatearCantidad(i.cantidad, i.unidad))).join(' + ') + ')';
}

const ordenTipo = g => (TIPOS.includes(g) ? TIPOS.indexOf(g) : TIPOS.length);

/**
 * La lista para mostrar: [{ lugar, nombre, filas }], con los lugares en el orden de
 * LUGARES y «Revisá si tenés» al final. Cada fila junta los ítems con el mismo
 * nombre en ese lugar: { clave, nombre, cantidad, desglose, ids, hecho, opcional, items }.
 * Lo de «Revisá si tenés» que ya está para comprar se suma a esa fila. Dentro de
 * cada lugar, las filas van por tipo de producto y nombre (lo marcado no se mueve).
 */
export function armarLista(compras, lugares) {
  const conLugar = (compras || []).map(c => ({ c, lugar: lugarDe(c, lugares) }));
  const orden = conLugar.filter(x => x.lugar !== REVISAR).concat(conLugar.filter(x => x.lugar === REVISAR));
  const grupos = new Map();
  const todas = [];
  for (const { c, lugar } of orden) {
    const donde = lugar === REVISAR ? todas : grupos.get(lugar) || [];
    let fila = donde.find(f => mismoNombre(f.nombre, c.nombre));
    if (!fila) {
      fila = { nombre: capitalizar(c.nombre), items: [] };
      if (!grupos.has(lugar)) grupos.set(lugar, []);
      grupos.get(lugar).push(fila);
      todas.push(fila);
    }
    fila.items.push(c);
  }
  return [...LUGARES, REVISAR].filter(l => grupos.has(l)).map(l => ({
    lugar: l,
    nombre: nombreLugar(l),
    filas: grupos.get(l).map(f => {
      const gondola = (f.items.find(i => i.gondola) || {}).gondola || '';
      const cantidad = sumarCantidades(f.items);
      const partes = desglose(f.items);
      return {
        clave: f.items[0].id,
        nombre: f.nombre,
        cantidad,
        // Si no se sumó nada (200 g + 1 cda), el desglose diría lo mismo.
        desglose: partes === '(' + cantidad + ')' ? '' : partes,
        ids: f.items.map(i => i.id),
        hecho: f.items.every(i => i.hecho === true || i.hecho === 'true'),
        opcional: f.items.every(i => i.rol === 'opcional'),
        gondola,
        items: f.items,
      };
    }).sort((a, b) => ordenTipo(a.gondola) - ordenTipo(b.gondola) || a.nombre.localeCompare(b.nombre, 'es')),
  }));
}

/** Cuántas filas quedan por comprar (sin contar «Revisá si tenés»). */
export function cuantasPorComprar(grupos) {
  return grupos.filter(g => g.lugar !== REVISAR).reduce((n, g) => n + g.filas.filter(f => !f.hecho).length, 0);
}

/** El texto para WhatsApp: un título por lugar con lo que falta, y al final «Revisá si tenés». Vacío si no falta nada. */
export function textoWhatsApp(grupos) {
  return grupos.map(g => {
    const filas = g.filas.filter(f => !f.hecho);
    if (!filas.length) return '';
    return '*' + g.nombre + '*\n' + filas.map(f => '- ' + f.nombre + (f.cantidad ? ': ' + f.cantidad : '')).join('\n');
  }).filter(Boolean).join('\n\n');
}
