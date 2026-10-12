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
      { cantidad: 200, unidad: 'g', nombre: 'chocolate semiamargo', gondola: 'almacén', rol: 'principal' },
      { cantidad: 150, unidad: 'g', nombre: 'manteca', nota: 'pomada', gondola: 'lácteos y huevos', rol: 'principal' },
      { cantidad: 3, unidad: 'u', nombre: 'huevos', gondola: 'lácteos y huevos', rol: 'principal' },
      { cantidad: null, unidad: 'a ojo', nombre: 'sal', gondola: 'almacén', rol: 'condimento' },
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

test('setup crea las 7 hojas en orden, con encabezados, y borra la hoja por defecto', () => {
  const p = proyecto();
  assert.deepEqual(p.planilla.getSheets().map(h => h.getName()),
    ['Bandeja', 'Recetas', 'Ingredientes', 'Pasos', 'Notas', 'Compras', 'Lugares']);
  const enc = p.planilla.getSheetByName('Bandeja').getRange(1, 1, 1, 11).getValues()[0];
  assert.deepEqual(enc, ['id', 'creado', 'url', 'plataforma', 'quien', 'estado', 'motivo', 'receta_id', 'intentos', 'actualizado', 'capturas']);
  assert.deepEqual(p.planilla.getSheetByName('Compras').getRange(1, 9, 1, 3).getValues()[0], ['rol', 'lugar', 'porciones']);
  assert.equal(p.planilla.getSheetByName('Recetas').getLastColumn(), 20);
  const ings = p.planilla.getSheetByName('Ingredientes');
  assert.deepEqual(ings.getRange(1, 9, 1, 4).getValues()[0], ['seccion', 'rol', 'seccion_usuario', 'rol_usuario']);
  assert.match(p.token, /^[0-9a-f]{32}$/);
  assert.ok(p.registro.some(l => l.includes(p.token)), 'el token aparece en el registro');
});

test('setup crea las carpetas "A ojo/fotos" y "A ojo/capturas" una sola vez', () => {
  const p = proyecto();
  const id = p.propiedades.get('CARPETA_FOTOS');
  const [aOjo] = p.drive.raiz.carpetas;
  assert.equal(aOjo.nombre, 'A ojo');
  assert.deepEqual(aOjo.carpetas.map(c => c.nombre), ['fotos', 'capturas']);
  assert.equal(aOjo.carpetas[0].id, id);
  assert.equal(aOjo.carpetas[1].id, p.propiedades.get('CARPETA_CAPTURAS'));
  p.ctx.setup();
  assert.equal(p.propiedades.get('CARPETA_FOTOS'), id);
  assert.equal(p.drive.raiz.carpetas.length, 1);
  assert.equal(aOjo.carpetas.length, 2);

  // Si la mandan a la papelera, se crea otra.
  aOjo.carpetas[0].setTrashed(true);
  p.ctx.setup();
  assert.notEqual(p.propiedades.get('CARPETA_FOTOS'), id);
});

test('setup es idempotente y suma columnas nuevas sin tocar datos', () => {
  const p = proyecto();
  p.capturar('https://youtube.com/shorts/cyTOswdJ4TY');
  const token = p.token;
  p.evaluar("ESQUEMA.Bandeja.columnas.push({ nombre: 'apodo', tipo: 'texto' })");
  p.ctx.setup();
  assert.equal(p.propiedades.get('TOKEN'), token, 'no cambia el token');
  const bandeja = p.planilla.getSheetByName('Bandeja');
  assert.equal(bandeja.getLastColumn(), 12);
  assert.equal(bandeja.getRange(1, 12).getValues()[0][0], 'apodo');
  assert.equal(p.filas('Bandeja').length, 1);
});

