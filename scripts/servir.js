#!/usr/bin/env node
// Servidor local de la PWA (app/), sin dependencias.
//
//   node scripts/servir.js [--falsa] [--vacia] [--puerto 4173]
//
// Con --falsa también responde una API de prueba en /api-falsa con los datos de
// tests/fixtures/todo.json, y sirve sus fotos en /fotos-prueba/. Así la app se
// prueba sin el token real. El token de la API falsa es «prueba»:
//   http://localhost:4173/#/config?api=http%3A%2F%2Flocalhost%3A4173%2Fapi-falsa&t=prueba&quien=camilo
//
// La API falsa responde ping y todo, y acepta las ediciones de la app (POST),
// capturar (con la normalización de apps-script/src/Url.js) y capturas.subir: las guarda en memoria, así `todo` las devuelve, hasta que se
// reinicia el servidor. De las capturas solo guarda ids falsos.
// /api-falsa/cortar?segundos=N la deja sin responder N segundos, como si no
// hubiera conexión (para probar la cola offline), y /api-falsa/demorar?segundos=N
// hace que cada respuesta tarde N segundos (para ver la primera carga; 0 vuelve a lo normal).
// /api-falsa/bandeja?id=…&estado=lista cambia una fila a mano, como si la Mac la hubiera
// procesado (para probar el `desde` de bandeja.actualizar).
// Para `/recetas --dry-run` (con A_OJO_API_URL apuntando acá y A_OJO_TOKEN=prueba) responde
// bandeja.pendientes, bandeja.fila y receta.upsert solo con `validar`, con la validación de
// verdad (validarReceta_ de apps-script/src, cargado como en los tests). No guarda recetas.
// Con --vacia arranca sin recetas, compras ni bandeja (para ver las pantallas vacías).
// Escucha solo en 127.0.0.1: la API falsa acepta cualquier edición y no tiene que verse desde la red.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const args = process.argv.slice(2);
const FALSA = args.includes('--falsa');
const VACIA = args.includes('--vacia');
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
// Con --vacia quedan solo las reglas de Lugares, que setup() siembra siempre.
const VACIOS = { recetas: [], ingredientes: [], pasos: [], notas: [], compras: [], despensa: [], bandeja: [] };
const datos = () => (datosFalsos ||= Object.assign(
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'todo.json'), 'utf8')), VACIA ? VACIOS : {}));
let cortadaHasta = 0;
let demoraMs = 600;
const EDICIONES = ['receta.estado', 'receta.porciones', 'receta.ingredientes', 'nota.agregar',
  'compras.agregar', 'compras.marcar', 'compras.mover', 'compras.quitar', 'lugares.asignar', 'bandeja.actualizar', 'receta.corregir', 'nota.editar', 'nota.borrar',
  'despensa.sumar', 'despensa.quitar', 'receta.crear', 'receta.editar', 'receta.escribir'];

