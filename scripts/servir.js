#!/usr/bin/env node
// Servidor local de la PWA (app/), sin dependencias.
//
//   node scripts/servir.js [--falsa] [--puerto 4173]
//
// Con --falsa también responde una API de prueba en /api-falsa con los datos de
// tests/fixtures/todo.json, y sirve sus fotos en /fotos-prueba/. Así la app se
// prueba sin el token real. El token de la API falsa es «prueba»:
//   http://localhost:4173/#/config?api=http%3A%2F%2Flocalhost%3A4173%2Fapi-falsa&t=prueba&quien=camilo
//
// La API falsa responde ping y todo, y acepta las ediciones de la app (POST) y
// capturas.subir: las guarda en memoria, así `todo` las devuelve, hasta que se
// reinicia el servidor. De las capturas solo guarda ids falsos.
// /api-falsa/cortar?segundos=N la deja sin responder N segundos, como si no
// hubiera conexión (para probar la cola offline).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const args = process.argv.slice(2);
const FALSA = args.includes('--falsa');
const PUERTO = Number(args[args.indexOf('--puerto') + 1]) || Number(process.env.PORT) || 4173;
const RAIZ = path.join(__dirname, '..', 'app');
const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function enviarArchivo(res, archivo) {
  fs.readFile(archivo, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No existe');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(contenido);
  });
}

/** Ruta pedida → archivo dentro de `raiz`, o null si intenta salirse. */
function dentroDe(raiz, ruta) {
  let archivo;
  try {
    archivo = path.join(raiz, decodeURIComponent(ruta));
  } catch {
    return null;
  }
  return archivo.startsWith(raiz + path.sep) || archivo === raiz ? archivo : null;
}

// Los datos de la API falsa, en memoria: las ediciones los cambian.
let datosFalsos = null;
const datos = () => (datosFalsos ||= JSON.parse(fs.readFileSync(path.join(FIXTURES, 'todo.json'), 'utf8')));
let cortadaHasta = 0;
const EDICIONES = ['receta.estado', 'receta.porciones', 'receta.ingredientes', 'nota.agregar',
  'compras.agregar', 'compras.marcar', 'compras.mover', 'compras.quitar', 'lugares.asignar', 'bandeja.actualizar'];

/** API falsa: mismas respuestas que la de Apps Script, con un poco de demora. */
async function apiFalsa(req, url, res) {
  // Sin conexión: se corta sin responder, y fetch falla como en el celular.
  if (Date.now() < cortadaHasta) return req.socket.destroy();
  const responder = cuerpo => setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(cuerpo));
  }, 600);
  const q = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') {
    let cuerpo = '';
    for await (const parte of req) cuerpo += parte;
    try {
      Object.assign(q, JSON.parse(cuerpo));
    } catch {
      return responder({ ok: false, error: 'cuerpo_invalido', mensaje: 'El cuerpo tiene que ser JSON.', status: 400 });
    }
  }
  if (q.t !== 'prueba') {
    return responder({ ok: false, error: 'token_invalido', mensaje: 'Token inválido. Revisá la configuración.', status: 401 });
  }
  const ahora = new Date().toISOString();
  if (q.action === 'ping') return responder({ ok: true, data: { version: 'falsa', ahora, mensaje: 'Conectado' } });
  if (req.method === 'POST' && EDICIONES.includes(q.action)) return responder(await editarFalsa(q, ahora));
  if (req.method === 'POST' && q.action === 'capturas.subir') return responder(subirFalsa(q, ahora));
  if (q.action !== 'todo') {
    return responder({ ok: false, error: 'accion_desconocida', mensaje: 'La API falsa no conoce «' + q.action + '».', status: 404 });
  }
  const todo = datos();
  const since = q.since;
  if (!since) return responder({ ok: true, data: Object.assign({}, todo, { ahora, completo: true }) });
  const desde = Date.parse(since);
  const cambio = v => Date.parse(v) > desde;
  const recetas = todo.recetas.filter(r => cambio(r.actualizado));
  const ids = new Set(recetas.map(r => r.id));
  responder({
    ok: true,
    data: {
      ahora,
      completo: false,
      recetas,
      ingredientes: todo.ingredientes.filter(i => ids.has(i.receta_id)),
      pasos: todo.pasos.filter(p => ids.has(p.receta_id)),
      notas: todo.notas.filter(n => cambio(n.creado || n.fecha)),
      compras: todo.compras,
      lugares: todo.lugares || [],
      bandeja: todo.bandeja.filter(b => cambio(b.actualizado)),
    },
  });
}

/**
 * Una edición de la app, aplicada con la misma lógica que usa la app para verla
 * al instante (app/js/ediciones.js), más lo que agrega la API: `actualizado` y `creado`.
 */
