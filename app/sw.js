// Service worker de A ojo: la interfaz y las fotos quedan en caché para usar la app sin conexión.
// Los datos no pasan por acá: viven en IndexedDB y la API no se intercepta.

// El deploy (.github/workflows/pages.yml) reemplaza el marcador por el commit.
const VERSION = '__VERSION__';
const DESARROLLO = VERSION === '__' + 'VERSION__';
const CACHE_APP = 'a-ojo-app-' + VERSION;
const CACHE_FOTOS = 'a-ojo-fotos';

// Todo archivo de app/ que use la interfaz tiene que estar acá (lo revisa tests/app.test.js).
const ARCHIVOS = [
  'index.html',
  'manifest.json',
  'css/estilos.css',
  'fuentes/fraunces.woff2',
  'fuentes/work-sans.woff2',
  'iconos/favicon-32.png',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
  'iconos/maskable-512.png',
  'js/api.js',
  'js/app.js',
  'js/bandeja.js',
  'js/cocina.js',
  'js/compras.js',
  'js/config.js',
  'js/datos.js',
  'js/db.js',
  'js/dom.js',
  'js/ediciones.js',
  'js/formato.js',
  'js/imagenes.js',
  'js/ingredientes.js',
  'js/rutas.js',
  'js/sync.js',
  'js/vistas/agregar.js',
  'js/vistas/bandeja.js',
  'js/vistas/biblioteca.js',
  'js/vistas/bienvenida.js',
  'js/vistas/cocina.js',
  'js/vistas/compras.js',
  'js/vistas/controles.js',
  'js/vistas/elegir.js',
  'js/vistas/ficha.js',
  'js/vistas/ingredientes.js',
  'js/vistas/lugares.js',
];

const base = new URL('./', self.location).href;
const DE_LA_APP = new Set(ARCHIVOS.map(a => base + a));

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(ARCHIVOS.map(a => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres
        .filter(n => n.startsWith('a-ojo-app-') && n !== CACHE_APP)
        .map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  url.hash = '';

  if (pedido.mode === 'navigate' && url.href.startsWith(base)) {
    evento.respondWith(deLaApp(base + 'index.html'));
  } else if (DE_LA_APP.has(url.href)) {
    evento.respondWith(deLaApp(url.href));
  } else if (pedido.destination === 'image') {
    evento.respondWith(foto(pedido));
  }
  // Lo demás (la API) va directo a la red.
});

/** En producción, primero la caché. En desarrollo, primero la red, así se ven los cambios. */
async function deLaApp(url) {
  const cache = await caches.open(CACHE_APP);
  if (!DESARROLLO) {
    const guardada = await cache.match(url);
    if (guardada) return guardada;
  }
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp.ok) cache.put(url, resp.clone());
    return resp;
  } catch (err) {
    const guardada = await cache.match(url);
    if (guardada) return guardada;
    throw err;
  }
}

/** Fotos: primero la caché. Las de Drive llegan opacas (su redirect no tiene CORS) y sirven igual para <img>. */
async function foto(pedido) {
  const cache = await caches.open(CACHE_FOTOS);
  const guardada = await cache.match(pedido.url);
  if (guardada) return guardada;
  const resp = await fetch(pedido);
  if (resp.ok || resp.type === 'opaque') cache.put(pedido.url, resp.clone());
  return resp;
}
