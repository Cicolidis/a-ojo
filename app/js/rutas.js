// Rutas por hash: #/, #/receta/:id, #/cocina/:id, #/ingredientes/:id, #/compras,
// #/compras/recetas, #/compras/agregar/:id, #/lugares, #/despensa, #/bandeja, #/nueva, #/editar/:id,
// #/semana[/AAAA-MM-DD] (con /elegir, /poner/:id y /compra) y #/config?…  Pura.

import { COMIDAS, esSemana, diasDe } from './plan.js';

/**
 * Adónde va lo que se elige en la semana, desde la dirección (?fecha=…&comida=…): { fecha, comida }
 * si es un día de esa semana con una comida válida; { fecha: '', comida: '' } («Sin día») si no.
 */
function destinoDe(semana, consulta) {
  const fecha = consulta.get('fecha') || '';
  const comida = consulta.get('comida') || '';
  const valido = semana && diasDe(semana).includes(fecha) && COMIDAS.some(c => c.valor === comida);
  return valido ? { fecha, comida } : { fecha: '', comida: '' };
}

export function leerRuta(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const ruta = h.split('?')[0].replace(/\/+$/, '') || '/';
  const consulta = new URLSearchParams(h.split('?')[1] || '');
  let m;
  if (ruta === '/') return { nombre: 'biblioteca' };
  // El plan semanal: la semana va en la dirección (su lunes); sin semana, o con una que no es un lunes, la actual.
  if (ruta === '/semana') return { nombre: 'semana', semana: '' };
  if ((m = /^\/semana\/(\d{4}-\d{2}-\d{2})$/.exec(ruta))) return { nombre: 'semana', semana: esSemana(m[1]) ? m[1] : '' };
  if ((m = /^\/semana\/(\d{4}-\d{2}-\d{2})\/elegir$/.exec(ruta)) && esSemana(m[1])) {
    return { nombre: 'semana-elegir', semana: m[1], destino: destinoDe(m[1], consulta) };
  }
  if ((m = /^\/semana\/(\d{4}-\d{2}-\d{2})\/poner\/([\w-]+)$/.exec(ruta)) && esSemana(m[1])) {
    return { nombre: 'semana-poner', semana: m[1], id: m[2], destino: destinoDe(m[1], consulta) };
  }
  // «Elegir día y comida» desde la ficha: la semana se elige en esa pantalla.
  if ((m = /^\/semana\/poner\/([\w-]+)$/.exec(ruta))) return { nombre: 'semana-poner', semana: '', id: m[1], destino: null };
  if ((m = /^\/semana\/(\d{4}-\d{2}-\d{2})\/compra$/.exec(ruta)) && esSemana(m[1])) return { nombre: 'semana-compra', semana: m[1] };
  if ((m = /^\/receta\/([\w-]+)$/.exec(ruta))) return { nombre: 'receta', id: m[1] };
  if ((m = /^\/cocina\/([\w-]+)$/.exec(ruta))) return { nombre: 'cocina', id: m[1] };
  if ((m = /^\/ingredientes\/([\w-]+)$/.exec(ruta))) return { nombre: 'ingredientes', id: m[1] };
  if (ruta === '/compras') return { nombre: 'compras' };
  if (ruta === '/compras/recetas') return { nombre: 'elegir' };
  if ((m = /^\/compras\/agregar\/([\w-]+)$/.exec(ruta))) return { nombre: 'agregar', id: m[1] };
  if (ruta === '/lugares') return { nombre: 'lugares' };
  if (ruta === '/despensa') return { nombre: 'despensa' };
  if (ruta === '/bandeja') return { nombre: 'bandeja' };
  if (ruta === '/nueva') {
    // Desde el «+» de la semana: «Una receta nuestra», que al crearla queda puesta ahí.
    const semana = esSemana(consulta.get('semana') || '') ? consulta.get('semana') : '';
    return semana ? { nombre: 'nueva', semana, destino: destinoDe(semana, consulta) } : { nombre: 'nueva' };
  }
  if ((m = /^\/editar\/([\w-]+)$/.exec(ruta))) return { nombre: 'editar', id: m[1] };
  if (ruta === '/config') return { nombre: 'config' };
  return { nombre: 'biblioteca' };
}

const NOMBRES = {
  cocina: 'Modo cocina',
  ingredientes: 'Editar ingredientes',
  agregar: 'Agregar a compras',
  compras: 'Compras',
  elegir: 'Agregar una receta',
  lugares: 'Dónde compramos',
  despensa: 'Lo que hay en casa',
  bandeja: 'Bandeja',
  nueva: 'Nueva receta',
  semana: 'Semana',
  'semana-elegir': 'Elegir una receta',
  'semana-poner': 'Sumar a la semana',
  'semana-compra': 'Compra de la semana',
  editar: 'Editar la receta',
};

/**
 * ¿La pantalla tiene algo a medio hacer que una recarga perdería? El modo cocina
 * siempre; las demás, si su vista lo dice con `ocupada()` (una nota a medio
 * escribir, ingredientes sin guardar). Con una versión nueva, la recarga espera.
 */
export function vistaOcupada(vista) {
  if (!vista) return false;
  return vista.enCocina === true || (typeof vista.ocupada === 'function' && vista.ocupada() === true);
}

/** Título de la pestaña (y del selector de apps): «Compras · A ojo», «Torta vasca · A ojo». */
export function tituloDe(ruta, receta) {
  return [NOMBRES[ruta.nombre], receta && receta.titulo, 'A ojo'].filter(Boolean).join(' · ');
}
