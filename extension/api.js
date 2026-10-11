// Llamadas a la API de Apps Script. Lo usan el service worker y la página de opciones.

export async function leerConfig() {
  const { apiUrl = '', token = '', quien = 'camilo' } = await chrome.storage.local.get(['apiUrl', 'token', 'quien']);
  return { apiUrl, token, quien };
}

// POST con Content-Type text/plain: evita el preflight de CORS, que Apps Script no maneja.
export async function llamarApi({ apiUrl, token }, cuerpo, { timeoutMs = 20000 } = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...cuerpo, t: token }),
      signal: control.signal,
    });
    const texto = await resp.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error(resp.ok
        ? 'La API no respondió JSON. ¿La URL es la del web app y termina en /exec?'
        : `La API respondió HTTP ${resp.status}.`);
    }
    if (!json.ok) throw new Error(json.mensaje || json.error || 'La API devolvió un error.');
    return json.data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('La API tardó demasiado en responder.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
