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
    /** Cambia celdas de una fila a mano, como si alguien editara la Sheet. */
    editar(nombre, id, cambios) {
      const hoja = p.planilla.getSheetByName(nombre);
      const [enc, ...resto] = hoja.getDataRange().getValues();
      const fila = resto.findIndex(f => f[0] === id) + 2;
      assert.ok(fila > 1, 'existe la fila ' + id);
      for (const [h, v] of Object.entries(cambios)) hoja.getRange(fila, enc.indexOf(h) + 1).setValues([[v]]);
    },
    upsert(receta, extra = {}) {
      return this.postJson(Object.assign({ action: 'receta.upsert', t: token, receta }, extra));
    },
  });
}

/** Una receta válida, como la que arma /recetas. */
function receta(cambios = {}) {
  return Object.assign({
    titulo: 'Brownie húmedo',
    tipo: 'dulce',
    etiquetas: ['rápida', 'para invitados'],
    porciones: 12,
    tiempo_min: 45,
    molde: '20×20 cm',
    autor: '@alguien',
    fuente_url: 'https://youtube.com/shorts/a2qRJHVeJwk?si=xyz',
    confianza: 'alta',
    origen_datos: ['descripcion', 'subtitulos'],
    idioma_original: 'es',
    notas_proceso: '«harina 4» → harina 0000',
    ingredientes: [
      { cantidad: 200, unidad: 'g', nombre: 'chocolate semiamargo', gondola: 'almacén' },
      { cantidad: 150, unidad: 'g', nombre: 'manteca', nota: 'pomada', gondola: 'lácteos y huevos' },
      { cantidad: 3, unidad: 'u', nombre: 'huevos', gondola: 'lácteos y huevos' },
      { cantidad: null, unidad: 'a ojo', nombre: 'sal', gondola: 'almacén' },
    ],
    pasos: [
      { texto: 'Derretí el chocolate con la manteca.' },
      { texto: 'Sumá los huevos y batí.', tip: 'De a uno.' },
      { texto: 'Horneá a 180 °C.', timer_min: 25 },
    ],
  }, cambios);
}

// Un JPEG mínimo en base64 (solo importa que decodifique).
const FOTO = { base64: Buffer.from('foto de prueba').toString('base64'), mime: 'image/jpeg' };

test('setup crea las 6 hojas en orden, con encabezados, y borra la hoja por defecto', () => {
  const p = proyecto();
  assert.deepEqual(p.planilla.getSheets().map(h => h.getName()),
    ['Bandeja', 'Recetas', 'Ingredientes', 'Pasos', 'Notas', 'Compras']);
  const enc = p.planilla.getSheetByName('Bandeja').getRange(1, 1, 1, 10).getValues()[0];
  assert.deepEqual(enc, ['id', 'creado', 'url', 'plataforma', 'quien', 'estado', 'motivo', 'receta_id', 'intentos', 'actualizado']);
  assert.equal(p.planilla.getSheetByName('Recetas').getLastColumn(), 19);
  assert.match(p.token, /^[0-9a-f]{32}$/);
  assert.ok(p.registro.some(l => l.includes(p.token)), 'el token aparece en el registro');
});

test('setup crea la carpeta "A ojo/fotos" una sola vez', () => {
  const p = proyecto();
  const id = p.propiedades.get('CARPETA_FOTOS');
  const [aOjo] = p.drive.raiz.carpetas;
  assert.equal(aOjo.nombre, 'A ojo');
  assert.equal(aOjo.carpetas[0].nombre, 'fotos');
  assert.equal(aOjo.carpetas[0].id, id);
  p.ctx.setup();
  assert.equal(p.propiedades.get('CARPETA_FOTOS'), id);
  assert.equal(p.drive.raiz.carpetas.length, 1);
  assert.equal(aOjo.carpetas.length, 1);

  // Si la mandan a la papelera, se crea otra.
  aOjo.carpetas[0].setTrashed(true);
  p.ctx.setup();
  assert.notEqual(p.propiedades.get('CARPETA_FOTOS'), id);
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

test('bandeja.pendientes suma las filas trabadas en procesando', () => {
  const p = proyecto();
  const a = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY').data.id;
  const b = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id: a, estado: 'procesando' });
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id: b, estado: 'procesando' });
  const pendientes = () => p.get({ action: 'bandeja.pendientes', t: p.token }).data.filas.map(f => f.id);
  assert.deepEqual(pendientes(), [], 'recién empezadas: no');
  p.editar('Bandeja', a, { actualizado: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
  assert.deepEqual(pendientes(), [a], 'más de 30 minutos: sí');
});

