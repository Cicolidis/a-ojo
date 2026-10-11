const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cargarProyecto } = require('./fakes/apps-script.js');

function leer(salida) {
  return salida.mime === 'application/json' ? JSON.parse(salida.contenido) : salida.contenido;
}

/** Proyecto recién preparado con setup(), más atajos para llamar a la API. */
function proyecto() {
  const p = cargarProyecto();
  p.ctx.setup();
  const token = p.propiedades.get('TOKEN');
  return Object.assign(p, {
    token,
    get: parametros => leer(p.ctx.doGet({ parameter: parametros })),
    postJson: (cuerpo, query = {}) => leer(p.ctx.doPost({
      parameter: query,
      postData: { type: 'text/plain', contents: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) },
    })),
    // Como HTTP Shortcuts: form-urlencoded; Apps Script mezcla query y cuerpo en e.parameter.
    postForm: (campos, query = {}) => leer(p.ctx.doPost({
      parameter: Object.assign({}, query, campos),
      postData: { type: 'application/x-www-form-urlencoded', contents: new URLSearchParams(campos).toString() },
    })),
    capturar(url, quien = 'camilo') {
      return this.postJson({ action: 'capturar', t: token, url, quien });
    },
    filas(nombre) {
      const [enc, ...resto] = p.planilla.getSheetByName(nombre).getDataRange().getValues();
      return resto.filter(f => f[0] !== '').map(f => Object.fromEntries(enc.map((h, i) => [h, f[i]])));
    },
  });
}

test('setup crea las 6 hojas en orden, con encabezados, y borra la hoja por defecto', () => {
  const p = proyecto();
  assert.deepEqual(p.planilla.getSheets().map(h => h.getName()),
    ['Bandeja', 'Recetas', 'Ingredientes', 'Pasos', 'Notas', 'Compras']);
  const enc = p.planilla.getSheetByName('Bandeja').getRange(1, 1, 1, 10).getValues()[0];
  assert.deepEqual(enc, ['id', 'creado', 'url', 'plataforma', 'quien', 'estado', 'motivo', 'receta_id', 'intentos', 'actualizado']);
  assert.equal(p.planilla.getSheetByName('Recetas').getLastColumn(), 18);
  assert.match(p.token, /^[0-9a-f]{32}$/);
  assert.ok(p.registro.some(l => l.includes(p.token)), 'el token aparece en el registro');
});

test('setup es idempotente y suma columnas nuevas sin tocar datos', () => {
  const p = proyecto();
  p.capturar('https://youtube.com/shorts/cyTOswdJ4TY');
  const token = p.token;
  p.evaluar("ESQUEMA.Bandeja.columnas.push({ nombre: 'capturas', tipo: 'texto' })");
  p.ctx.setup();
  assert.equal(p.propiedades.get('TOKEN'), token, 'no cambia el token');
  const bandeja = p.planilla.getSheetByName('Bandeja');
  assert.equal(bandeja.getLastColumn(), 11);
  assert.equal(bandeja.getRange(1, 11).getValues()[0][0], 'capturas');
  assert.equal(p.filas('Bandeja').length, 1);
});

test('token: sin token o con uno incorrecto responde 401', () => {
  const p = proyecto();
  const sin = p.get({ action: 'ping' });
  assert.equal(sin.ok, false);
  assert.equal(sin.status, 401);
  assert.equal(sin.error, 'token_invalido');
  assert.equal(p.postJson({ action: 'capturar', t: 'otro', url: 'https://example.com', quien: 'camilo' }).status, 401);
  const ok = p.get({ action: 'ping', t: p.token });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.hojas_faltantes, []);
});

test('acción desconocida (404), método incorrecto (405) y cuerpo inválido (400)', () => {
  const p = proyecto();
  assert.equal(p.get({ action: 'nada', t: p.token }).status, 404);
  assert.equal(p.get({ action: 'capturar', t: p.token, url: 'https://example.com', quien: 'camilo' }).status, 405);
  assert.equal(p.postJson('{no es json', { action: 'capturar', t: p.token }).status, 400);
});

test('capturar guarda una fila pendiente, normalizada y con fechas como texto', () => {
  const p = proyecto();
  const r = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY?si=abc123');
  assert.equal(r.ok, true);
  assert.match(r.data.id, /^b_[0-9a-z]{5}$/);
  assert.equal(r.data.estado, 'pendiente');
  assert.equal(r.data.duplicada, undefined);

  const [fila] = p.filas('Bandeja');
  assert.equal(fila.url, 'https://www.youtube.com/shorts/cyTOswdJ4TY');
  assert.equal(fila.plataforma, 'youtube');
  assert.equal(fila.quien, 'camilo');
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.intentos, 0);
  assert.equal(typeof fila.creado, 'string', 'Sheets no la convirtió en fecha');
  assert.match(fila.creado, /^\d{4}-\d{2}-\d{2}T/);
});

