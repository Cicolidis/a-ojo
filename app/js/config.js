// Configuración de la app: URL de la API, token y quién la usa. Llega una sola
// vez por el link de configuración y queda en localStorage.

const CLAVE = 'a-ojo:config';
const QUIENES = ['camilo', 'pareja'];
const API_GOOGLE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
// La API falsa de scripts/servir.js, para probar en la Mac.
const API_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[\w./-]*$/;

/**
 * Lee el link de configuración: `#/config?api=…&t=…&quien=…`.
 * Devuelve { config } o { error } con un mensaje para mostrar. Pura.
 */
export function leerLinkConfig(hash) {
  const i = String(hash || '').indexOf('?');
  const params = new URLSearchParams(i === -1 ? '' : hash.slice(i + 1));
  const api = (params.get('api') || '').trim();
  const t = (params.get('t') || '').trim();
  const quien = (params.get('quien') || '').trim().toLowerCase();

  if (!api) return { error: 'Al link de configuración le falta la dirección de la API.' };
  if (!API_GOOGLE.test(api) && !API_LOCAL.test(api)) {
    return { error: 'La dirección de la API del link no es la de A ojo. Pedí un link nuevo.' };
  }
  if (!t) return { error: 'Al link de configuración le falta el token.' };
  if (!QUIENES.includes(quien)) return { error: 'El link de configuración no dice quién sos. Pedí un link nuevo.' };
  return { config: { api, t, quien } };
}

export function leerConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    return c && c.api && c.t ? c : null;
  } catch {
    return null;
  }
}

export function guardarConfig(config) {
  localStorage.setItem(CLAVE, JSON.stringify(config));
}