test('receta.upsert crea la receta, sus ingredientes y pasos, y deja la bandeja en lista', () => {
  const p = proyecto();
  const bandejaId = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id: bandejaId, estado: 'procesando' });

  const r = p.upsert(receta(), { bandeja_id: bandejaId });
  assert.equal(r.ok, true, r.mensaje);
  assert.match(r.data.id, /^r_[0-9a-z]{5}$/);
  assert.equal(r.data.nueva, true);
  assert.equal(r.data.ingredientes, 4);
  assert.equal(r.data.pasos, 3);

  const [rec] = p.filas('Recetas');
  assert.equal(rec.id, r.data.id);
  assert.equal(rec.titulo, 'Brownie húmedo');
  assert.equal(rec.etiquetas, 'rápida, para invitados');
  assert.equal(rec.origen_datos, 'descripcion,subtitulos');
  assert.equal(rec.fuente_url, 'https://www.youtube.com/shorts/a2qRJHVeJwk', 'normalizada');
  assert.equal(rec.plataforma, 'youtube');
  assert.equal(rec.estado, 'para_probar');
  assert.equal(rec.valoracion, 0);
  assert.equal(rec.notas_proceso, '«harina 4» → harina 0000');
  assert.equal(typeof rec.creado, 'string');

  const ings = p.filas('Ingredientes');
  assert.deepEqual(ings.map(i => i.orden), [1, 2, 3, 4]);
  assert.ok(ings.every(i => i.receta_id === r.data.id && /^i_/.test(i.id)));
  assert.equal(ings[1].nota, 'pomada');
  assert.equal(ings[3].cantidad, '', 'la sal va sin cantidad');
  assert.equal(ings[3].unidad, 'a ojo');
  const pasos = p.filas('Pasos');
  assert.deepEqual(pasos.map(x => x.timer_min), ['', '', 25]);
  assert.equal(pasos[1].tip, 'De a uno.');

  const [fila] = p.filas('Bandeja');
  assert.equal(fila.estado, 'lista');
  assert.equal(fila.receta_id, r.data.id);

  // Lo ve la PWA en el próximo delta.
  const todo = p.get({ action: 'todo', t: p.token }).data;
  assert.equal(todo.recetas.length, 1);
  assert.equal(todo.ingredientes.length, 4);
});

test('receta.upsert al reprocesar: misma receta, conserva lo del usuario y reemplaza ingredientes y pasos', () => {
  const p = proyecto();
  const bandejaId = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  const id = p.upsert(receta(), { bandeja_id: bandejaId }).data.id;
  // Otra receta en el medio, para que los borrados no toquen filas ajenas.
  const otra = p.upsert(receta({ titulo: 'Torta vasca', fuente_url: 'https://youtu.be/cyTOswdJ4TY' })).data.id;
  p.editar('Recetas', id, { estado: 'favorita', valoracion: 5 });
  const creado = p.filas('Recetas')[0].creado;

  const r = p.upsert(receta({
    titulo: 'Brownie súper húmedo',
    ingredientes: [{ cantidad: 1, unidad: 'taza', nombre: 'azúcar', gondola: 'almacén' }],
    pasos: ['Mezclá todo.', 'Horneá.'],
  }), { bandeja_id: bandejaId });
  assert.equal(r.data.id, id);
  assert.equal(r.data.nueva, false);

  const recetas = p.filas('Recetas');
  assert.equal(recetas.length, 2);
  const rec = recetas.find(x => x.id === id);
  assert.equal(rec.titulo, 'Brownie súper húmedo');
  assert.equal(rec.estado, 'favorita');
  assert.equal(rec.valoracion, 5);
  assert.equal(rec.creado, creado);

  const ings = p.filas('Ingredientes');
  assert.deepEqual(ings.filter(i => i.receta_id === id).map(i => i.nombre), ['azúcar']);
  assert.equal(ings.filter(i => i.receta_id === otra).length, 4, 'la otra receta queda igual');
  assert.equal(ings.length, 5, 'sin huérfanos');
  const pasos = p.filas('Pasos');
  assert.deepEqual(pasos.filter(x => x.receta_id === id).map(x => [x.orden, x.texto]), [[1, 'Mezclá todo.'], [2, 'Horneá.']]);
  assert.equal(pasos.length, 5);
});

test('receta.upsert no duplica: encuentra la receta por fuente_url o por la bandeja', () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  // Mismo video, otro formato de link y sin bandeja_id.
  assert.equal(p.upsert(receta({ fuente_url: 'https://youtu.be/a2qRJHVeJwk' })).data.id, id);

  // La fila de la bandeja ya apunta a la receta: se usa aunque cambie fuente_url.
  const bandejaId = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id: bandejaId, estado: 'lista', receta_id: id });
  assert.equal(p.upsert(receta({ fuente_url: 'https://example.com/brownie' }), { bandeja_id: bandejaId }).data.id, id);
  assert.equal(p.filas('Recetas').length, 1);

  // Con un id que no existe: 404.
  assert.equal(p.upsert(receta({ id: 'r_nada0' })).status, 404);
  assert.equal(p.upsert(receta(), { bandeja_id: 'b_nada0' }).status, 404);
});