/** API falsa: mismas respuestas que la de Apps Script, con un poco de demora. */
async function apiFalsa(req, url, res) {
  // Sin conexión: se corta sin responder, y fetch falla como en el celular.
  if (Date.now() < cortadaHasta) return req.socket.destroy();
  const responder = cuerpo => setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(cuerpo));
  }, demoraMs);
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
  if (req.method === 'POST' && q.action === 'capturar') return responder(capturarFalsa(q, ahora));
  if (req.method === 'POST' && q.action === 'receta.upsert') return responder(upsertFalso(q));
  if (req.method === 'GET' && q.action === 'bandeja.pendientes') {
    // Como paraProcesar_ (sin las trabadas: acá nadie procesa de verdad), de la más vieja a la más nueva.
    const filas = datos().bandeja.filter(b => b.estado === 'pendiente').sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
    return responder({ ok: true, data: { filas } });
  }
  if (req.method === 'GET' && q.action === 'bandeja.fila') {
    const fila = datos().bandeja.find(b => b.id === q.id);
    return responder(fila ? { ok: true, data: { fila } }
      : { ok: false, error: 'no_encontrada', mensaje: 'No encontré la fila «' + q.id + '» en la bandeja.', status: 404 });
  }
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
      notas: todo.notas.filter(n => cambio(n.creado || n.fecha) || (n.actualizado && cambio(n.actualizado))),
      compras: todo.compras,
      lugares: todo.lugares || [],
      despensa: todo.despensa || [],
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
  // receta.crear es la única de receta.* que llega antes de que la receta exista.
  if (recetaId && action !== 'receta.crear' && !todo.recetas.some(r => r.id === recetaId)) {
    return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la receta «' + recetaId + '».', status: 404 };
  }
  if ((action === 'receta.editar' || action === 'receta.escribir') && todo.recetas.find(r => r.id === recetaId).plataforma !== 'manual') {
    return { ok: false, error: 'no_propia', mensaje: 'Solo las recetas nuestras se editan o escriben en la app.', status: 400 };
  }
  if (action === 'bandeja.actualizar') {
    const fila = todo.bandeja.find(b => b.id === cuerpo.id);
    if (!fila) return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la fila «' + cuerpo.id + '» en la bandeja.', status: 404 };
    // Como la API: con `desde`, si la fila cambió mientras tanto, 409 y no se toca.
    if (cuerpo.desde && fila.estado !== cuerpo.desde && fila.estado !== cuerpo.estado) {
      console.log('API falsa: bandeja.actualizar ' + fila.id + ' rechazada (está ' + fila.estado + ')');
      return { ok: false, error: 'estado_cambio', mensaje: 'Ese link ya está «' + fila.estado + '»: no lo cambié.', status: 409 };
    }
  }
  if (action === 'nota.editar' || action === 'nota.borrar') {
    const nota = todo.notas.find(n => n.id === cuerpo.id);
    if (!nota) return { ok: false, error: 'no_encontrada', mensaje: 'No encontré esa nota: puede que la hayan borrado.', status: 404 };
    if (action === 'nota.editar' && nota.borrada) return { ok: false, error: 'nota_borrada', mensaje: 'Esa nota ya estaba borrada: no la cambié.', status: 409 };
  }
  if (action === 'receta.corregir') {
    const suya = todo.bandeja.filter(b => b.receta_id === recetaId).sort((a, b) => String(b.creado).localeCompare(String(a.creado)))[0];
    if (suya && suya.estado === 'procesando') {
      return { ok: false, error: 'procesando', mensaje: 'Esa receta se está procesando justo ahora. Probá de nuevo en un rato.', status: 409 };
    }
    // Como la API: una propia sin ordenar (o con un texto esperando) se corrige cambiando el texto.
    const propia = todo.recetas.find(r => r.id === recetaId).plataforma === 'manual';
    const ordenada = (todo.ingredientes || []).some(i => i.receta_id === recetaId);
    const esperaTexto = suya && !String(suya.pedido || '').trim() && (suya.estado === 'pendiente' || suya.estado === 'ayuda');
    if (propia && String(cuerpo.texto || '').trim() && (!ordenada || esperaTexto)) {
      return { ok: false, error: 'texto_pendiente', mensaje: 'Esa receta todavía no está ordenada: cambiá el texto en lugar de pedir una corrección.', status: 409 };
    }
  }
  // Las filas nuevas (las de receta.corregir) llevan el id de la edición: acá se les pone uno de la Sheet.
  const nuevaId = 'b_' + String(todo.bandeja.length + 90000);
  datosFalsos = aplicarEdicion(todo, { id: nuevaId, accion: action, datos: cuerpo, creada: ahora });
  const tocar = (lista, id, campos) => lista.map(x => (x.id === id ? Object.assign({}, x, campos) : x));
  if (action === 'receta.corregir') {
    const antes = new Map(todo.bandeja.map(b => [b.id, b]));
    datosFalsos.bandeja = datosFalsos.bandeja.map(b => (antes.get(b.id) === b ? b : Object.assign({}, b, { local: undefined, actualizado: ahora })));
    const fila = datosFalsos.bandeja.filter(b => b.receta_id === recetaId).sort((a, b) => String(b.creado).localeCompare(String(a.creado)))[0];
    console.log('API falsa: receta.corregir ' + recetaId + ' → ' + (fila ? fila.id + ' ' + fila.estado + ' «' + (fila.pedido || '') + '»' : 'sin fila'));
    return { ok: true, data: { id: fila ? fila.id : null, receta_id: recetaId, estado: fila ? fila.estado : null, pedido: fila ? fila.pedido || '' : '' } };
  }
  if (action === 'nota.editar' || action === 'nota.borrar') {
    datosFalsos.notas = tocar(datosFalsos.notas, cuerpo.id, { actualizado: ahora });
  } else if (action === 'nota.agregar') {
    datosFalsos.notas = datosFalsos.notas.map(n => (n.id === cuerpo.id && !n.creado ? Object.assign({}, n, { creado: ahora }) : n));
  } else if (action.startsWith('receta.')) {
    datosFalsos.recetas = tocar(datosFalsos.recetas, recetaId, { actualizado: ahora });
    // La fila que crearon o cambiaron receta.crear y receta.escribir llega en el próximo delta.
    if (action === 'receta.crear' || action === 'receta.escribir') {
      const antes = new Map(todo.bandeja.map(b => [b.id, b]));
      // aplicarEdicion() la deja `local` (provisoria, en el celular): acá ya es la de la Sheet.
      datosFalsos.bandeja = datosFalsos.bandeja.map(b => (antes.get(b.id) === b ? b : Object.assign({}, b, { local: undefined, actualizado: ahora })));
      const fila = datosFalsos.bandeja.find(b => b.id === cuerpo.bandeja_id) ||
        datosFalsos.bandeja.filter(b => b.receta_id === recetaId).sort((a, b) => String(b.creado).localeCompare(String(a.creado)))[0];
      console.log('API falsa: ' + action + ' ' + recetaId + (fila ? ' → ' + fila.id + ' ' + fila.estado : ''));
      return { ok: true, data: { id: recetaId, bandeja_id: fila ? fila.id : null } };
    }
  } else if (action === 'bandeja.actualizar') {
    datosFalsos.bandeja = tocar(datosFalsos.bandeja, cuerpo.id, { actualizado: ahora });
  } else if (action === 'compras.agregar') {
    datosFalsos.compras = datosFalsos.compras.map(c => (c.creado ? c : Object.assign({}, c, { creado: ahora })));
  }
  const detalle = recetaId || cuerpo.id || (cuerpo.ids || []).join(',') || cuerpo.clave || (cuerpo.items || []).map(i => i.nombre).join(', ');
  console.log('API falsa: ' + action + ' ' + detalle);
  return { ok: true, data: { id: cuerpo.id || recetaId } };
}

