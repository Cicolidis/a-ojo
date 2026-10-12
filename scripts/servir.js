#!/usr/bin/env node
// Servidor local de la PWA (app/), sin dependencias.
//
//   node scripts/servir.js [--falsa] [--puerto 4173]
//
// Con --falsa también responde una API de prueba en /api-falsa (ping y todo) con
// los datos de tests/fixtures/todo.json, y sirve sus fotos en /fotos-prueba/.
// Así la app se prueba sin el token real. El token de la API falsa es «prueba»:
//   http://localhost:4173/#/config?api=http%3A%2F%2Flocalhost%3A4173%2Fapi-falsa&t=prueba&quien=camilo

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

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

/** API falsa: mismas respuestas que la de Apps Script, con un poco de demora. */
function apiFalsa(url, res) {
  const responder = cuerpo => setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(cuerpo));
  }, 600);
  const q = url.searchParams;
  if (q.get('t') !== 'prueba') {
    return responder({ ok: false, error: 'token_invalido', mensaje: 'Token inválido. Revisá la configuración.', status: 401 });
  }
  const ahora = new Date().toISOString();
  if (q.get('action') === 'ping') return responder({ ok: true, data: { version: 'falsa', ahora, mensaje: 'Conectado' } });
  if (q.get('action') !== 'todo') {
    return responder({ ok: false, error: 'accion_desconocida', mensaje: 'La API falsa solo sabe ping y todo.', status: 404 });
  }
  const todo = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'todo.json'), 'utf8'));
  const since = q.get('since');
  if (!since) return responder({ ok: true, data: Object.assign(todo, { ahora, completo: true }) });
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
      notas: todo.notas.filter(n => cambio(n.fecha)),
      compras: todo.compras,
      bandeja: todo.bandeja.filter(b => cambio(b.actualizado)),
    },
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (FALSA && url.pathname === '/api-falsa') return apiFalsa(url, res);
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