test('receta.upsert con validar: true no escribe nada', () => {
  const p = proyecto();
  const bandejaId = p.capturar('https://youtube.com/shorts/a2qRJHVeJwk').data.id;
  const r = p.upsert(receta(), { bandeja_id: bandejaId, validar: true, foto: FOTO });
  assert.equal(r.ok, true);
  assert.equal(r.data.validar, true);
  assert.equal(r.data.nueva, true);
  assert.equal(r.data.id, null);
  assert.equal(p.filas('Recetas').length, 0);
  assert.equal(p.filas('Ingredientes').length, 0);
  assert.equal(p.filas('Bandeja')[0].estado, 'pendiente');
  assert.equal(p.drive.archivosVivos().length, 0);
  assert.equal(p.upsert(receta({ tipo: 'postre' }), { validar: true }).error, 'receta_invalida', 'valida igual');
});

test('receta.upsert junta todos los errores de validación', () => {
  const p = proyecto();
  const r = p.upsert(receta({
    titulo: ' ',
    tipo: 'postre',
    confianza: 'mucha',
    origen_datos: 'subtitulos,tiktok',
    idioma_original: 'castellano',
    fuente_url: 'sin link',
    porciones: 'muchas',
    ingredientes: [
      { cantidad: 2, unidad: 'cups', nombre: 'harina', gondola: 'almacén' },
      { cantidad: null, unidad: 'g', nombre: 'azúcar', gondola: 'almacén' },
      { cantidad: 1, unidad: 'a ojo', nombre: '', gondola: 'kiosco' },
      { cantidad: -3, unidad: 'u', nombre: 'huevos', gondola: 'lácteos y huevos' },
    ],
    pasos: [{ texto: '' }, { texto: 'Horneá.', timer_min: 'un rato' }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, 'receta_invalida');
  const esperados = [
    'falta el título', 'tipo «postre»', 'confianza «mucha»', 'origen_datos «tiktok»', 'idioma_original',
    'fuente_url', 'ingrediente 1: unidad «cups»', 'ingrediente 2: sin cantidad', 'ingrediente 3: falta el nombre',
    'ingrediente 3: góndola «kiosco»', 'ingrediente 3: con unidad «a ojo»', 'ingrediente 4: cantidad',
    'paso 1: falta el texto', 'paso 2: timer_min', 'porciones',
  ];
  for (const e of esperados) assert.ok(r.detalles.some(d => d.includes(e)), 'falta el error: ' + e);
  assert.equal(r.detalles.length, esperados.length);
  assert.match(r.mensaje, /^La receta tiene 15 errores: /);

  assert.equal(p.upsert(receta({ ingredientes: [], pasos: [] })).detalles.length, 2);
  assert.equal(p.postJson({ action: 'receta.upsert', t: p.token }).error, 'sin_receta');
  assert.equal(p.filas('Recetas').length, 0);
});

test('receta.upsert guarda la foto en Drive, pública, y al reprocesar reemplaza la anterior', () => {
  const p = proyecto();
  const r = p.upsert(receta(), { foto: FOTO });
  const [archivo] = p.drive.archivosVivos();
  assert.equal(archivo.nombre, r.data.id + '.jpg');
  assert.equal(archivo.mime, 'image/jpeg');
  assert.equal(archivo.acceso, 'ANYONE_WITH_LINK');
  assert.equal(archivo.permiso, 'VIEW');
  assert.equal(Buffer.from(archivo.bytes).toString(), 'foto de prueba');
  assert.equal(r.data.foto_url, 'https://drive.google.com/thumbnail?id=' + archivo.id + '&sz=w1200');
  assert.equal(p.filas('Recetas')[0].foto_url, r.data.foto_url);

  // Sin foto nueva, se conserva la que estaba.
  assert.equal(p.upsert(receta()).data.foto_url, r.data.foto_url);

  // Con foto nueva (aunque cambie el formato), la anterior va a la papelera.
  const png = { base64: 'data:image/png;base64,' + Buffer.from('otra').toString('base64') };
  const r2 = p.upsert(receta(), { foto: png });
  const vivos = p.drive.archivosVivos();
  assert.equal(vivos.length, 1);
  assert.equal(vivos[0].nombre, r.data.id + '.png');
  assert.ok(archivo.papelera);
  assert.notEqual(r2.data.foto_url, r.data.foto_url);

  for (const foto of [{ base64: FOTO.base64, mime: 'image/gif' }, { base64: '%%%', mime: 'image/jpeg' }, { base64: '', mime: 'image/jpeg' }]) {
    assert.equal(p.upsert(receta(), { foto }).error, 'foto_invalida');
  }
});

test('borrarFilas_ borra filas salteadas sin tocar las demás', () => {
  const p = proyecto();
  p.ctx.agregarFilas_('Notas', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(x => ({ id: 'n_' + x, receta_id: 'r_1', texto: x })));
  p.ctx.borrarFilas_('Notas', [2, 3, 5, 7, 8, 3]);
  assert.deepEqual(p.filas('Notas').map(n => n.texto), ['c', 'e']);
  p.ctx.borrarFilas_('Notas', []);
  assert.equal(p.filas('Notas').length, 2);
});
