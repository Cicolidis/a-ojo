// Datos locales de la app: cómo se arma el snapshot a partir de `todo` y cómo se busca en él.
// Todo es puro (sin DOM ni IndexedDB) para poder testearlo en Node.

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Aplica una respuesta de `todo` al snapshot guardado y devuelve uno nuevo.
 * Completa: reemplaza todo. Delta: si una receta cambió, vienen todos sus
 * ingredientes y pasos y reemplazan a los anteriores; notas y bandeja se
 * actualizan por id; compras viene siempre entera.
 */
export function aplicarDelta(datos, resp) {
  if (resp.completo || !datos) {
    return {
      since: resp.ahora,
      ultimaCompleta: resp.ahora,
      recetas: resp.recetas,
      ingredientes: resp.ingredientes,
      pasos: resp.pasos,
      notas: resp.notas,
      compras: resp.compras,
      bandeja: resp.bandeja,
    };
  }
  const cambiadas = new Set(resp.recetas.map(r => r.id));
  const deOtras = lista => lista.filter(x => !cambiadas.has(x.receta_id));
  return {
    since: resp.ahora,
    ultimaCompleta: datos.ultimaCompleta,
    recetas: porId(datos.recetas, resp.recetas),
    ingredientes: deOtras(datos.ingredientes).concat(resp.ingredientes),
    pasos: deOtras(datos.pasos).concat(resp.pasos),
    notas: porId(datos.notas, resp.notas),
    compras: resp.compras,
    bandeja: porId(datos.bandeja, resp.bandeja),
  };
}

/** Lista con los elementos de `nuevos` reemplazando (o sumándose a) los de `viejos` con el mismo id. */
function porId(viejos, nuevos) {
  const mapa = new Map(viejos.map(x => [x.id, x]));
  nuevos.forEach(x => mapa.set(x.id, x));
  return [...mapa.values()];
}

/** ¿Hace falta pedir todo de nuevo? Sin `since`, o si la última vez completa fue hace más de 7 días. */
export function necesitaCompleta(datos, ahoraMs = Date.now()) {
  if (!datos || !datos.since || !datos.ultimaCompleta) return true;
  const ultima = Date.parse(datos.ultimaCompleta);
  return isNaN(ultima) || ahoraMs - ultima > SIETE_DIAS_MS;
}

/** ¿La respuesta trajo algo que cambie lo que se ve? */
export function trajoCambios(datos, resp) {
  if (resp.completo || !datos) return true;
  return resp.recetas.length > 0 || resp.notas.length > 0 || resp.bandeja.length > 0 ||
    JSON.stringify(resp.compras) !== JSON.stringify(datos.compras);
}

/** Sin tildes y en minúsculas: «Limón» → «limon». */
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function separarEtiquetas(etiquetas) {
  return String(etiquetas ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

const porOrden = (a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0);

/**
 * Arma las recetas listas para mostrar: cada una con sus ingredientes y pasos
 * en orden, sus notas (la más nueva primero) y el texto en el que se busca.
 * Devuelve { lista, porId }; la lista va de la receta más nueva a la más vieja.
 */
export function indexar(datos) {
  const agrupar = filas => {
    const mapa = new Map();
    (filas || []).forEach(f => {
      if (!mapa.has(f.receta_id)) mapa.set(f.receta_id, []);
      mapa.get(f.receta_id).push(f);
    });
    return mapa;
  };
  const ingredientes = agrupar(datos?.ingredientes);
  const pasos = agrupar(datos?.pasos);
  const notas = agrupar(datos?.notas);

  const lista = (datos?.recetas || []).map(r => {
    const ings = (ingredientes.get(r.id) || []).sort(porOrden);
    const etiquetas = separarEtiquetas(r.etiquetas);
    return Object.assign({}, r, {
      etiquetasLista: etiquetas,
      ingredientes: ings,
      pasos: (pasos.get(r.id) || []).sort(porOrden),
      notas: (notas.get(r.id) || []).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
      busqueda: normalizar([r.titulo, ...ings.map(i => i.nombre), ...etiquetas].join(' ')),
    });
  }).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));

  return { lista, porId: new Map(lista.map(r => [r.id, r])) };
}

/** Filtros de la Biblioteca. Los de etiqueta se arman con `filtroEtiqueta()`. */
export const FILTROS = [
  { id: 'todas', nombre: 'Todas' },
  { id: 'para_probar', nombre: 'Para probar' },
  { id: 'favorita', nombre: 'Favoritas' },
  { id: 'tipo:dulce', nombre: 'Dulce' },
  { id: 'tipo:salado', nombre: 'Salado' },
];

export function filtroEtiqueta(etiqueta) {
  const nombre = (etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)).replace(/\btacc\b/gi, 'TACC');
  return { id: 'etiqueta:' + etiqueta, nombre };
}

function cumpleFiltro(r, filtro) {
  if (!filtro || filtro === 'todas') return true;
  if (filtro === 'para_probar' || filtro === 'favorita') return r.estado === filtro;
  if (filtro.startsWith('tipo:')) return r.tipo === filtro.slice(5);
  if (filtro.startsWith('etiqueta:')) return r.etiquetasLista.includes(filtro.slice(9));
  return true;
}

/**
 * Recetas visibles en la Biblioteca: sin las descartadas, con el filtro elegido
 * y con todas las palabras buscadas en el título, los ingredientes o las etiquetas.
 */
export function buscar(lista, { texto = '', filtro = 'todas' } = {}) {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  return lista.filter(r => r.estado !== 'descartada' && cumpleFiltro(r, filtro) &&
    palabras.every(p => r.busqueda.includes(p)));
}

/** Las `n` etiquetas más usadas (sin contar las descartadas); a igual cantidad, por orden alfabético. */
export function etiquetasFrecuentes(lista, n = 6) {
  const cuenta = new Map();
  lista.filter(r => r.estado !== 'descartada').forEach(r => {
    r.etiquetasLista.forEach(e => cuenta.set(e, (cuenta.get(e) || 0) + 1));
  });
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, n)
    .map(([e]) => e);
}

/** Cuántos links siguen en la bandeja: los que esperan a la Mac y los que necesitan ayuda. */
export function resumenBandeja(bandeja) {
  const esperando = (bandeja || []).filter(b => b.estado === 'pendiente' || b.estado === 'procesando').length;
  const ayuda = (bandeja || []).filter(b => b.estado === 'ayuda').length;
  return { total: esperando + ayuda, esperando, ayuda };
}