test('setup: una columna nueva no hereda la validación de la de al lado (Sheets la copia al insertarla)', () => {
  const p = proyecto();
  p.evaluar("ESQUEMA.Ingredientes.columnas.push({ nombre: 'apodo', tipo: 'texto' })");
  p.ctx.setup();
  assert.doesNotThrow(() => p.ctx.agregarFila_('Ingredientes', { id: 'i_1', receta_id: 'r_1', apodo: 'Masa' }));
  assert.throws(() => p.ctx.agregarFila_('Ingredientes', { id: 'i_2', receta_id: 'r_1', rol_usuario: 'cualquiera' }),
    /validación/, 'las validaciones propias siguen');
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

test('todo: completo sin since; con since solo lo cambiado (compras y lugares siempre enteras)', async () => {
  const p = proyecto();
  const id = p.capturar('https://youtube.com/shorts/cyTOswdJ4TY').data.id;

  const completo = p.get({ action: 'todo', t: p.token });
  assert.equal(completo.data.completo, true);
  assert.equal(completo.data.bandeja.length, 1);
  for (const k of ['recetas', 'ingredientes', 'pasos', 'notas', 'compras']) assert.deepEqual(completo.data[k], []);
  assert.equal(completo.data.lugares.length, 9, 'el mapa inicial');

  const desde = completo.data.ahora;
  await new Promise(r => setTimeout(r, 5));
  const sinCambios = p.get({ action: 'todo', t: p.token, since: desde }).data;
  assert.equal(sinCambios.bandeja.length, 0);
  assert.equal(sinCambios.lugares.length, 9);

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
    ingredientes: [{ cantidad: 1, unidad: 'taza', nombre: 'azúcar', gondola: 'almacén', rol: 'principal' }],
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
      { cantidad: 2, unidad: 'cups', nombre: 'harina', gondola: 'almacén', rol: 'principal', seccion: 'Masa' },
      { cantidad: null, unidad: 'g', nombre: 'azúcar', gondola: 'almacén', rol: 'principal' },
      { cantidad: 1, unidad: 'a ojo', nombre: '', gondola: 'kiosco', rol: 'infaltable' },
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
    'ingrediente 3: rol «infaltable»', 'ingrediente 4: falta el rol', 'si la receta tiene secciones',
  ];
  for (const e of esperados) assert.ok(r.detalles.some(d => d.includes(e)), 'falta el error: ' + e);
  assert.equal(r.detalles.length, esperados.length);
  assert.match(r.mensaje, /^La receta tiene 18 errores: /);

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

test('receta.upsert al reprocesar pasa las ediciones de los usuarios al mismo ingrediente', () => {
  const p = proyecto();
  const id = p.upsert(receta({
    ingredientes: [
      { cantidad: 100, unidad: 'g', nombre: 'azúcar', gondola: 'almacén', rol: 'principal', seccion: 'Masa' },
      { cantidad: 2, unidad: 'u', nombre: 'huevos', gondola: 'lácteos y huevos', rol: 'principal', seccion: 'Masa' },
      { cantidad: 50, unidad: 'g', nombre: 'Azúcar', gondola: 'almacén', rol: 'principal', seccion: 'Almíbar' },
      { cantidad: null, unidad: 'a ojo', nombre: 'canela', gondola: 'almacén', rol: 'condimento', seccion: 'Almíbar' },
    ],
  })).data.id;
  const deLaReceta = () => p.filas('Ingredientes').filter(i => i.receta_id === id);
  const [, huevos, azucarAlmibar, canela] = deLaReceta().map(i => i.id);
  const r = p.postJson({ action: 'receta.ingredientes', t: p.token, id, ingredientes: [
    { id: azucarAlmibar, rol: 'opcional', seccion: 'Almíbar' },
    { id: canela, rol: 'opcional', seccion: 'Para servir' },
    { id: huevos, rol: 'condimento', seccion: 'Masa' },
  ] });
  assert.equal(r.ok, true, r.mensaje);

  // Reprocesada: cambia el orden, la canela ya viene como opcional y los huevos no están más.
  p.upsert(receta({
    ingredientes: [
      { cantidad: 60, unidad: 'g', nombre: 'azucar', gondola: 'almacén', rol: 'principal', seccion: 'almíbar' },
      { cantidad: 120, unidad: 'g', nombre: 'azúcar', gondola: 'almacén', rol: 'principal', seccion: 'Masa' },
      { cantidad: null, unidad: 'a ojo', nombre: 'canela', gondola: 'almacén', rol: 'opcional', seccion: 'Almíbar' },
      { cantidad: 200, unidad: 'g', nombre: 'harina', gondola: 'almacén', rol: 'principal', seccion: 'Masa' },
    ],
  }));
  assert.deepEqual(deLaReceta().map(i => [i.nombre, i.rol_usuario, i.seccion_usuario]), [
    ['azucar', 'opcional', ''], // misma sección y nombre, sin importar tildes ni mayúsculas
    ['azúcar', '', ''], // el de la masa no tenía ediciones (y hay dos «azúcar»: no alcanza el nombre)
    ['canela', '', 'Para servir'], // el rol nuevo ya coincide; la sección elegida queda
    ['harina', '', ''],
  ]);
});

test('receta.estado cambia estado y valoración, y la receta llega en el próximo delta', async () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  const desde = p.get({ action: 'todo', t: p.token }).data.ahora;
  await new Promise(r => setTimeout(r, 5));
  const estado = cuerpo => p.postJson(Object.assign({ action: 'receta.estado', t: p.token, id }, cuerpo));

  const r = estado({ estado: 'probada', valoracion: 4 });
  assert.equal(r.ok, true, r.mensaje);
  assert.deepEqual([r.data.estado, r.data.valoracion], ['probada', 4]);
  assert.deepEqual(estado({ estado: 'probada', valoracion: 4 }).data, r.data, 'mandarlo dos veces deja lo mismo');
  assert.equal(estado({ estado: 'favorita' }).data.valoracion, 4, 'sin valoracion, no la toca');
  const [rec] = p.filas('Recetas');
  assert.deepEqual([rec.estado, rec.valoracion], ['favorita', 4]);

  const delta = p.get({ action: 'todo', t: p.token, since: desde }).data;
  assert.deepEqual(delta.recetas.map(x => x.id), [id]);
  assert.equal(delta.ingredientes.length, 4);

  assert.equal(estado({ valoracion: 0 }).data.valoracion, 0, 'se puede borrar la valoración');
  assert.equal(estado({ estado: 'rica' }).error, 'estado_invalido');
  assert.equal(estado({ valoracion: 6 }).error, 'valoracion_invalida');
  assert.equal(estado({ valoracion: 2.5 }).error, 'valoracion_invalida');
  assert.equal(estado({}).error, 'sin_cambios');
  assert.equal(estado({ id: 'r_nada0', estado: 'probada' }).status, 404);
  assert.equal(p.get({ action: 'receta.estado', t: p.token, id, estado: 'probada' }).status, 405);
});

test('receta.porciones guarda las vistas, la última usada primero, y reprocesar las conserva', () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  const porciones = cuerpo => p.postJson(Object.assign({ action: 'receta.porciones', t: p.token, id }, cuerpo));
  assert.equal(porciones({ porciones: 24 }).data.porciones_vistas, '24');
  assert.equal(porciones({ porciones: 12 }).data.porciones_vistas, '12,24');
  assert.equal(porciones({ porciones: '24' }).data.porciones_vistas, '24,12', 'una que ya estaba pasa al frente');
  assert.equal(porciones({ porciones: 24 }).data.porciones_vistas, '24,12', 'mandarlo dos veces deja lo mismo');
  assert.equal(porciones({ porciones: 12, quitar: true }).data.porciones_vistas, '24');
  assert.equal(porciones({ porciones: 12, quitar: true }).data.porciones_vistas, '24');
  for (const n of [1, 2, 3, 4, 5, 7, 8]) porciones({ porciones: n });
  assert.equal(p.filas('Recetas')[0].porciones_vistas, '8,7,5,4,3,2', 'hasta 6 vistas');

  p.upsert(receta({ titulo: 'Brownie reprocesado' }));
  assert.equal(p.filas('Recetas')[0].porciones_vistas, '8,7,5,4,3,2');

  for (const n of [0, -2, 1.5, 'muchas', null]) assert.equal(porciones({ porciones: n }).error, 'porciones_invalidas');
  assert.equal(porciones({ id: 'r_nada0', porciones: 4 }).status, 404);
});

test('receta.ingredientes guarda las ediciones aparte; receta.clasificar completa y limpia las que coinciden', async () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  const [choco, manteca, huevos, sal] = p.filas('Ingredientes').map(i => i.id);
  const porId = () => Object.fromEntries(p.filas('Ingredientes').map(i => [i.id, i]));
  const editar = (action, ingredientes, extra = {}) =>
    p.postJson(Object.assign({ action, t: p.token, id, ingredientes }, extra));
  const desde = p.get({ action: 'todo', t: p.token }).data.ahora;
  await new Promise(r => setTimeout(r, 5));

  // La sal pasa a opcional y la manteca, a una sección «Base».
  let r = editar('receta.ingredientes', [
    { id: sal, rol: 'opcional', seccion: '' },
    { id: manteca, rol: 'principal', seccion: 'Base' },
  ]);
  assert.equal(r.ok, true, r.mensaje);
  let x = porId();
  assert.deepEqual([x[sal].rol, x[sal].rol_usuario, x[sal].seccion_usuario], ['condimento', 'opcional', '']);
  assert.deepEqual([x[manteca].rol_usuario, x[manteca].seccion_usuario], ['', 'Base'], 'lo igual a /recetas queda vacío');
  assert.equal(p.get({ action: 'todo', t: p.token, since: desde }).data.ingredientes.length, 4, 'el delta lleva los ingredientes');

  // Volver a lo de /recetas borra la edición.
  editar('receta.ingredientes', [{ id: sal, rol: 'condimento', seccion: '' }]);
  assert.equal(porId()[sal].rol_usuario, '');

  // /recetas --clasificar: tienen que venir todos; pone las secciones y limpia lo que ahora coincide.
  assert.equal(editar('receta.clasificar', [{ id: choco, rol: 'principal', seccion: 'Base' }]).error, 'faltan_ingredientes');
  r = editar('receta.clasificar', [choco, manteca, huevos, sal].map(i => ({ id: i, rol: i === sal ? 'condimento' : 'principal', seccion: 'Base' })));
  assert.equal(r.ok, true, r.mensaje);
  x = porId();
  assert.deepEqual([x[manteca].seccion, x[manteca].seccion_usuario], ['Base', ''], 'ya coincide con /recetas');

  // Sacar un ingrediente de su sección queda como «-».
  editar('receta.ingredientes', [{ id: sal, rol: 'condimento', seccion: '' }]);
  assert.equal(porId()[sal].seccion_usuario, '-');

  assert.equal(editar('receta.ingredientes', [{ id: sal, rol: 'infaltable' }]).error, 'ingredientes_invalidos');
  assert.equal(editar('receta.ingredientes', [{ id: sal, rol: 'opcional', seccion: '-' }]).error, 'ingredientes_invalidos');
  assert.equal(editar('receta.ingredientes', [{ id: sal, rol: 'opcional' }, { id: sal, rol: 'principal' }]).error, 'ingredientes_invalidos');
  assert.equal(editar('receta.ingredientes', []).error, 'sin_ingredientes');
  const otra = p.upsert(receta({ fuente_url: 'https://youtu.be/cyTOswdJ4TY' })).data.id;
  const deOtra = p.filas('Ingredientes').find(i => i.receta_id === otra).id;
  const ajeno = editar('receta.ingredientes', [{ id: deOtra, rol: 'opcional' }]);
  assert.deepEqual([ajeno.status, ajeno.error], [409, 'ingredientes_cambiaron']);
  assert.equal(editar('receta.ingredientes', [{ id: sal, rol: 'opcional' }], { id: 'r_nada0' }).status, 404);
});

