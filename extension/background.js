// A ojo: guarda en la bandeja el link de la pestaña actual o de un link (menú contextual).
import { leerConfig, llamarApi } from './api.js';

const TITULO = 'Guardar en A ojo';
const COLORES = {
  espera: '#6B5D52', // --tinta-2
  ok: '#4F6B2E',     // --ok
  ya: '#8A5A10',     // --atencion
  error: '#B3261E',
};
const timers = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'guardar-link', title: TITULO, contexts: ['link'] });
  if (reason === 'install') {
    const { apiUrl, token } = await leerConfig();
    if (!apiUrl || !token) chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(tab => guardar(tab.url, tab.id));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'guardar-link') guardar(info.linkUrl, tab?.id);
});

async function guardar(url, tabId) {
  const config = await leerConfig();
  if (!config.apiUrl || !config.token) {
    avisar(tabId, '!', COLORES.error, 'Falta configurar A ojo');
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!/^https?:\/\//i.test(url || '')) {
    avisar(tabId, '!', COLORES.error, 'Esta pestaña no tiene un link para guardar');
    return;
  }

  mostrar(tabId, '…', COLORES.espera, 'Guardando…');
  try {
    const data = await llamarApi(config, { action: 'capturar', url, quien: config.quien });
    if (data.duplicada) avisar(tabId, '✓', COLORES.ya, 'Ya estaba guardada');
    else avisar(tabId, '✓', COLORES.ok, 'Guardada en A ojo');
  } catch (err) {
    avisar(tabId, '!', COLORES.error, `No se pudo guardar: ${err.message}`, 5000);
  }
}

// Insignia temporal: 2 s para los avisos, 5 s para los errores (así se llega a leer el detalle).
function avisar(tabId, texto, color, titulo, ms = 2000) {
  mostrar(tabId, texto, color, titulo);
  const clave = tabId ?? 'global';
  timers.set(clave, setTimeout(() => {
    timers.delete(clave);
    mostrar(tabId, '', color, TITULO);
  }, ms));
}

function mostrar(tabId, texto, color, titulo) {
  const clave = tabId ?? 'global';
  clearTimeout(timers.get(clave));
  timers.delete(clave);
  const destino = tabId != null ? { tabId } : {};
  chrome.action.setBadgeBackgroundColor({ ...destino, color });
  chrome.action.setBadgeTextColor?.({ ...destino, color: '#FFFFFF' });
  chrome.action.setBadgeText({ ...destino, text: texto });
  chrome.action.setTitle({ ...destino, title: titulo });
}
