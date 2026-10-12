// Sincronización con la Sheet y precarga de fotos para usarlas sin conexión.

import { llamarApi } from './api.js';
import { guardar } from './db.js';
import { aplicarDelta, necesitaCompleta, trajoCambios } from './datos.js';

export const CACHE_FOTOS = 'a-ojo-fotos';

/** Pide a `todo` lo cambiado (o todo) y guarda el snapshot nuevo. Devuelve { datos, cambios }. */
export async function sincronizar(config, datos) {
  const completa = necesitaCompleta(datos);
  const resp = await llamarApi(config, 'todo', completa ? {} : { since: datos.since });
  const nuevos = aplicarDelta(completa ? null : datos, resp);
  await guardar('datos', nuevos);
  return { datos: nuevos, cambios: trajoCambios(completa ? null : datos, resp) };
}

/**
 * Deja en la caché todas las fotos de las recetas y borra las que ya no se usan.
 * Las de Drive pasan por un redirect sin CORS: se piden `no-cors` y quedan como
 * respuestas opacas, que igual sirven para <img>.
 */
export async function precargarFotos(urls) {
  if (!('caches' in window)) return;
  const cache = await caches.open(CACHE_FOTOS);
  const queridas = new Set(urls.filter(Boolean).map(u => new URL(u, location.href).href));
  for (const pedido of await cache.keys()) {
    if (!queridas.has(pedido.url)) await cache.delete(pedido);
  }
  for (const url of queridas) {
    if (await cache.match(url)) continue;
    try {
      const resp = await fetch(url, { mode: 'no-cors' });
      if (resp.type === 'opaque' || resp.ok) await cache.put(url, resp);
    } catch {
      return; // Sin conexión: se completa en la próxima sincronización.
    }
  }
}