// La API de Apps Script cargada como en los tests: solo para validar recetas con su código de verdad.
let proyecto = null;
const apiDeVerdad = () => (proyecto ||= require('../tests/fakes/apps-script.js').cargarProyecto()).ctx;

/**
 * receta.upsert, solo con `validar` (lo que usa /recetas --dry-run): busca la receta como la API
 * (por id o por la fila) para saber si es propia, y valida con validarReceta_ y ecoPasos_ de Acciones.js.
 */
function upsertFalso(q) {
  if (!(q.validar === true || q.validar === 'true')) {
    return { ok: false, error: 'solo_validar', mensaje: 'La API falsa no guarda recetas: probá con --dry-run.', status: 400 };
  }
  const r = q.receta;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'sin_receta', mensaje: 'Falta «receta».', status: 400 };
  const todo = datos();
  const fila = q.bandeja_id ? todo.bandeja.find(b => b.id === q.bandeja_id) : null;
  if (q.bandeja_id && !fila) return { ok: false, error: 'no_encontrada', mensaje: 'No encontré la fila «' + q.bandeja_id + '» en la bandeja.', status: 404 };
  const existente = (r.id && todo.recetas.find(x => x.id === r.id)) || (fila && todo.recetas.find(x => x.id === fila.receta_id)) || null;
  const api = apiDeVerdad();
  try {
    const v = api.validarReceta_(r, existente && existente.plataforma === 'manual' ? existente : null);
    console.log('API falsa: receta.upsert (validar) ' + (q.bandeja_id || r.id || '') + ' → válida');
    return { ok: true, data: Object.assign({ validar: true, id: existente ? existente.id : null, nueva: !existente,
      mensaje: 'La receta es válida', ingredientes: v.ingredientes.length, pasos: v.pasos.length }, api.ecoPasos_(v)) };
  } catch (err) {
    console.log('API falsa: receta.upsert (validar) → ' + err.message);
    return { ok: false, error: err.codigo || 'error_interno', mensaje: err.message, detalles: err.detalles, status: err.status || 500 };
  }
}