test('nota.agregar: con el id de la app no se duplica, y llega en el delta aunque la fecha sea vieja', async () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  const desde = p.get({ action: 'todo', t: p.token }).data.ahora;
  await new Promise(r => setTimeout(r, 5));
  const nota = cuerpo => p.postJson(Object.assign({ action: 'nota.agregar', t: p.token, receta_id: id, quien: 'pareja' }, cuerpo));

  const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const r = nota({ id: 'n_abc12345', texto: '  Quedó genial con menos azúcar.  ', fecha: ayer });
  assert.equal(r.ok, true, r.mensaje);
  assert.deepEqual(r.data, { id: 'n_abc12345', fecha: ayer });
  assert.equal(nota({ id: 'n_abc12345', texto: 'Quedó genial con menos azúcar.', fecha: ayer }).data.repetida, true);
  const notas = p.filas('Notas');
  assert.equal(notas.length, 1, 'un reintento no la duplica');
  assert.deepEqual([notas[0].texto, notas[0].quien], ['Quedó genial con menos azúcar.', 'pareja']);
  assert.ok(notas[0].creado > ayer);

  const delta = p.get({ action: 'todo', t: p.token, since: desde }).data;
  assert.deepEqual(delta.notas.map(n => n.id), ['n_abc12345'], 'cuenta cuándo llegó, no la fecha del celular');

  // Sin id, la API le pone uno; una fecha en el futuro queda en «ahora».
  const sinId = nota({ texto: 'Otra', fecha: '2099-01-01T00:00:00.000Z' });
  assert.match(sinId.data.id, /^n_[0-9a-z]{5}$/);
  assert.ok(sinId.data.fecha < '2099');

  assert.equal(nota({ texto: ' ' }).error, 'sin_texto');
  assert.equal(nota({ texto: 'x', quien: 'otra' }).error, 'quien_invalido');
  assert.equal(nota({ texto: 'x', id: 'abc' }).error, 'id_invalido');
  assert.equal(nota({ texto: 'x', fecha: 'ayer' }).error, 'fecha_invalida');
  assert.equal(nota({ texto: 'x', receta_id: 'r_nada0' }).status, 404);
  const otra = p.upsert(receta({ fuente_url: 'https://youtu.be/cyTOswdJ4TY' })).data.id;
  assert.equal(nota({ texto: 'x', id: 'n_abc12345', receta_id: otra }).status, 409);
});

