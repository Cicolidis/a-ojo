/**
 * Normalización de links para la bandeja.
 *
 * Apps Script no tiene la clase URL, así que todo se parsea con expresiones
 * regulares. El archivo también corre en Node para los tests (ver el final).
 *
 * normalizarUrl(texto) → { url, plataforma, clave } o null
 *   url:        forma canónica que se guarda en la Sheet
 *   plataforma: youtube · instagram · web · otro
 *   clave:      lo que se compara para deduplicar (ID de video o post si hay)
 */

const HOSTS_OTROS_ = /(^|\.)(tiktok\.com|facebook\.com|fb\.com|fb\.watch|x\.com|twitter\.com|threads\.net|threads\.com|pinterest\.[a-z.]+|pin\.it)$/;

const PARAMS_TRACKING_ = /^(utm_[a-z_]+|si|igsh|igshid|stkn|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|feature|ref|ref_src|ref_url)$/i;

const ID_YOUTUBE_ = /^[A-Za-z0-9_-]{11}$/;

/** Devuelve la primera URL http(s) que aparezca en un texto, o null. */
function extraerUrl(texto) {
  if (texto === null || texto === undefined) return null;
  const s = String(texto);
  let m = /https?:\/\/[^\s<>"'`«»]+/i.exec(s);
  let url = m ? m[0] : null;
  if (!url) {
    // Links conocidos pegados sin "https://"
    m = /(?:^|[\s(])((?:www\.|m\.)?(?:youtube\.com|youtu\.be|instagram\.com)\/[^\s<>"'`«»]+)/i.exec(s);
    if (m) url = 'https://' + m[1];
  }
  return url ? recortarPuntuacion_(url) : null;
}

/** Normaliza un link (o un texto que contiene uno). Devuelve null si no hay link. */
function normalizarUrl(texto) {
  const cruda = extraerUrl(texto);
  if (!cruda) return null;
  const p = partesUrl_(cruda);
  if (!p) return null;
  const base = p.hostname.replace(/^(www\.|m\.|mobile\.)/, '');
  return normalizarYoutube_(p, base) || normalizarInstagram_(p, base) || normalizarGenerica_(p, base);
}

function normalizarYoutube_(p, base) {
  if (!/^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(base)) return null;
  let id = null;
  let esShort = false;
  let m;
  if (base === 'youtu.be') {
    m = /^\/([^/]+)/.exec(p.ruta);
    id = m && m[1];
  } else if ((m = /^\/shorts\/([^/]+)/.exec(p.ruta))) {
    id = m[1];
    esShort = true;
  } else if ((m = /^\/(?:live|embed|v)\/([^/]+)/.exec(p.ruta))) {
    id = m[1];
  } else if (/^\/watch\/?$/.test(p.ruta)) {
    const v = p.params.filter(x => x.clave === 'v')[0];
    id = v && v.valor;
  }
  if (!id || !ID_YOUTUBE_.test(id)) {
    // Canal, lista o algo que no es un video: se guarda igual, limpio.
    return Object.assign(normalizarGenerica_(p, base), { plataforma: 'youtube' });
  }
  return {
    url: esShort ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id,
    plataforma: 'youtube',
    clave: 'youtube:' + id,
  };
}

function normalizarInstagram_(p, base) {
  if (!/^(instagram\.com|instagr\.am)$/.test(base)) return null;
  // /reel/X, /reels/X, /p/X, /tv/X, con o sin /usuario/ adelante
  const m = /^\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(p.ruta);
  if (!m) return Object.assign(normalizarGenerica_(p, base), { plataforma: 'instagram' });
  const tipo = m[1] === 'p' ? 'p' : 'reel';
  return {
    url: 'https://www.instagram.com/' + tipo + '/' + m[2] + '/',
    plataforma: 'instagram',
    clave: 'instagram:' + m[2],
  };
}

function normalizarGenerica_(p, base) {
  const params = p.params.filter(x => !PARAMS_TRACKING_.test(x.clave));
  const query = params.length ? '?' + params.map(x => x.crudo).join('&') : '';
  // Para comparar: sin esquema, sin "www." y sin barra final.
  const rutaClave = p.ruta.replace(/\/+$/, '');
  return {
    url: p.esquema + '://' + p.hostname + p.puerto + p.ruta + query,
    plataforma: HOSTS_OTROS_.test(base) ? 'otro' : 'web',
    clave: base + p.puerto + rutaClave + query,
  };
}

function partesUrl_(url) {
  const m = /^(https?):\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!m) return null;
  return {
    esquema: m[1].toLowerCase(),
    hostname: m[2].toLowerCase().replace(/\.$/, ''),
    puerto: m[3] && m[3] !== '80' && m[3] !== '443' ? ':' + m[3] : '',
    ruta: m[4] || '/',
    params: parsearQuery_(m[5] || ''),
  };
}

function parsearQuery_(query) {
  return query.split('&').filter(Boolean).map(par => {
    const i = par.indexOf('=');
    return {
      clave: decodificar_(i === -1 ? par : par.slice(0, i)),
      valor: i === -1 ? '' : decodificar_(par.slice(i + 1)),
      crudo: par,
    };
  });
}

function decodificar_(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch (err) {
    return s;
  }
}

function recortarPuntuacion_(url) {
  let u = url.replace(/[.,;:!?…]+$/, '');
  // Un ")" final sin "(" adentro es parte del texto, no del link.
  while (u.endsWith(')') && u.indexOf('(') === -1) {
    u = u.slice(0, -1).replace(/[.,;:!?…]+$/, '');
  }
  return u;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extraerUrl, normalizarUrl };
}