/** capturar: como accionCapturar_ (Acciones.js), deduplica por la URL normalizada. */
function capturarFalsa(q, ahora) {
  const { normalizarUrl } = require('../apps-script/src/Url.js');
  if (!['camilo', 'pareja'].includes(q.quien)) return { ok: false, error: 'quien_invalido', mensaje: '«quien» tiene que ser camilo o pareja.', status: 400 };
  const norm = normalizarUrl(q.url);
  if (!norm) return { ok: false, error: 'sin_url', mensaje: 'No encontré un link en lo que mandaste.', status: 400 };
  const todo = datos();
  const clave = url => (normalizarUrl(url) || { clave: url }).clave;
  const existente = todo.bandeja.find(b => clave(b.url) === norm.clave);
  if (existente) {
    if (existente.estado === 'descartada') {
      datosFalsos = Object.assign({}, todo, { bandeja: todo.bandeja.map(b => (b === existente
        ? Object.assign({}, b, { estado: 'pendiente', motivo: '', intentos: 0, actualizado: ahora }) : b)) });
    }
    console.log('API falsa: capturar ' + norm.url + ' (duplicada: ' + existente.id + ')');
    return { ok: true, data: { duplicada: true, id: existente.id, estado: existente.estado === 'descartada' ? 'pendiente' : existente.estado, mensaje: 'Ya estaba guardada' } };
  }
  const id = 'b_' + String(todo.bandeja.length + 90000);
  datosFalsos = Object.assign({}, todo, { bandeja: todo.bandeja.concat({ id, creado: ahora, url: norm.url, plataforma: norm.plataforma,
    quien: q.quien, estado: 'pendiente', motivo: '', receta_id: '', intentos: 0, actualizado: ahora, capturas: '' }) });
  console.log('API falsa: capturar ' + norm.url + ' → ' + id);
  return { ok: true, data: { id, estado: 'pendiente', mensaje: '✓ Guardada' } };
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
  if (FALSA && url.pathname === '/api-falsa/bandeja') {
    // Cambia una fila a mano, como si la Mac la hubiera procesado: /api-falsa/bandeja?id=b_00075&estado=lista
    const id = url.searchParams.get('id');
    const estado = url.searchParams.get('estado');
    const todo = datos();
    if (!todo.bandeja.some(b => b.id === id) || !estado) return res.writeHead(404).end('No existe esa fila (o falta estado)\n');
    datosFalsos = Object.assign({}, todo, { bandeja: todo.bandeja.map(b => (b.id === id
      ? Object.assign({}, b, { estado, motivo: '', actualizado: new Date().toISOString() }) : b)) });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Fila ' + id + ' en «' + estado + '»\n');
  }
  if (FALSA && url.pathname === '/api-falsa/demorar') {
    const segundos = Number(url.searchParams.get('segundos'));
    demoraMs = segundos > 0 ? segundos * 1000 : 600;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('La API falsa responde en ' + demoraMs / 1000 + ' s\n');
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
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`A ojo en http://localhost:${PUERTO}/` + (FALSA ? ' (con la API falsa en /api-falsa' + (VACIA ? ', sin datos)' : ')') : ''));
  if (FALSA) {
    const api = encodeURIComponent(`http://localhost:${PUERTO}/api-falsa`);
    console.log(`Link de configuración de prueba: http://localhost:${PUERTO}/#/config?api=${api}&t=prueba&quien=camilo`);
  }
});