test('las acciones nuevas piden correr setup() si a la Sheet le falta una columna', () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  // Una Sheet de antes de la Fase 4a: sin la columna de las vistas.
  const hoja = p.planilla.getSheetByName('Recetas');
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  hoja.getRange(1, enc.indexOf('porciones_vistas') + 1).setValues([['']]);
  const r = p.postJson({ action: 'receta.porciones', t: p.token, id, porciones: 4 });
  assert.deepEqual([r.status, r.error], [500, 'falta_columna']);
  assert.match(r.mensaje, /setup\(\)/);
});

test('borrarFilas_ borra filas salteadas sin tocar las demás', () => {
  const p = proyecto();
  p.ctx.agregarFilas_('Notas', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(x => ({ id: 'n_' + x, receta_id: 'r_1', texto: x })));
  p.ctx.borrarFilas_('Notas', [2, 3, 5, 7, 8, 3]);
  assert.deepEqual(p.filas('Notas').map(n => n.texto), ['c', 'e']);
  p.ctx.borrarFilas_('Notas', []);
  assert.equal(p.filas('Notas').length, 2);
});

// Fase 4b: compras, lugares y capturas.

/** Ítems de compras como los arma la app (con ids propios). */
function itemsCompra(sufijo = 'a') {
  return [
    { id: 'c_choco' + sufijo, nombre: 'chocolate semiamargo', cantidad: 400, unidad: 'g', gondola: 'almacén', rol: 'principal' },
    { id: 'c_huevo' + sufijo, nombre: 'huevos', cantidad: 6, unidad: 'u', gondola: 'lácteos y huevos', rol: 'principal' },
    { id: 'c_sal00' + sufijo, nombre: 'sal', cantidad: null, unidad: 'a ojo', gondola: 'almacén', rol: 'condimento' },
  ];
}

