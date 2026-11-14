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

// Links que llegan desde la app (§5.3): compartidos con el `share_target` del
// manifest o pegados en la Bandeja. La API los normaliza y deduplica (Url.js);
// acá solo se saca el link del texto y se arma la fila provisoria.

const LINK = /https?:\/\/[^\s<>"'`«»]+/i;
const LINK_SIN_ESQUEMA = /(?:^|[\s(])((?:www\.|m\.)?(?:youtube\.com|youtu\.be|instagram\.com)\/[^\s<>"'`«»]+)/i;

/** Saca la puntuación que queda pegada al final del link («…mirá esto: https://…/.»). Como recortarPuntuacion_ de Url.js. */
function recortarPuntuacion(url) {
  let u = url.replace(/[.,;:!?…]+$/, '');
  while (u.endsWith(')') && u.indexOf('(') === -1) u = u.slice(0, -1).replace(/[.,;:!?…]+$/, '');
  return u;
}

/** El primer link http(s) de un texto (o uno de YouTube o Instagram pegado sin https://), o null. Como extraerUrl de Url.js. */
export function extraerLink(texto) {
  const s = String(texto ?? '');
  let m = LINK.exec(s);
  if (m) return recortarPuntuacion(m[0]);
  m = LINK_SIN_ESQUEMA.exec(s);
  return m ? recortarPuntuacion('https://' + m[1]) : null;
}

/**
 * Lo que compartieron con la app: Android la abre en `./?titulo=…&texto=…&link=…`
 * (el `share_target` del manifest). Devuelve todo junto, para buscar el link, o
 * null si la app no se abrió desde Compartir.
 */
export function leerCompartido(search) {
  const params = new URLSearchParams(String(search || ''));
  const partes = ['link', 'texto', 'titulo'].map(p => (params.get(p) || '').trim()).filter(Boolean);
  return partes.length ? partes.join(' ') : null;
}

/** youtube · instagram · web, como la detecta la API, para describir la fila provisoria. */
export function plataformaDe(url) {
  const host = (/^https?:\/\/([^/?#]+)/i.exec(String(url || '')) || [])[1] || '';
  const base = host.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '');
  if (/^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(base)) return 'youtube';
  if (/^instagram\.com$/.test(base)) return 'instagram';
  return 'web';
}

// Lo mismo que PARAMS_TRACKING_ de Url.js: se ignoran al comparar.
const PARAMS_TRACKING = /^(utm_[a-z_]+|si|igsh|igshid|stkn|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|feature|ref|ref_src|ref_url)$/i;

const decodificar = s => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

/**
 * La clave con que la API deduplica un link (la `clave` de normalizarUrl en Url.js):
 * `youtube:ID`, `instagram:ID` o el link sin esquema, sin www., sin barra final y
 * sin parámetros de seguimiento. Un test exige que dé lo mismo que Url.js.
 */
export function claveLink(texto) {
  const url = extraerLink(texto);
  const m = url && /^(https?):\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!m) return String(texto ?? '');
  const base = m[2].toLowerCase().replace(/\.$/, '').replace(/^(www\.|m\.|mobile\.)/, '');
  const puerto = m[3] && m[3] !== '80' && m[3] !== '443' ? ':' + m[3] : '';
  const ruta = m[4] || '/';
  const params = (m[5] || '').split('&').filter(Boolean).map(crudo => {
    const k = crudo.indexOf('=');
    return { clave: decodificar(k === -1 ? crudo : crudo.slice(0, k)), valor: k === -1 ? '' : decodificar(crudo.slice(k + 1)), crudo };
  });
  let r;
  if (/^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(base)) {
    let id = null;
    if (base === 'youtu.be') id = (/^\/([^/]+)/.exec(ruta) || [])[1];
    else if ((r = /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(ruta))) id = r[1];
    else if (/^\/watch\/?$/.test(ruta)) id = (params.find(x => x.clave === 'v') || {}).valor;
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return 'youtube:' + id;
  } else if (/^(instagram\.com|instagr\.am)$/.test(base)) {
    if ((r = /^\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(ruta))) return 'instagram:' + r[2];
  }
  const query = params.filter(x => !PARAMS_TRACKING.test(x.clave)).map(x => x.crudo).join('&');
  return base + puerto + ruta.replace(/\/+$/, '') + (query ? '?' + query : '');
}

/**
 * ¿Dos links son el mismo para la API? Sirve para avisar enseguida y no mostrar dos
 * veces una fila mientras la captura espera en la cola; la que decide es la API.
 */
export function mismoLink(a, b) {
  return claveLink(a) === claveLink(b);
}

/** La fila de la bandeja que ya tiene ese link (a grandes rasgos, ver mismoLink), o undefined. */
export function filaDelLink(bandeja, url) {
  return (bandeja || []).find(b => mismoLink(b.url, url));
}
