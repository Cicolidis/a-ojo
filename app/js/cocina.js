// Qué ingredientes usa cada paso. /recetas escribe los pasos nombrando los
// ingredientes (ver .claude/commands/recetas.md), así que alcanza con buscar
// el nombre de cada ingrediente en el texto del paso. Puro, sin DOM.

import { normalizar } from './datos.js';

const VACIAS = new Set([
  'a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para',
  'por', 'que', 'se', 'sin', 'su', 'sus', 'u', 'un', 'una', 'unas', 'unos', 'y',
]);

function palabras(texto) {
  return normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Palabras que distinguen a un ingrediente: sin artículos ni números («harina 0000» → harina). */
function significativas(nombre) {
  return palabras(nombre).filter(p => !VACIAS.has(p) && !/^\d+$/.test(p));
}

/** Singular y plural de una palabra: huevo ↔ huevos, nuez ↔ nueces, limon ↔ limones. */
function variantes(p) {
  const v = new Set([p]);
  if (p.endsWith('ces')) v.add(p.slice(0, -3) + 'z');
  if (p.endsWith('z')) v.add(p.slice(0, -1) + 'ces');
  if (p.endsWith('es')) v.add(p.slice(0, -2));
  if (p.endsWith('s')) v.add(p.slice(0, -1));
  v.add(/[aeiou]$/.test(p) ? p + 's' : p + 'es');
  return v;
}

// Palabras que solo dicen qué parte se usa: en «esencia de vainilla», el paso dice «la vainilla».
const GENERICAS = new Set([
  'esencia', 'extracto', 'jugo', 'zumo', 'ralladura', 'cascara', 'hoja', 'hojas', 'ramita', 'ramitas',
  'diente', 'dientes', 'cubo', 'cubos', 'rodaja', 'rodajas', 'gotas',
]);

// Palabras que describen y no nombran: no alcanzan para reconocer un ingrediente.
// También «hornear», por «polvo de hornear».
const ADJETIVOS = new Set(['hornear',
  'blanca', 'blanco', 'chica', 'chico', 'cocida', 'cocido', 'comun', 'congelada', 'congelado', 'cremosa',
  'cremoso', 'derretida', 'derretido', 'dulce', 'entera', 'entero', 'fina', 'fino', 'fresca', 'fresco',
  'fria', 'frio', 'grande', 'gruesa', 'grueso', 'integral', 'light', 'madura', 'maduro', 'magra', 'magro',
  'mediana', 'mediano', 'molida', 'molido', 'natural', 'negra', 'negro', 'picada', 'picado', 'polvo',
  'rallada', 'rallado', 'roja', 'rojo', 'salada', 'salado', 'seca', 'seco', 'tibia', 'tibio', 'vegetal',
  'verde',
]);

/**
 * Ingredientes que nombra el texto de un paso, en el orden de la receta.
 * Un ingrediente aparece si su primera palabra significativa está en el paso,
 * o la segunda si la primera es genérica («jugo de limón»), o alguna otra que
 * no sea un adjetivo y no tenga ningún otro ingrediente («pechugas de pollo»
 * → «el pollo»).
 * Si varios comparten esa palabra (leche / leche condensada), quedan los que
 * tienen más de sus otras palabras en el paso; si ninguno tiene, el de nombre
 * más corto.
 */
export function ingredientesDelPaso(textoPaso, ingredientes) {
  const enPaso = new Set(palabras(textoPaso));
  const esta = p => [...variantes(p)].some(v => enPaso.has(v));

  const lista = ingredientes || [];
  const todas = lista.map(ing => significativas(ing.nombre));
  const deOtro = (p, indice) => todas.some((sig, j) => j !== indice && sig.some(o => variantes(p).has(o)));

  const grupos = new Map();
  lista.forEach((ing, indice) => {
    const sig = todas[indice];
    if (!sig.length) return;
    const claves = [sig[0]];
    if (GENERICAS.has(sig[0]) && sig[1]) claves.push(sig[1]);
    sig.slice(1).forEach(p => {
      if (!ADJETIVOS.has(p) && !claves.includes(p) && !deOtro(p, indice)) claves.push(p);
    });
    const clave = claves.find(esta);
    if (!clave) return;
    const resto = sig.filter(p => p !== clave);
    const grupo = clave.replace(/(es|s)$/, '');
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push({ ing, indice, sig, clave, resto, puntaje: resto.filter(esta).length });
  });

  let elegidos = [];
  grupos.forEach(grupo => {
    const mejor = Math.max(...grupo.map(c => c.puntaje));
    let quedan = grupo.filter(c => c.puntaje === mejor);
    if (mejor === 0) {
      const menos = Math.min(...quedan.map(c => c.sig.length));
      quedan = quedan.filter(c => c.sig.length === menos);
    }
    elegidos.push(...quedan);
  });
  // «Sumá la harina de garbanzos»: el «garbanzos» es parte de otro ingrediente
  // nombrado completo, no los garbanzos cocidos.
  const completos = elegidos.filter(c => c.resto.length && c.puntaje === c.resto.length);
  elegidos = elegidos.filter(c => c.puntaje > 0 ||
    !completos.some(o => o !== c && o.resto.some(p => variantes(p).has(c.clave))));
  return elegidos.sort((a, b) => a.indice - b.indice).map(c => c.ing);
}