test('setup siembra Lugares con el mapa inicial una sola vez', () => {
  const p = proyecto();
  const lugares = p.filas('Lugares');
  assert.equal(lugares.length, 9);
  assert.deepEqual(lugares.filter(l => l.por === 'ingrediente').map(l => [l.clave, l.lugar]),
    [['huevos', 'almacenata'], ['yogur', 'almacenata']]);
  assert.equal(lugares.find(l => l.clave === 'almacén').lugar, 'supermercado');
  p.ctx.setup();
  assert.equal(p.filas('Lugares').length, 9, 'no vuelve a sembrar');
});

test('compras.agregar suma los ítems, no duplica al reintentar y, con receta_id, reemplaza los de esa receta', async () => {
  const p = proyecto();
  const id = p.upsert(receta()).data.id;
  const agregar = cuerpo => p.postJson(Object.assign({ action: 'compras.agregar', t: p.token }, cuerpo));

  const r = agregar({ receta_id: id, porciones: 24, items: itemsCompra() });
  assert.equal(r.ok, true, r.mensaje);
  assert.deepEqual([r.data.nuevos, r.data.quitados], [3, 0]);
  assert.equal(agregar({ receta_id: id, porciones: 24, items: itemsCompra() }).data.nuevos, 0, 'un reintento no duplica');
  let compras = p.filas('Compras');
  assert.equal(compras.length, 3);
  const choco = compras.find(c => c.id === 'c_chocoa');
  assert.deepEqual([choco.receta_id, choco.porciones, choco.cantidad, choco.rol, choco.lugar, choco.hecho],
    [id, 24, 400, 'principal', '', false]);
  assert.equal(typeof choco.creado, 'string');

  // Marcado: volver a mandar el mismo ítem no lo desmarca.
  p.postJson({ action: 'compras.marcar', t: p.token, ids: ['c_chocoa'], hecho: true });
  agregar({ receta_id: id, items: itemsCompra() });
  assert.equal(p.filas('Compras').find(c => c.id === 'c_chocoa').hecho, true);

  // Agregarla de nuevo (otras porciones, ids nuevos) reemplaza; lo agregado a mano queda.
  agregar({ items: [{ id: 'c_mano1', nombre: 'Servilletas' }] });
  const otra = agregar({ receta_id: id, porciones: 12, items: itemsCompra('b').slice(0, 2) });
  assert.deepEqual([otra.data.nuevos, otra.data.quitados], [2, 3]);
  compras = p.filas('Compras');
  assert.deepEqual(compras.map(c => c.id).sort(), ['c_chocob', 'c_huevob', 'c_mano1']);
  const mano = compras.find(c => c.id === 'c_mano1');
  assert.deepEqual([mano.receta_id, mano.unidad, mano.rol, mano.gondola], ['', 'a ojo', 'principal', '']);

  // Validaciones: juntan todos los errores.
  const mal = agregar({ items: [
    { id: 'x1', nombre: 'a' },
    { id: 'c_bien1', nombre: '', unidad: 'puñado', cantidad: -1, gondola: 'kiosco', rol: 'sabroso', lugar: 'chino' },
    { id: 'c_bien2', nombre: 'b', cantidad: 2, unidad: 'a ojo' },
  ] });
  assert.equal(mal.error, 'items_invalidos');
  assert.equal(mal.detalles.length, 8);
  assert.equal(agregar({ items: [] }).error, 'sin_items');
  assert.equal(agregar({ receta_id: 'r_nada0', items: itemsCompra('c') }).status, 404);
  assert.equal(agregar({ porciones: 0, items: itemsCompra('c') }).error, 'porciones_invalidas');
});

