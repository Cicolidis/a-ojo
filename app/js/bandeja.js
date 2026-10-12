// Bandeja (§7.2): los links que necesitan ayuda, los que esperan a la Mac y las
// recetas recién llegadas. Puro, sin DOM.

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECIENTES = 10;
// Los estados que solo escribe /recetas: su `actualizado` dice cuándo corrió la Mac.
const DE_LA_MAC = ['procesando', 'lista', 'ayuda'];

const porFecha = campo => (a, b) => String(a[campo]).localeCompare(String(b[campo]));

/** Cuántas capturas subieron para la fila. */
export function cuantasCapturas(fila) {
  return String(fila.capturas || '').split(',').filter(s => s.trim()).length;
}

/**
 * Agrupa la bandeja para mostrarla:
 * - ayuda: las que necesitan ayuda, la más nueva primero;
 * - esperando: pendientes y procesando, en el orden en que las toma la Mac (la que procesa, primero);
 * - recientes: las que ya son receta, de los últimos 7 días, con su receta (`porId` del índice);
 * - ultimaCorrida: la última vez que la Mac escribió en la bandeja (ISO), o ''.
 */
export function agruparBandeja(bandeja, porId, ahoraMs = Date.now()) {
  const filas = bandeja || [];
  const ayuda = filas.filter(b => b.estado === 'ayuda').sort(porFecha('actualizado')).reverse();
  const esperando = filas.filter(b => b.estado === 'pendiente' || b.estado === 'procesando')
    .sort((a, b) => (b.estado === 'procesando') - (a.estado === 'procesando') || porFecha('creado')(a, b));
  const recientes = filas
    .filter(b => b.estado === 'lista' && porId.has(b.receta_id) && ahoraMs - Date.parse(b.actualizado) <= SIETE_DIAS_MS)
    .sort(porFecha('actualizado')).reverse()
    .slice(0, MAX_RECIENTES)
    .map(fila => ({ fila, receta: porId.get(fila.receta_id) }));
  const ultimaCorrida = filas.filter(b => DE_LA_MAC.includes(b.estado))
    .map(b => String(b.actualizado || ''))
    .reduce((a, b) => (b > a ? b : a), '');
  return { ayuda, esperando, recientes, ultimaCorrida };
}

/** Qué es el link, para la tarjeta: «Short de YouTube», «Reel de Instagram», «paulinacocina.net»… */
export function descripcionLink(fila) {
  const url = String(fila.url || '');
  if (fila.plataforma === 'youtube') return /\/shorts\//.test(url) ? 'Short de YouTube' : 'Video de YouTube';
  if (fila.plataforma === 'instagram') return /\/reels?\//.test(url) ? 'Reel de Instagram' : 'Publicación de Instagram';
  const host = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url);
  return host ? host[1] : 'Link';
}