test('capturar no duplica: mismo video con otro ?si=, otro formato de link o texto alrededor', () => {
  const p = proyecto();
  const id = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY?si=uno').data.id;
  for (const variante of [
    'https://youtube.com/shorts/cyTOswdJ4TY?si=dos',
    'https://youtu.be/cyTOswdJ4TY',
    'Mirá esto https://m.youtube.com/shorts/cyTOswdJ4TY?feature=share',
  ]) {
    const r = p.capturar(variante);
    assert.equal(r.data.duplicada, true, variante);
    assert.equal(r.data.id, id);
  }
  assert.equal(p.filas('Bandeja').length, 1);
});

test('capturar valida quien y que haya un link', () => {
  const p = proyecto();
  assert.equal(p.capturar('https://example.com', 'otra').error, 'quien_invalido');
  assert.equal(p.capturar('hola, sin link').error, 'sin_url');
  assert.equal(p.filas('Bandeja').length, 0);
});

test('capturar desde HTTP Shortcuts: form-urlencoded y respuesta en texto', () => {
  const p = proyecto();
  const query = { action: 'capturar', formato: 'texto' };
  const campos = { url: 'Mirá este reel https://www.instagram.com/reel/Ddthx0exm4L/?igsh=MWx4 "qué rico"', quien: 'pareja', t: p.token };
  assert.equal(p.postForm(campos, query), '✓ Guardada');
  assert.equal(p.postForm(campos, query), 'Ya estaba guardada');
  assert.equal(p.postForm(Object.assign({}, campos, { t: 'mal' }), query), 'Token inválido. Revisá la configuración.');
  const [fila] = p.filas('Bandeja');
  assert.equal(fila.url, 'https://www.instagram.com/reel/Ddthx0exm4L/');
  assert.equal(fila.quien, 'pareja');
  assert.equal(p.filas('Bandeja').length, 1);
});

test('bandeja.actualizar: intentos, motivo solo en ayuda, validaciones', () => {
  const p = proyecto();
  const id = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  const act = cuerpo => p.postJson(Object.assign({ action: 'bandeja.actualizar', t: p.token, id }, cuerpo));

  assert.equal(act({ estado: 'procesando' }).data.intentos, 1);
  assert.equal(act({ estado: 'ayuda', motivo: 'Instagram pide iniciar sesión' }).ok, true);
  assert.equal(p.filas('Bandeja')[0].motivo, 'Instagram pide iniciar sesión');
  assert.equal(act({ estado: 'procesando' }).data.intentos, 2);
  assert.equal(p.filas('Bandeja')[0].motivo, '', 'el motivo se borra al salir de ayuda');
  assert.equal(act({ estado: 'lista', receta_id: 'r_abc12' }).ok, true);
  assert.equal(p.filas('Bandeja')[0].receta_id, 'r_abc12');

  assert.equal(act({ estado: 'cualquiera' }).error, 'estado_invalido');
  assert.equal(act({ estado: 'lista', id: 'b_nada0' }).status, 404);
});

test('volver a guardar un link descartado lo devuelve a pendiente', () => {
  const p = proyecto();
  const id = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'procesando' });
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'descartada' });
  const r = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk?si=otra');
  assert.equal(r.data.duplicada, true);
  assert.equal(r.data.estado, 'pendiente');
  assert.equal(p.filas('Bandeja')[0].intentos, 0);
});

test('bandeja.pendientes devuelve solo pendientes, de la más vieja a la más nueva', () => {
  const p = proyecto();
  const a = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY').data.id;
  const b = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  const c = p.capturar('https://www.instagram.com/reel/Ddthx0exm4L/').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id: b, estado: 'procesando' });
  const r = p.get({ action: 'bandeja.pendientes', t: p.token });
  assert.deepEqual(r.data.filas.map(f => f.id), [a, c]);
});

test('todo: completo sin since; con since solo lo cambiado (compras siempre entera)', async () => {
  const p = proyecto();
  const id = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY').data.id;

  const completo = p.get({ action: 'todo', t: p.token });
  assert.equal(completo.data.completo, true);
  assert.equal(completo.data.bandeja.length, 1);
  for (const k of ['recetas', 'ingredientes', 'pasos', 'notas', 'compras']) assert.deepEqual(completo.data[k], []);

  const desde = completo.data.ahora;
  await new Promise(r => setTimeout(r, 5));
  assert.equal(p.get({ action: 'todo', t: p.token, since: desde }).data.bandeja.length, 0);

  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'procesando' });
  const delta = p.get({ action: 'todo', t: p.token, since: desde });
  assert.equal(delta.data.completo, false);
  assert.deepEqual(delta.data.bandeja.map(b => b.id), [id]);

  assert.equal(p.get({ action: 'todo', t: p.token, since: 'ayer' }).error, 'since_invalido');
});