test('compras.marcar, compras.mover y compras.quitar son idempotentes y llegan en todo', () => {
  const p = proyecto();
  const accion = (action, cuerpo) => p.postJson(Object.assign({ action, t: p.token }, cuerpo));
  accion('compras.agregar', { items: itemsCompra() });

  assert.deepEqual(accion('compras.marcar', { ids: ['c_chocoa', 'c_huevoa', 'c_nada00'], hecho: true }).data.ids, ['c_chocoa', 'c_huevoa']);
  accion('compras.marcar', { ids: ['c_huevoa'], hecho: 'false' });
  assert.deepEqual(p.filas('Compras').map(c => c.hecho), [true, false, false]);

  accion('compras.mover', { ids: ['c_sal00a'], lugar: 'dietética' });
  accion('compras.mover', { ids: ['c_huevoa'], lugar: 'revisar' });
  accion('compras.mover', { ids: ['c_huevoa'], lugar: '' });
  assert.deepEqual(p.filas('Compras').map(c => c.lugar), ['', '', 'dietética']);

  assert.equal(accion('compras.quitar', { ids: ['c_chocoa', 'c_sal00a'] }).data.quitados, 2);
  assert.equal(accion('compras.quitar', { ids: ['c_chocoa', 'c_sal00a'] }).data.quitados, 0, 'un reintento no falla');
  assert.deepEqual(p.get({ action: 'todo', t: p.token }).data.compras.map(c => c.id), ['c_huevoa']);

  assert.equal(accion('compras.marcar', { ids: ['c_huevoa'] }).error, 'sin_hecho');
  assert.equal(accion('compras.marcar', { ids: [], hecho: true }).error, 'sin_ids');
  assert.equal(accion('compras.mover', { ids: ['c_huevoa'], lugar: 'chino' }).error, 'lugar_invalido');
  assert.equal(accion('compras.quitar', { ids: ['r_abc12'] }).error, 'id_invalido');
});

