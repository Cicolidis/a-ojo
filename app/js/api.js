// Llamadas a la API de Apps Script. Por ahora la app solo lee (GET `todo`).
// Los GET no llevan cabeceras propias: así no hay preflight de CORS, que Apps Script no maneja.

export class ErrorApi extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export async function llamarApi(config, action, params = {}, { timeoutMs = 30000 } = {}) {
  const url = new URL(config.api);
  url.searchParams.set('action', action);
  url.searchParams.set('t', config.t);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, { cache: 'no-store', signal: control.signal });
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
      : `La API respondió HTTP ${resp.status}.`);
  }
  if (!json.ok) throw new ErrorApi(json.error || 'error', json.mensaje || 'La API devolvió un error.');
  return json.data;
}