async function editarFalsa(pedido, ahora) {
  const { aplicarEdicion } = await import(pathToFileURL(path.join(RAIZ, 'js', 'ediciones.js')).href);
  const { action, t, ...cuerpo } = pedido;
  const recetaId = action === 'nota.agregar' || action === 'compras.agregar' ? cuerpo.receta_id
    : action.startsWith('receta.') ? cuerpo.id : '';
  const todo = datos();
  if (recetaId && !todo.recetas.some(r => r.id === recetaId)) {
    return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la receta «' + recetaId + '».', status: 404 };
  }
  if (action === 'bandeja.actualizar' && !todo.bandeja.some(b => b.id === cuerpo.id)) {
    return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la fila «' + cuerpo.id + '» en la bandeja.', status: 404 };
  }
  datosFalsos = aplicarEdicion(todo, { accion: action, datos: cuerpo });
  const tocar = (lista, id, campos) => lista.map(x => (x.id === id ? Object.assign({}, x, campos) : x));
  if (action === 'nota.agregar') {
    datosFalsos.notas = datosFalsos.notas.map(n => (n.id === cuerpo.id && !n.creado ? Object.assign({}, n, { creado: ahora }) : n));
  } else if (action.startsWith('receta.')) {
    datosFalsos.recetas = tocar(datosFalsos.recetas, recetaId, { actualizado: ahora });
  } else if (action === 'bandeja.actualizar') {
    datosFalsos.bandeja = tocar(datosFalsos.bandeja, cuerpo.id, { actualizado: ahora });
  } else if (action === 'compras.agregar') {
    datosFalsos.compras = datosFalsos.compras.map(c => (c.creado ? c : Object.assign({}, c, { creado: ahora })));
  }
  const detalle = recetaId || cuerpo.id || (cuerpo.ids || []).join(',') || cuerpo.clave || (cuerpo.items || []).map(i => i.nombre).join(', ');
  console.log('API falsa: ' + action + ' ' + detalle);
  return { ok: true, data: { id: cuerpo.id || recetaId } };
}

/** capturas.subir: deja la fila pendiente con ids falsos (las imágenes no se guardan). */
function subirFalsa(q, ahora) {
  const todo = datos();
  const fila = todo.bandeja.find(b => b.id === q.bandeja_id);
  if (!fila) return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la fila «' + q.bandeja_id + '» en la bandeja.', status: 404 };
  if (fila.estado === 'lista' || fila.estado === 'procesando') {
    return { ok: false, error: fila.estado === 'lista' ? 'ya_lista' : 'procesando', mensaje: 'La fila está ' + fila.estado + '.', status: 409 };
  }
  const imagenes = Array.isArray(q.imagenes) ? q.imagenes : [];
  if (!imagenes.length) return { ok: false, error: 'sin_imagenes', mensaje: 'Falta al menos una captura.', status: 400 };
  const ids = imagenes.map((_, i) => 'falsa-' + q.lote + '-' + (i + 1));
  const todas = [...new Set(String(fila.capturas || '').split(',').filter(Boolean).concat(ids))];
  datosFalsos = Object.assign({}, todo, { bandeja: todo.bandeja.map(b => (b.id === fila.id
    ? Object.assign({}, b, { capturas: todas.join(','), estado: 'pendiente', motivo: '', intentos: 0, actualizado: ahora })
    : b)) });
  const kb = Math.round(imagenes.reduce((n, img) => n + String(img.base64 || '').length * 0.75, 0) / 1024);
  console.log('API falsa: capturas.subir ' + fila.id + ' (' + imagenes.length + ' imágenes, ' + kb + ' KB)');
  return { ok: true, data: { id: fila.id, estado: 'pendiente', capturas: todas.length } };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (FALSA && url.pathname === '/api-falsa/cortar') {
    cortadaHasta = Date.now() + (Number(url.searchParams.get('segundos')) || 30) * 1000;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('API falsa sin conexión hasta las ' + new Date(cortadaHasta).toLocaleTimeString('es-AR') + '\n');
  }
  if (FALSA && url.pathname === '/api-falsa') {
    return apiFalsa(req, url, res).catch(err => {
      console.error(err);
      res.writeHead(500).end();
    });
  }
  if (FALSA && url.pathname.startsWith('/fotos-prueba/')) {
    const archivo = dentroDe(path.join(FIXTURES, 'fotos'), url.pathname.slice('/fotos-prueba/'.length));
    return archivo ? enviarArchivo(res, archivo) : res.writeHead(403).end();
  }
  const archivo = dentroDe(RAIZ, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname);
  if (!archivo) return res.writeHead(403).end();
  enviarArchivo(res, archivo);
}).listen(PUERTO, () => {
  console.log(`A ojo en http://localhost:${PUERTO}/` + (FALSA ? ' (con la API falsa en /api-falsa)' : ''));
  if (FALSA) {
    const api = encodeURIComponent(`http://localhost:${PUERTO}/api-falsa`);
    console.log(`Link de configuración de prueba: http://localhost:${PUERTO}/#/config?api=${api}&t=prueba&quien=camilo`);
  }
});