test('lugares.asignar cambia el lugar de un tipo y guarda u olvida el de un ingrediente', () => {
  const p = proyecto();
  const asignar = cuerpo => p.postJson(Object.assign({ action: 'lugares.asignar', t: p.token }, cuerpo));

  assert.equal(asignar({ por: 'tipo', clave: 'almacén', lugar: 'almacenata' }).ok, true);
  assert.equal(p.filas('Lugares').find(l => l.clave === 'almacén').lugar, 'almacenata');

  const r = asignar({ por: 'ingrediente', clave: '  Nueces  Pecán ', lugar: 'dietética' });
  assert.equal(r.data.clave, 'Nueces Pecán');
  asignar({ por: 'ingrediente', clave: 'nueces pecan', lugar: 'feria' });
  let reglas = p.filas('Lugares').filter(l => l.por === 'ingrediente');
  assert.deepEqual(reglas.map(l => [l.clave, l.lugar]), [['huevos', 'almacenata'], ['yogur', 'almacenata'], ['Nueces Pecán', 'feria']],
    'se compara sin tildes ni mayúsculas');

  asignar({ por: 'ingrediente', clave: 'Huevos', lugar: '' });
  asignar({ por: 'ingrediente', clave: 'Huevos', lugar: '' });
  reglas = p.filas('Lugares').filter(l => l.por === 'ingrediente');
  assert.deepEqual(reglas.map(l => l.clave), ['yogur', 'Nueces Pecán']);
  assert.equal(p.filas('Lugares').length, 9);

  assert.equal(asignar({ por: 'tipo', clave: 'almacén', lugar: '' }).error, 'lugar_invalido');
  assert.equal(asignar({ por: 'tipo', clave: 'kiosco', lugar: 'feria' }).error, 'clave_invalida');
  assert.equal(asignar({ por: 'ingrediente', clave: ' ', lugar: 'feria' }).error, 'clave_invalida');
  assert.equal(asignar({ por: 'ingrediente', clave: 'pan', lugar: 'chino' }).error, 'lugar_invalido');
  assert.equal(asignar({ por: 'otra', clave: 'pan', lugar: 'feria' }).error, 'por_invalido');
});

test('bandeja.actualizar: volver a pendiente desde ayuda o descartada reinicia los intentos', () => {
  const p = proyecto();
  const id = p.capturar('https://www.instagram.com/reel/Ddthx0exm4L/').data.id;
  const act = estado => p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado, motivo: 'Instagram pide iniciar sesión' });
  act('procesando');
  act('procesando');
  act('ayuda');
  assert.equal(act('pendiente').ok, true);
  assert.deepEqual([p.filas('Bandeja')[0].intentos, p.filas('Bandeja')[0].motivo], [0, '']);
  act('procesando');
  assert.equal(act('pendiente').ok, true);
  assert.equal(p.filas('Bandeja')[0].intentos, 1, 'una corrida cortada no los reinicia');
});

