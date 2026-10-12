// Sincronización con la Sheet y precarga de fotos para usarlas sin conexión.

import { llamarApi } from './api.js';
import { guardar } from './db.js';
import { aplicarDelta, necesitaCompleta, trajoCambios } from './datos.js';
import { aplicarCola, procesarCola } from './ediciones.js';

export const CACHE_FOTOS = 'a-ojo-fotos';

/**
 * Primero manda las ediciones de la cola; después pide a `todo` lo cambiado (o
 * todo), le vuelve a aplicar lo que haya quedado sin mandar y guarda el snapshot.
 * Sin conexión, falla con el error `red` sin pedir nada más.
 * Devuelve { datos, cambios, descartadas, pendiente } (`pendiente`: por qué quedaron ediciones sin mandar).
 */
export async function sincronizar(config, datos, cola) {
  const envio = await procesarCola(cola,
    e => llamarApi(config, e.accion, e.datos, { metodo: 'POST' }),
    () => guardar('cola', cola));
  if (envio.error && envio.error.codigo === 'red') throw envio.error;

  // Si la API rechazó alguna edición, los datos locales la tienen aplicada: se piden todos de nuevo.
  const completa = necesitaCompleta(datos) || envio.descartadas.length > 0;
  const resp = await llamarApi(config, 'todo', completa ? {} : { since: datos.since });
  const nuevos = aplicarCola(aplicarDelta(completa ? null : datos, resp), cola);
  await guardar('datos', nuevos);
  return {
    datos: nuevos,
    cambios: envio.enviadas > 0 || envio.descartadas.length > 0 || trajoCambios(completa ? null : datos, resp),
    descartadas: envio.descartadas,
    pendiente: envio.error,
  };
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
