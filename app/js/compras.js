// Lista de compras (§7.2): en qué lugar se compra cada cosa, qué se agrega de una
// receta, cómo se juntan las mismas cosas de varias recetas y el texto para
// WhatsApp. Puro, sin DOM.

import { capitalizar, formatearCantidad, formatearNumero } from './formato.js';
import { alfabetico, normalizar } from './datos.js';
import { ML_CUCHARAS, acomodar, familiaDe, paraComprar, porcionesBase, rolDe } from './ingredientes.js';

// Los lugares, en el orden en que aparecen en la lista (igual que ENUMS.lugar en la API).
export const LUGARES = ['supermercado', 'verdulería', 'carnicería', 'panadería', 'almacenata', 'dietética', 'feria'];
// Pseudo-lugar: «Revisá si tenés». Ahí van los condimentos y los utensilios, salvo que los muevan.
export const REVISAR = 'revisar';
// Los tipos de producto (la góndola de cada ingrediente), en el orden de «Dónde compramos cada cosa».
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
export function empiezaCon(nombre, clave) {
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

// La despensa (SPEC_v2 §5). Para leer («En casa», «¿Se terminó algo?») vale lo que empieza
// igual, como las reglas de Lugares: «yogur» en la despensa vale para «yogur griego». Para
// escribir (sumar, sacar), el nombre entero (mismoNombre): «harina» no tapa «harina de garbanzos».

/** La fila de la despensa que cubre ese ingrediente («yogur» para «yogur griego»), o null. */
export function enDespensa(nombre, despensa) {
  return (despensa || []).find(d => empiezaCon(nombre, d.nombre)) || null;
}

/** La fila de la despensa con ese mismo nombre (sin tildes, tolerando plurales), o null. */
export function filaDeDespensa(nombre, despensa) {
  return (despensa || []).find(d => mismoNombre(d.nombre, nombre)) || null;
}

/**
 * Los nombres que pasan a la despensa de una tanda de ítems de compras (lo marcado al
 * limpiar, lo tildado en «Revisá si tenés»): sin utensilios, sin lo que ya está y sin repetidos.
 */
export function paraDespensa(items, despensa) {
  const nombres = [];
  for (const it of items || []) {
    const nombre = String(it.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!nombre || it.rol === 'utensilio' || filaDeDespensa(nombre, despensa) || nombres.some(n => mismoNombre(n, nombre))) continue;
    nombres.push(nombre);
  }
  return nombres;
}

/** Los nombres escritos a mano, separados por coma, punto y coma, «y» o renglones: «harina, huevos y manteca». */
export function nombresEscritos(texto) {
  return String(texto || '').split(/[,;\n]+|\s+y\s+/i).map(s => s.trim().replace(/\s+/g, ' ').slice(0, 80)).filter(Boolean);
}

/** Las filas de la despensa que tocan a los principales de la receta («¿Se terminó algo?»), una vez cada una. */
export function enCasaDeReceta(receta, despensa) {
  const filas = [];
  for (const ing of receta?.ingredientes || []) {
    if (rolDe(ing) !== 'principal') continue;
    const fila = enDespensa(ing.nombre, despensa);
    if (fila && !filas.includes(fila)) filas.push(fila);
  }
  return filas;
}

const movido = item => item.lugar === REVISAR || LUGARES.includes(item.lugar);

/**
 * Dónde va un ítem de la lista: adonde lo movieron; «Revisá si tenés» si está en la
 * despensa o es condimento o utensilio; si no, el de la regla.
 */
export function lugarDe(item, lugares, despensa) {
  if (movido(item)) return item.lugar;
  if (A_REVISAR.includes(item.rol) || enDespensa(item.nombre, despensa)) return REVISAR;
  return lugarPorRegla(item, lugares);
}

/** ¿El ingrediente va directo a «Revisá si tenés» al agregar la receta? */
export function vaARevisar(ingrediente) {
  return A_REVISAR.includes(rolDe(ingrediente));
}

/**
 * Lo que arranca marcado en «Agregar a compras»: los principales (los opcionales, no).
 * Si la receta ya está en la lista, lo que está ahí, para cambiarla sin empezar de cero.
 * Y si la receta cambió desde entonces (se reprocesó: algo de la lista ya no corresponde a
 * ningún ingrediente), también los principales nuevos, para que no se pierdan.
 */
export function elegidosIniciales(receta, compras) {
  const principales = receta.ingredientes.filter(i => rolDe(i) === 'principal');
  const enLista = deLaReceta(compras, receta.id);
  if (!enLista.length) return new Set(principales.map(i => i.id));
  const ids = emparejar(receta, compras);
  const elegidos = new Set(receta.ingredientes.filter(i => !vaARevisar(i) && ids.has(i.id)).map(i => i.id));
  if (recetaCambio(receta, compras)) principales.filter(i => !ids.has(i.id)).forEach(i => elegidos.add(i.id));
  return elegidos;
}

/** ¿La receta cambió desde que se agregó a la lista? Algo de la lista ya no corresponde a ningún ingrediente. */
export function recetaCambio(receta, compras) {
  const usados = new Set(emparejar(receta, compras).values());
  return deLaReceta(compras, receta.id).some(c => !usados.has(c.id));
}

const deLaReceta = (compras, recetaId) => (compras || []).filter(c => c.receta_id === recetaId);

/**
 * Qué ítem de la lista corresponde a cada ingrediente de la receta: Map id de ingrediente → id de compras.
 * En pasadas, de la más segura a la menos: mismo nombre, rol y cantidad (para las porciones del ítem);
 * mismo nombre y rol; mismo nombre. Así, con nombres repetidos («azúcar» en la masa y en el almíbar),
 * cada uno se queda con el suyo. El nombre tolera plurales simples (huevo / huevos).
 */
function emparejar(receta, compras) {
  const libres = deLaReceta(compras, receta.id).slice();
  const asignados = new Map();
  const base = porcionesBase(receta);
  const cantidadPara = (i, c) => {
    const factor = base && Number(c.porciones) > 0 ? Number(c.porciones) / base : 1;
    const n = Number(paraComprar(i.cantidad, i.unidad || 'a ojo', factor));
    return (i.unidad || 'a ojo') === c.unidad && (c.unidad === 'a ojo' || n === Number(c.cantidad));
  };
  const pasada = coincide => receta.ingredientes.forEach(i => {
    if (asignados.has(i.id)) return;
    const k = libres.findIndex(c => mismoNombre(c.nombre, i.nombre) && coincide(c, i));
    if (k !== -1) asignados.set(i.id, libres.splice(k, 1)[0].id);
  });
  pasada((c, i) => (c.rol || 'principal') === rolDe(i) && cantidadPara(i, c));
  pasada((c, i) => (c.rol || 'principal') === rolDe(i));
  pasada(() => true);
  return asignados;
}

/**
 * Para volver a agregar una receta sin perder lo marcado: el id de compras de cada ingrediente.
 * Si ese ingrediente ya está en la lista (ver emparejar), su id; si no, uno nuevo con `nuevoId()`.
 * Devuelve una función ingrediente → id, que siempre da el mismo id para el mismo ingrediente.
 */
export function idsPara(receta, compras, nuevoId = () => '') {
  const asignados = emparejar(receta, compras);
  return ing => {
    if (!asignados.has(ing.id)) asignados.set(ing.id, nuevoId());
    return asignados.get(ing.id);
  };
}

/**
 * Los ítems de compras.agregar para una receta: lo elegido para comprar más los
 * condimentos y utensilios (que van a «Revisá si tenés»), con las cantidades para
 * `porciones`. `elegidos` es un Set de ids de ingredientes; `nuevoId(ingrediente)` da su id c_…
 * (con idsPara(), el que ya tiene en la lista).
 */
export function itemsDeReceta(receta, porciones, elegidos, nuevoId) {
  const base = porcionesBase(receta);
  const factor = base && porciones > 0 ? porciones / base : 1;
  return receta.ingredientes
    .filter(i => vaARevisar(i) || elegidos.has(i.id))
    .map(i => {
      const unidad = i.unidad || 'a ojo';
      const n = Number(paraComprar(i.cantidad, unidad, factor));
      return {
        id: nuevoId(i),
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

/**
 * Los ítems con cantidad, por familia (SPEC_v2 §7.4): el peso en gramos, el volumen
 * en mililitros (ml, l y cucharas) y lo demás por su unidad. Map clave → { n, cuantos,
 * metrico, soloTazas }. Peso y volumen no se mezclan.
 */
function porFamilia(items) {
  const totales = new Map();
  for (const it of items) {
    const n = Number(it.cantidad);
    if (it.unidad === 'a ojo' || !(n > 0)) continue;
    const unidad = it.unidad || 'u';
    const familia = familiaDe(unidad);
    let clave = unidad;
    let base = n;
    if (familia === 'peso') [clave, base] = ['peso', unidad === 'kg' ? n * 1000 : n];
    if (familia === 'metrico') [clave, base] = ['volumen', unidad === 'l' ? n * 1000 : n];
    if (familia === 'cucharas') [clave, base] = ['volumen', n * ML_CUCHARAS[unidad]];
    const t = totales.get(clave) || { n: 0, cuantos: 0, metrico: false, soloTazas: true };
    t.n += base;
    t.cuantos += 1;
    t.metrico = t.metrico || familia === 'metrico';
    t.soloTazas = t.soloTazas && unidad === 'taza';
    totales.set(clave, t);
  }
  return totales;
}

const textoDe = ({ cantidad, unidad }) => formatearCantidad(cantidad, unidad);

/**
 * «400 g», «1,2 kg», «6», «1 ¼ tazas», «200 g + 1 taza». Suma dentro de cada familia
 * aunque cambie la unidad y muestra el total en la más cómoda (acomodar()): con ml o l
 * en la suma, en ml o l; si son solo cucharas, en cucharas. Lo que se cuenta va tal
 * cual. Lo «a ojo» no suma; si todo es «a ojo», vacío.
 */
export function sumarCantidades(items) {
  return [...porFamilia(items)].map(([clave, t]) => {
    if (clave === 'peso') return textoDe(acomodar(t.n, 'g'));
    if (clave === 'volumen') {
      return textoDe(t.metrico ? acomodar(t.n, 'ml') : acomodar(t.n / ML_CUCHARAS.cdita, 'cdita', { eraTaza: t.soloTazas }));
    }
    return formatearCantidad(t.n, clave);
  }).join(' + ');
}

/**
 * Cómo va a quedar un ingrediente en la lista, para el paso de elegir: lo que se guarda
 * (paraComprar: 7,5 huevos son «8»), acomodado como en la lista. «a ojo» si no tiene cantidad.
 */
export function textoParaComprar(ing, factor = 1) {
  const unidad = ing.unidad || 'a ojo';
  return sumarCantidades([{ cantidad: paraComprar(ing.cantidad, unidad, factor), unidad }]) || 'a ojo';
}

/** «(3 + 1)» si alguna familia de la fila juntó dos o más cantidades; con la unidad en cada una si no es la misma. */
function desglose(items) {
  if (![...porFamilia(items).values()].some(t => t.cuantos > 1)) return '';
  const con = items.filter(i => i.unidad !== 'a ojo' && Number(i.cantidad) > 0);
  const unidad = con[0].unidad;
  const misma = con.every(i => i.unidad === unidad);
  return '(' + con.map(i => (misma
    ? formatearNumero(Number(i.cantidad), { fracciones: unidad !== 'g' && unidad !== 'ml' })
    : formatearCantidad(i.cantidad, i.unidad))).join(' + ') + ')';
}

/**
 * La lista para mostrar: [{ lugar, nombre, filas }], con los lugares en el orden de
 * LUGARES y «Revisá si tenés» al final. Cada fila junta los ítems con el mismo
 * nombre en ese lugar: { clave, nombre, cantidad, desglose, ids, hecho, opcional, enCasa, items }.
 * `enCasa`: está en «Revisá si tenés» porque está en la despensa (no porque lo movieron).
 * Lo de «Revisá si tenés» que ya está para comprar se suma a esa fila. Dentro de
 * cada lugar, las filas van en orden alfabético (lo marcado no se mueve).
 */
export function armarLista(compras, lugares, despensa) {
  const conLugar = (compras || []).map(c => ({ c, lugar: lugarDe(c, lugares, despensa) }));
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
      return {
        clave: f.items[0].id,
        nombre: f.nombre,
        cantidad: sumarCantidades(f.items),
        desglose: desglose(f.items),
        ids: f.items.map(i => i.id),
        hecho: f.items.every(i => i.hecho === true || i.hecho === 'true'),
        opcional: f.items.every(i => i.rol === 'opcional'),
        enCasa: l === REVISAR && f.items.some(i => !movido(i) && enDespensa(i.nombre, despensa)),
        items: f.items,
      };
    }).sort((a, b) => alfabetico(a.nombre, b.nombre)),
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