test('capturas.subir las guarda privadas, deja la fila pendiente y no duplica al reintentar; capturas.bajar las devuelve', () => {
  const p = proyecto();
  const id = p.capturar('https://www.instagram.com/reel/Ddthx0exm4L/').data.id;
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'procesando' });
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'ayuda', motivo: 'Instagram pide iniciar sesión' });
  const subir = cuerpo => p.postJson(Object.assign({ action: 'capturas.subir', t: p.token, bandeja_id: id, lote: 'k3x9a0' }, cuerpo));
  const png = { base64: Buffer.from('otra captura').toString('base64'), mime: 'image/png' };

  const r = subir({ imagenes: [FOTO, png] });
  assert.equal(r.ok, true, r.mensaje);
  assert.deepEqual(r.data, { id, estado: 'pendiente', capturas: 2 });
  assert.equal(subir({ imagenes: [FOTO, png] }).data.capturas, 2, 'el mismo lote no duplica');
  const fila = p.filas('Bandeja')[0];
  assert.deepEqual([fila.estado, fila.motivo, fila.intentos], ['pendiente', '', 0]);
  assert.equal(fila.capturas.split(',').length, 2);

  const archivos = p.drive.archivosVivos();
  assert.deepEqual(archivos.map(a => a.nombre), [id + '-k3x9a0-1.jpg', id + '-k3x9a0-2.png']);
  assert.ok(archivos.every(a => a.acceso === null), 'privadas: sin link público');
  const [, capturas] = p.drive.raiz.carpetas[0].carpetas;
  assert.equal(capturas.archivos.length, 2, 'en A ojo/capturas');

  // Otro envío se suma a los anteriores.
  assert.equal(subir({ lote: 'otro123', imagenes: [FOTO] }).data.capturas, 3);
  const bajadas = p.get({ action: 'capturas.bajar', t: p.token, bandeja_id: id }).data.imagenes;
  assert.equal(bajadas.length, 3);
  assert.deepEqual([bajadas[1].nombre, bajadas[1].mime, bajadas[1].base64], [id + '-k3x9a0-2.png', 'image/png', png.base64]);
  // Si borran una en Drive, se saltea.
  archivos[0].setTrashed(true);
  assert.equal(p.get({ action: 'capturas.bajar', t: p.token, bandeja_id: id }).data.imagenes.length, 2);

  assert.equal(subir({ imagenes: [] }).error, 'sin_imagenes');
  assert.equal(subir({ imagenes: Array(7).fill(FOTO) }).error, 'demasiadas');
  assert.equal(subir({ lote: 'a', imagenes: [FOTO] }).error, 'lote_invalido');
  const mala = subir({ imagenes: [FOTO, { base64: 'xx', mime: 'image/gif' }] });
  assert.deepEqual([mala.error, mala.mensaje], ['foto_invalida', 'La captura 2 tiene que ser image/jpeg, image/png, image/webp.']);
  assert.equal(subir({ bandeja_id: 'b_nada0', imagenes: [FOTO] }).status, 404);
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'procesando' });
  assert.equal(subir({ lote: 'tercer1', imagenes: [FOTO] }).error, 'procesando');
  p.postJson({ action: 'bandeja.actualizar', t: p.token, id, estado: 'lista' });
  assert.equal(subir({ lote: 'tercer1', imagenes: [FOTO] }).error, 'ya_lista');
  assert.equal(p.get({ action: 'capturas.bajar', t: p.token, bandeja_id: 'b_nada0' }).status, 404);
});

test('compras y capturas piden correr setup() si faltan sus columnas; todo anda sin la hoja Lugares', () => {
  const p = proyecto();
  for (const [hoja, columna] of [['Compras', 'lugar'], ['Bandeja', 'capturas']]) {
    const sh = p.planilla.getSheetByName(hoja);
    const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.getRange(1, enc.indexOf(columna) + 1).setValues([['']]);
  }
  assert.equal(p.postJson({ action: 'compras.agregar', t: p.token, items: itemsCompra() }).error, 'falta_columna');
  assert.equal(p.postJson({ action: 'compras.mover', t: p.token, ids: ['c_chocoa'], lugar: 'feria' }).error, 'falta_columna');
  const id = p.capturar('https://www.instagram.com/reel/Ddthx0exm4L/').data.id;
  assert.equal(p.postJson({ action: 'capturas.subir', t: p.token, bandeja_id: id, lote: 'k3x9a0', imagenes: [FOTO] }).error, 'falta_columna');
  assert.equal(p.drive.archivosVivos().length, 0, 'no guarda nada en Drive');

  p.planilla.deleteSheet(p.planilla.getSheetByName('Lugares'));
  const todo = p.get({ action: 'todo', t: p.token });
  assert.equal(todo.ok, true);
  assert.deepEqual(todo.data.lugares, []);
});
