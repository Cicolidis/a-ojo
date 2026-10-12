// Llamadas a la API de Apps Script. Ninguna lleva cabeceras que pidan preflight
// de CORS, que Apps Script no maneja: los GET van sin cabeceras propias y los POST,
// como text/plain con el JSON (y el token) en el cuerpo. Apps Script responde los
// POST con un 302 que fetch sigue solo.

export class ErrorApi extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

export async function llamarApi(config, action, params = {}, { timeoutMs = 30000, metodo = 'GET' } = {}) {
  const url = new URL(config.api);
  const opciones = { cache: 'no-store' };
  if (metodo === 'POST') {
    opciones.method = 'POST';
    opciones.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    opciones.body = JSON.stringify(Object.assign({}, params, { action, t: config.t }));
  } else {
    url.searchParams.set('action', action);
    url.searchParams.set('t', config.t);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, Object.assign(opciones, { signal: control.signal }));
  } catch (err) {
    if (err.name === 'AbortError') throw new ErrorApi('red', 'La API tardó demasiado en responder.');
    throw new ErrorApi('red', 'Sin conexión.');
  } finally {
    clearTimeout(timer);
  }

  let json;
  try {
    json = await resp.json();
  } catch {
    throw new ErrorApi('respuesta', resp.ok
      ? 'La API no respondió JSON. ¿El link de configuración es el correcto?'
      : `La API respondió HTTP ${resp.status}.`, resp.ok ? undefined : resp.status);
  }
  if (!json.ok) throw new ErrorApi(json.error || 'error', json.mensaje || 'La API devolvió un error.', json.status);
  return json.data;
}
