// Tests de la lógica de la PWA (app/js). Los módulos son ES modules: se cargan con import().
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP = path.join(__dirname, '..', 'app');
const cargar = modulo => import(pathToFileURL(path.join(APP, 'js', modulo)).href);
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'todo.json'), 'utf8'));

test('aplicarDelta: la respuesta completa reemplaza todo', async () => {
  const { aplicarDelta } = await cargar('datos.js');
  const todo = fixture();
  const datos = aplicarDelta({ recetas: [{ id: 'vieja' }] }, todo);
  assert.equal(datos.since, todo.ahora);
  assert.equal(datos.ultimaCompleta, todo.ahora);
  assert.equal(datos.recetas.length, todo.recetas.length);
  assert.ok(!datos.recetas.some(r => r.id === 'vieja'));
});

test('aplicarDelta: una receta cambiada trae y reemplaza todos sus ingredientes y pasos', async () => {
  const { aplicarDelta, trajoCambios } = await cargar('datos.js');
  const todo = fixture();
  const datos = aplicarDelta(null, todo);
  const brownie = Object.assign({}, todo.recetas.find(r => r.id === 'r_brown'), { titulo: 'Brownie nuevo' });
  const delta = {
    ahora: '2026-10-12T10:00:00.000Z',
    completo: false,
    recetas: [brownie],
    ingredientes: [{ id: 'i_nuevo', receta_id: 'r_brown', orden: 1, cantidad: 1, unidad: 'u', nombre: 'huevo', gondola: 'lácteos y huevos' }],
    pasos: [{ id: 'p_nuevo', receta_id: 'r_brown', orden: 1, texto: 'Batí el huevo.' }],
    notas: [{ id: 'n_00001', receta_id: 'r_vasca', fecha: '2026-10-12T09:00:00.000Z', texto: 'Editada' }],
    compras: [{ id: 'c_1', nombre: 'leche' }],
    bandeja: [{ id: 'b_nueva', estado: 'pendiente' }],
  };
  assert.equal(trajoCambios(datos, delta), true);
  const nuevos = aplicarDelta(datos, delta);

  assert.equal(nuevos.since, delta.ahora);
  assert.equal(nuevos.ultimaCompleta, todo.ahora, 'un delta no cuenta como sync completa');
  assert.equal(nuevos.recetas.length, todo.recetas.length);
  assert.equal(nuevos.recetas.find(r => r.id === 'r_brown').titulo, 'Brownie nuevo');
  assert.deepEqual(nuevos.ingredientes.filter(i => i.receta_id === 'r_brown').map(i => i.id), ['i_nuevo']);
  assert.deepEqual(nuevos.pasos.filter(p => p.receta_id === 'r_brown').map(p => p.id), ['p_nuevo']);
  assert.equal(nuevos.ingredientes.filter(i => i.receta_id === 'r_vasca').length,
    todo.ingredientes.filter(i => i.receta_id === 'r_vasca').length, 'las otras recetas no se tocan');
  assert.equal(nuevos.notas.find(n => n.id === 'n_00001').texto, 'Editada');
  assert.equal(nuevos.notas.length, todo.notas.length);
  assert.deepEqual(nuevos.compras, delta.compras, 'compras viene siempre entera');
  assert.equal(nuevos.bandeja.length, todo.bandeja.length + 1);
});

test('trajoCambios y necesitaCompleta', async () => {
  const { aplicarDelta, trajoCambios, necesitaCompleta } = await cargar('datos.js');
  const datos = aplicarDelta(null, fixture());
  const vacio = { ahora: '2026-10-12T00:00:00.000Z', completo: false, recetas: [], ingredientes: [], pasos: [], notas: [], compras: [], bandeja: [] };
  assert.equal(trajoCambios(datos, vacio), false);
  assert.equal(necesitaCompleta(null), true);
  assert.equal(necesitaCompleta(datos, Date.parse('2026-10-13T00:00:00.000Z')), false);
  assert.equal(necesitaCompleta(datos, Date.parse('2026-10-19T00:00:00.000Z')), true, 'más de 7 días');
  assert.equal(necesitaCompleta(Object.assign({}, datos, { version: undefined }), Date.parse('2026-10-13T00:00:00.000Z')), true,
    'un snapshot de una versión anterior de la app se pide entero');
});

test('indexar ordena ingredientes, pasos y notas, y la lista va de la más nueva a la más vieja', async () => {
  const { aplicarDelta, indexar } = await cargar('datos.js');
  const todo = fixture();
  todo.ingredientes.reverse();
  const { lista, porId } = indexar(aplicarDelta(null, todo));
  assert.equal(lista[0].id, 'r_brown');
  const brownie = porId.get('r_brown');
  assert.deepEqual(brownie.ingredientes.map(i => i.orden), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(brownie.etiquetasLista, ['chocolate', 'para invitados']);
  assert.equal(indexar(null).lista.length, 0);
});

test('buscar: sin tildes, todas las palabras, combinado con los filtros y sin descartadas', async () => {
  const { aplicarDelta, indexar, buscar } = await cargar('datos.js');
  const { lista } = indexar(aplicarDelta(null, fixture()));
  const ids = opciones => buscar(lista, opciones).map(r => r.id).sort();

  assert.equal(ids({}).length, 6, 'la descartada no aparece');
  assert.deepEqual(ids({ texto: 'GARBANZO' }), ['r_galle']);
  assert.deepEqual(ids({ texto: 'limon' }), ['r_pollo'], 'busca en ingredientes, sin tildes');
  assert.deepEqual(ids({ texto: 'huevos azucar' }), ['r_brown', 'r_vasca']);
  assert.deepEqual(ids({ texto: 'huevos', filtro: 'favorita' }), ['r_vasca']);
  assert.deepEqual(ids({ filtro: 'tipo:salado' }), ['r_galle', 'r_pollo']);
  assert.deepEqual(ids({ filtro: 'etiqueta:rápida' }), ['r_galle', 'r_torti']);
  assert.deepEqual(ids({ texto: 'para invitados' }), ['r_brown', 'r_pollo', 'r_vasca'], 'busca en etiquetas');
  assert.deepEqual(ids({ texto: 'licuado' }), []);
  assert.deepEqual(ids({ filtro: 'descartada' }), ['r_desc'], 'las descartadas, solo en su filtro');
});

test('etiquetasFrecuentes y resumenBandeja', async () => {
  const { aplicarDelta, indexar, etiquetasFrecuentes, filtroEtiqueta, resumenBandeja } = await cargar('datos.js');
  const todo = fixture();
  const { lista } = indexar(aplicarDelta(null, todo));
  assert.deepEqual(etiquetasFrecuentes(lista, 3), ['para invitados', 'rápida', 'sin tacc']);
  assert.equal(filtroEtiqueta('sin tacc').nombre, 'Sin TACC');
  assert.deepEqual(resumenBandeja(todo.bandeja), { total: 4, esperando: 3, ayuda: 1 });
  assert.deepEqual(resumenBandeja(undefined), { total: 0, esperando: 0, ayuda: 0 });
});

test('formatearCantidad, formatearMinutos y compañía', async () => {
  const f = await cargar('formato.js');
  assert.equal(f.formatearCantidad(200, 'g'), '200 g');
  assert.equal(f.formatearCantidad(2.5, 'g'), '2,5 g', 'gramos sin fracciones');
  assert.equal(f.formatearCantidad(3, 'u'), '3');
  assert.equal(f.formatearCantidad(0.5, 'taza'), '½ taza');
  assert.equal(f.formatearCantidad(1.5, 'taza'), '1 ½ tazas');
  assert.equal(f.formatearCantidad(2, 'cda'), '2 cdas');
  assert.equal(f.formatearCantidad(1, 'cdita'), '1 cdita');
  assert.equal(f.formatearCantidad(0.333, 'taza'), '⅓ taza');
  assert.equal(f.formatearCantidad(1.2, 'kg'), '1,2 kg');
  assert.equal(f.formatearCantidad(null, 'a ojo'), 'a ojo');
  assert.equal(f.formatearCantidad('', 'g'), 'a ojo');

  assert.equal(f.formatearMinutos(45), '45 min');
  assert.equal(f.formatearMinutos(60), '1 h');
  assert.equal(f.formatearMinutos(75), '1 h 15 min');
  assert.equal(f.formatearMinutos(null), '');
  assert.equal(f.formatearTimer(2.5), '2,5 min');
  assert.equal(f.formatearTimer(23), '23 min');
  assert.equal(f.formatearReloj(272), '4:32');
  assert.equal(f.formatearReloj(3725), '1:02:05');
  assert.equal(f.formatearReloj(-3), '0:00');

  const hoy = new Date(2026, 9, 11);
  assert.equal(f.fechaCorta(new Date(2026, 8, 12, 21).toISOString(), hoy), '12/9');
  assert.equal(f.fechaCorta(new Date(2025, 11, 3).toISOString(), hoy), '3/12/25');
  assert.equal(f.capitalizar('chocolate semiamargo'), 'Chocolate semiamargo');
  assert.equal(f.textoTraduccion('en'), 'Traducida del inglés');
  assert.equal(f.textoTraduccion('es'), '');
});

test('fechaHora: hoy, ayer o la fecha, con la hora', async () => {
  const f = await cargar('formato.js');
  const ahora = new Date(2026, 9, 12, 18, 0);
  assert.equal(f.fechaHora(new Date(2026, 9, 12, 14, 32).toISOString(), ahora), 'hoy 14:32');
  assert.equal(f.fechaHora(new Date(2026, 9, 11, 9, 5).toISOString(), ahora), 'ayer 9:05');
  assert.equal(f.fechaHora(new Date(2026, 9, 2, 20, 0).toISOString(), ahora), '2/10 20:00');
  assert.equal(f.fechaHora('nada', ahora), '');
});

test('ingredientesDelPaso: busca los ingredientes nombrados en el paso', async () => {
  const { ingredientesDelPaso } = await cargar('cocina.js');
  const todo = fixture();
  const de = id => todo.ingredientes.filter(i => i.receta_id === id).sort((a, b) => a.orden - b.orden);
  const nombres = (texto, id) => ingredientesDelPaso(texto, de(id)).map(i => i.nombre);

  const brownie = todo.pasos.filter(p => p.receta_id === 'r_brown').map(p => p.texto);
  assert.deepEqual(nombres(brownie[0], 'r_brown'), []);
  assert.deepEqual(nombres(brownie[1], 'r_brown'), ['chocolate semiamargo', 'manteca']);
  assert.deepEqual(nombres(brownie[2], 'r_brown'), ['azúcar', 'huevos'], 'tolera tildes');
  assert.deepEqual(nombres(brownie[3], 'r_brown'), ['chocolate semiamargo', 'esencia de vainilla', 'sal', 'pimienta'],
    '«la vainilla» es la esencia de vainilla');
  assert.deepEqual(nombres(brownie[4], 'r_brown'), ['harina 0000', 'nueces']);
  assert.deepEqual(nombres('Sumá el huevo batido', 'r_brown'), ['huevos'], 'singular ↔ plural');
  assert.deepEqual(nombres('Picá la nuez', 'r_brown'), ['nueces'], 'nuez ↔ nueces');

  assert.deepEqual(nombres('Procesá los garbanzos con el aceite hasta que quede un puré.', 'r_galle'),
    ['garbanzos cocidos', 'aceite de oliva']);
  assert.deepEqual(nombres('Sumá la harina de garbanzos, el comino y la sal, y formá una masa.', 'r_galle'),
    ['harina de garbanzos', 'comino', 'sal'], 'los garbanzos de «harina de garbanzos» no son los cocidos');
  assert.deepEqual(nombres('Rehogá las cebollas con el ajo y el comino.', 'r_pollo'), ['cebollas', 'ajo', 'comino']);
  assert.deepEqual(nombres('Al final, agregá las aceitunas y el jugo de limón.', 'r_pollo'), ['jugo de limón', 'aceitunas verdes']);
  assert.deepEqual(nombres('Salá y salpimentá la salsa.', 'r_galle'), [], 'palabras enteras: «sal» no está en «salsa»');

  const pollo = [{ nombre: 'pechugas de pollo' }, { nombre: 'queso reggianito' }, { nombre: 'queso cremoso' }, { nombre: 'polvo de hornear' }];
  const dePollo = texto => ingredientesDelPaso(texto, pollo).map(i => i.nombre);
  assert.deepEqual(dePollo('Sumá el pollo y doralo.'), ['pechugas de pollo'], 'una palabra propia del ingrediente alcanza');
  assert.deepEqual(dePollo('Terminá con reggianito rallado.'), ['queso reggianito']);
  assert.deepEqual(dePollo('Mezclá hasta que quede cremoso, antes de hornear.'), [], 'los adjetivos y «hornear» no cuentan');

  const leches = [{ nombre: 'leche' }, { nombre: 'leche condensada' }, { nombre: 'dulce de leche' }];
  const de3 = texto => ingredientesDelPaso(texto, leches).map(i => i.nombre);
  assert.deepEqual(de3('Calentá la leche.'), ['leche']);
  assert.deepEqual(de3('Sumá la leche condensada.'), ['leche condensada']);
  assert.deepEqual(de3('Untá con el dulce de leche.'), ['dulce de leche']);
});

test('agrupar: por sección en orden de aparición y, dentro, por rol; los utensilios al final', async () => {
  const { aplicarDelta, indexar } = await cargar('datos.js');
  const { agrupar, enUnaLinea, rolDe, seccionDe } = await cargar('ingredientes.js');
  const { porId } = indexar(aplicarDelta(null, fixture()));
  const nombres = lista => lista.map(i => i.nombre);

  const pollo = agrupar(porId.get('r_pollo').ingredientes);
  assert.deepEqual(pollo.secciones.map(s => s.nombre), ['Guiso', 'Para terminar']);
  assert.deepEqual(nombres(pollo.secciones[0].principales), ['muslos de pollo', 'cebollas', 'ajo', 'caldo de verduras'],
    'el caldo es de la primera sección aunque se use al final');
  assert.deepEqual(nombres(pollo.secciones[0].condimentos), ['comino']);
  assert.deepEqual(nombres(pollo.secciones[1].condimentos), ['jugo de limón']);
  assert.deepEqual(nombres(pollo.secciones[1].opcionales), ['aceitunas verdes']);

  const brownie = agrupar(porId.get('r_brown').ingredientes);
  assert.deepEqual(brownie.secciones.map(s => s.nombre), [''], 'una sola parte: sin título');
  assert.equal(enUnaLinea(brownie.secciones[0].condimentos), 'Esencia de vainilla (1 cdita), sal y pimienta');
  assert.equal(enUnaLinea(brownie.secciones[0].condimentos, 2), 'Esencia de vainilla (2 cditas), sal y pimienta');

  const vasca = agrupar(porId.get('r_vasca').ingredientes);
  assert.deepEqual(nombres(vasca.utensilios), ['papel manteca']);
  assert.equal(enUnaLinea(vasca.utensilios), 'Papel manteca (para forrar el molde)');

  const tortilla = agrupar(porId.get('r_torti').ingredientes);
  assert.equal(tortilla.secciones[0].principales.length, 4, 'las recetas viejas, sin rol, son todas principales');

  // Las ediciones de los usuarios ganan; «-» es «sin sección».
  const ing = { nombre: 'sal', rol: 'condimento', seccion: 'Masa', rol_usuario: 'opcional', seccion_usuario: '-' };
  assert.deepEqual([rolDe(ing), seccionDe(ing)], ['opcional', '']);
  assert.equal(rolDe({ rol: 'cualquiera' }), 'principal');
  const mixta = agrupar([
    { nombre: 'harina', seccion: 'Masa' },
    { nombre: 'sal', rol: 'condimento' },
    { nombre: 'dulce de leche', seccion: 'Relleno' },
  ]);
  assert.deepEqual(mixta.secciones.map(s => s.nombre), ['', 'Masa', 'Relleno'], 'lo que no tiene sección va primero');
});

test('escalar: redondea con sentido y no toca lo «a ojo»', async () => {
  const { escalar } = await cargar('ingredientes.js');
  assert.equal(escalar(200, 'g', 1.5), 300);
  assert.equal(escalar(150, 'g', 4 / 6), 100);
  assert.equal(escalar(15, 'g', 1 / 3), 5);
  assert.equal(escalar(250, 'ml', 1 / 3), 83);
  assert.equal(escalar(1, 'kg', 1 / 3), 0.33);
  assert.equal(escalar(3, 'u', 0.5), 1.5);
  assert.equal(escalar(4, 'u', 1 / 3), 4 / 3, 'al tercio más cercano');
  assert.equal(escalar(3, 'u', 0.7), 2, '2,1 huevos son 2');
  assert.equal(escalar(3, 'u', 0.75), 2.25, 'al cuarto más cercano');
  assert.equal(escalar(1, 'cda', 1 / 3), 1 / 3);
  assert.equal(escalar(1, 'u', 0.1), 0.25, 'nunca menos de ¼');
  assert.equal(escalar(null, 'a ojo', 2), null);
  assert.equal(escalar(200, 'g', 1), 200);
});

test('vistas de porciones: la última usada primero y solo se guarda lo que hace falta', async () => {
  const ing = await cargar('ingredientes.js');
  const r = { porciones: 6, porciones_vistas: '12,3' };
  assert.deepEqual(ing.vistasDe(r), [12, 3]);
  assert.equal(ing.porcionesIniciales(r), 12);
  assert.equal(ing.porcionesIniciales({ porciones: 6 }), 6);
  assert.equal(ing.porcionesIniciales({ porciones: null }), null);
  assert.deepEqual(ing.chipsPorciones(r), [{ n: 3, original: false }, { n: 6, original: true }, { n: 12, original: false }]);
  assert.equal(ing.nuevasVistas('12,3', 3), '3,12');
  assert.equal(ing.nuevasVistas('12,3', 12, true), '3');
  assert.equal(ing.nuevasVistas('', 8), '8');
  assert.equal(ing.nuevasVistas('1,2,3,4,5,6', 7), '7,1,2,3,4,5', 'hasta 6, como la API');

  assert.equal(ing.hayQueGuardarVista(r, 12), false, 'ya es la última usada');
  assert.equal(ing.hayQueGuardarVista(r, 3), true);
  assert.equal(ing.hayQueGuardarVista(r, 6), true, 'volver a la original también se recuerda');
  assert.equal(ing.hayQueGuardarVista({ porciones: 6 }, 6), false, 'la original sin otras vistas: nada que recordar');
  assert.equal(ing.hayQueGuardarVista({ porciones: 6 }, 9), true);
  assert.equal(ing.hayQueGuardarVista({ porciones: null }, 9), false);
});

test('aplicarEdicion: las cinco acciones, como las aplicaría la API, e idempotentes', async () => {
  const { aplicarDelta } = await cargar('datos.js');
  const { aplicarEdicion, aplicarCola, nuevaEdicion, nuevaNota } = await cargar('ediciones.js');
  const datos = aplicarDelta(null, fixture());
  const receta = (d, id) => d.recetas.find(r => r.id === id);

  let d = aplicarEdicion(datos, nuevaEdicion('receta.estado', { id: 'r_brown', estado: 'probada', valoracion: 4 }));
  assert.deepEqual([receta(d, 'r_brown').estado, receta(d, 'r_brown').valoracion], ['probada', 4]);
  assert.equal(receta(datos, 'r_brown').estado, 'para_probar', 'no cambia los datos originales');
  d = aplicarEdicion(d, nuevaEdicion('receta.estado', { id: 'r_brown', estado: 'favorita' }));
  assert.equal(receta(d, 'r_brown').valoracion, 4, 'sin valoracion, no la toca');

  d = aplicarEdicion(d, nuevaEdicion('receta.porciones', { id: 'r_brown', porciones: 12 }));
  assert.equal(receta(d, 'r_brown').porciones_vistas, '12');

  const sal = datos.ingredientes.find(i => i.receta_id === 'r_brown' && i.nombre === 'sal');
  const edicion = nuevaEdicion('receta.ingredientes', { id: 'r_brown', ingredientes: [{ id: sal.id, rol: 'opcional', seccion: 'Para servir' }] });
  d = aplicarEdicion(aplicarEdicion(d, edicion), edicion);
  const sal2 = d.ingredientes.find(i => i.id === sal.id);
  assert.deepEqual([sal2.rol, sal2.rol_usuario, sal2.seccion_usuario], ['condimento', 'opcional', 'Para servir']);

  const nota = nuevaNota('r_brown', 'camilo', '  Con menos azúcar.  ', new Date('2026-10-12T20:00:00.000Z'));
  assert.match(nota.datos.id, /^n_[0-9a-z]{8}$/);
  d = aplicarCola(d, [nota, nota]);
  const notas = d.notas.filter(n => n.receta_id === 'r_brown');
  assert.equal(notas.length, 1, 'aplicarla dos veces no la duplica');
  assert.deepEqual([notas[0].texto, notas[0].quien, notas[0].fecha], ['Con menos azúcar.', 'camilo', '2026-10-12T20:00:00.000Z']);
});

test('después de un delta, las ediciones que siguen en la cola se vuelven a aplicar', async () => {
  const { aplicarDelta } = await cargar('datos.js');
  const { aplicarCola, nuevaEdicion } = await cargar('ediciones.js');
  const todo = fixture();
  const datos = aplicarDelta(null, todo);
  const cola = [nuevaEdicion('receta.estado', { id: 'r_vasca', estado: 'probada' })];
  // El otro celular le cambió el título: el delta trae la receta con el estado viejo.
  const delta = Object.assign({}, todo, {
    ahora: '2026-10-12T10:00:00.000Z', completo: false,
    recetas: [Object.assign({}, todo.recetas.find(r => r.id === 'r_vasca'), { titulo: 'Torta vasca cremosa' })],
    ingredientes: todo.ingredientes.filter(i => i.receta_id === 'r_vasca'),
    pasos: todo.pasos.filter(p => p.receta_id === 'r_vasca'),
    notas: [], bandeja: [],
  });
  const vasca = aplicarCola(aplicarDelta(datos, delta), cola).recetas.find(r => r.id === 'r_vasca');
  assert.deepEqual([vasca.titulo, vasca.estado], ['Torta vasca cremosa', 'probada']);
});

test('procesarCola: manda en orden, corta sin conexión y descarta lo que la API rechaza', async () => {
  const { procesarCola, esReintentable, nuevaEdicion } = await cargar('ediciones.js');
  const { ErrorApi } = await cargar('api.js');
  const e = n => nuevaEdicion('receta.estado', { id: 'r_' + n, estado: 'probada' });

  const cola = [e(1), e(2), e(3)];
  const enviadas = [];
  let guardadas = 0;
  let r = await procesarCola(cola, async x => {
    enviadas.push(x.datos.id);
    if (x.datos.id === 'r_1') cola.push(e(4)); // una edición nueva mientras se manda
    if (x.datos.id === 'r_3') throw new ErrorApi('red', 'Sin conexión.');
  }, () => { guardadas++; });
  assert.deepEqual(enviadas, ['r_1', 'r_2', 'r_3']);
  assert.deepEqual(cola.map(x => x.datos.id), ['r_3', 'r_4'], 'sin conexión, queda para reintentar en orden');
  assert.equal(r.error.codigo, 'red');
  assert.equal(guardadas, 2);

  r = await procesarCola(cola, async x => {
    if (x.datos.id === 'r_3') throw new ErrorApi('estado_invalido', '«estado» no es válido.', 400);
  });
  assert.deepEqual(cola, []);
  assert.deepEqual([r.enviadas, r.descartadas.length, r.descartadas[0].mensaje, r.error], [1, 1, '«estado» no es válido.', null]);

  assert.equal(esReintentable(new ErrorApi('ocupado', 'Ocupada', 503)), true);
  assert.equal(esReintentable(new ErrorApi('falta_columna', 'Corré setup()', 500)), true);
  assert.equal(esReintentable(new ErrorApi('accion_desconocida', 'No conozco', 404)), true, 'la API todavía no se actualizó');
  assert.equal(esReintentable(new ErrorApi('token_invalido', 'Token', 401)), true);
  assert.equal(esReintentable(new ErrorApi('ingredientes_cambiaron', 'Cambió', 409)), false);
});

test('leerLinkConfig: valida la API, el token y quién es', async () => {
  const { leerLinkConfig } = await cargar('config.js');
  const api = 'https://script.google.com/macros/s/AKfyPRUEBA_123-abc/exec';
  const link = params => '#/config?' + new URLSearchParams(params).toString();

  assert.deepEqual(leerLinkConfig(link({ api, t: 'tok+en/=', quien: 'pareja' })),
    { config: { api, t: 'tok+en/=', quien: 'pareja' } }, 'el token llega tal cual, aunque tenga + o /');
  assert.deepEqual(leerLinkConfig(link({ api: 'http://localhost:4173/api-falsa', t: 'prueba', quien: 'Camilo' })).config,
    { api: 'http://localhost:4173/api-falsa', t: 'prueba', quien: 'camilo' });
  assert.match(leerLinkConfig(link({ api, quien: 'pareja' })).error, /token/);
  assert.match(leerLinkConfig(link({ t: 'x', quien: 'pareja' })).error, /API/);
  assert.match(leerLinkConfig(link({ api: 'https://evil.example/exec', t: 'x', quien: 'pareja' })).error, /no es la de A ojo/);
  assert.match(leerLinkConfig(link({ api, t: 'x', quien: 'otra' })).error, /quién sos/);
  assert.match(leerLinkConfig('#/config').error, /API/);
});

test('leerRuta', async () => {
  const { leerRuta } = await cargar('rutas.js');
  assert.deepEqual(leerRuta(''), { nombre: 'biblioteca' });
  assert.deepEqual(leerRuta('#/'), { nombre: 'biblioteca' });
  assert.deepEqual(leerRuta('#/receta/r_7f3k2'), { nombre: 'receta', id: 'r_7f3k2' });
  assert.deepEqual(leerRuta('#/cocina/r_7f3k2/'), { nombre: 'cocina', id: 'r_7f3k2' });
  assert.deepEqual(leerRuta('#/ingredientes/r_7f3k2'), { nombre: 'ingredientes', id: 'r_7f3k2' });
  assert.deepEqual(leerRuta('#/compras'), { nombre: 'compras' });
  assert.deepEqual(leerRuta('#/compras/agregar/r_7f3k2'), { nombre: 'agregar', id: 'r_7f3k2' });
  assert.deepEqual(leerRuta('#/lugares/'), { nombre: 'lugares' });
  assert.deepEqual(leerRuta('#/bandeja'), { nombre: 'bandeja' });
  assert.deepEqual(leerRuta('#/config?api=x&t=y'), { nombre: 'config' });
  assert.deepEqual(leerRuta('#/cualquiera'), { nombre: 'biblioteca' });
});

test('sw.js precachea exactamente los archivos de la app', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  const lista = /const ARCHIVOS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(lista, 'sw.js tiene la lista ARCHIVOS');
  const precache = [...lista[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();

  const NO_VAN = new Set(['sw.js', 'package.json', 'fuentes/OFL.txt']);
  const archivos = [];
  const recorrer = dir => fs.readdirSync(path.join(APP, dir), { withFileTypes: true }).forEach(e => {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) recorrer(rel);
    else if (!NO_VAN.has(rel) && !e.name.startsWith('.')) archivos.push(rel);
  });
  recorrer('');
  assert.deepEqual(precache, archivos.sort());
});

// Fase 4b: compras y bandeja.

const itemCompra = (id, receta_id, nombre, cantidad, unidad, gondola, rol = 'principal', extra = {}) =>
  Object.assign({ id, receta_id, nombre, cantidad, unidad, gondola, rol, lugar: '', hecho: false }, extra);

test('compras: el lugar de cada ítem sale de dónde lo movieron, su rol, la regla del ingrediente o la de su tipo', async () => {
  const c = await cargar('compras.js');
  const lugares = fixture().lugares;
  assert.equal(c.lugarDe({ nombre: 'Huevos', gondola: 'lácteos y huevos', rol: 'principal' }, lugares), 'almacenata');
  assert.equal(c.lugarDe({ nombre: 'huevo', gondola: 'lácteos y huevos' }, lugares), 'almacenata', 'en singular también');
  assert.equal(c.lugarDe({ nombre: 'yogur griego', gondola: 'lácteos y huevos' }, lugares), 'almacenata', 'la regla vale para lo que empieza igual');
  assert.equal(c.lugarDe({ nombre: 'manteca', gondola: 'lácteos y huevos', rol: 'principal' }, lugares), 'supermercado');
  assert.equal(c.lugarDe({ nombre: 'zapallo', gondola: 'verdulería' }, lugares), 'verdulería');
  assert.equal(c.lugarDe({ nombre: 'sal', gondola: 'almacén', rol: 'condimento' }, lugares), 'revisar');
  assert.equal(c.lugarDe({ nombre: 'papel manteca', gondola: 'otros', rol: 'utensilio' }, lugares), 'revisar');
  assert.equal(c.lugarDe({ nombre: 'sal', gondola: 'almacén', rol: 'condimento', lugar: 'dietética' }, lugares), 'dietética', 'lo movieron');
  assert.equal(c.lugarDe({ nombre: 'huevos', rol: 'principal', lugar: 'revisar' }, lugares), 'revisar');
  assert.equal(c.lugarDe({ nombre: 'servilletas', gondola: '' }, lugares), 'supermercado', 'sin regla');
  assert.equal(c.lugarDe({ nombre: 'servilletas', lugar: 'chino' }, []), 'supermercado', 'un lugar desconocido no cuenta');

  const mas = lugares.concat({ por: 'ingrediente', clave: 'yogur griego', lugar: 'dietética' });
  assert.equal(c.lugarPorRegla({ nombre: 'Yogur griego natural' }, mas), 'dietética', 'la regla más larga gana');
  assert.equal(c.lugarPorRegla({ nombre: 'yogur' }, mas), 'almacenata');

  assert.ok(c.mismoNombre('Limón', 'limones'));
  assert.ok(c.mismoNombre('cebollas', 'Cebolla'));
  assert.ok(!c.mismoNombre('huevos', 'huevos de codorniz'));
  assert.ok(!c.mismoNombre('', ''));
  assert.equal(c.claveIngrediente('  Nueces  Pecán '), 'nueces pecan');
  assert.equal(c.reglaIngrediente('Huevo', lugares).lugar, 'almacenata');
  assert.equal(c.reglaIngrediente('huevos de codorniz', lugares), null);
  assert.equal(c.nombreLugar('revisar'), 'Revisá si tenés');
  assert.equal(c.nombreLugar('dietética'), 'Dietética');
});

test('itemsDeReceta: lo elegido, escalado, más los condimentos y utensilios para revisar', async () => {
  const { indexar, aplicarDelta } = await cargar('datos.js');
  const c = await cargar('compras.js');
  const { porId } = indexar(aplicarDelta(null, fixture()));
  const brownie = porId.get('r_brown');
  const elegidos = c.elegidosIniciales(brownie);
  assert.equal(elegidos.size, 5, 'los principales');
  assert.ok(!elegidos.has('i_00009'), 'las nueces son opcionales: arrancan sin marcar');
  elegidos.delete('i_00003'); // ya tienen azúcar
  elegidos.add('i_00009');
  let n = 0;
  const items = c.itemsDeReceta(brownie, 12, elegidos, () => 'c_prueba' + n++);
  assert.deepEqual(items.map(i => [i.nombre, i.cantidad, i.unidad, i.rol]), [
    ['chocolate semiamargo', 400, 'g', 'principal'],
    ['manteca', 400, 'g', 'principal'],
    ['huevos', 6, 'u', 'principal'],
    ['harina 0000', 200, 'g', 'principal'],
    ['esencia de vainilla', 2, 'cdita', 'condimento'],
    ['sal', null, 'a ojo', 'condimento'],
    ['pimienta', null, 'a ojo', 'condimento'],
    ['nueces', 200, 'g', 'opcional'],
  ]);
  assert.deepEqual([items[0].id, items[0].gondola], ['c_prueba0', 'almacén']);
  // Una receta vieja, sin roles: todo es principal.
  const torti = porId.get('r_torti');
  assert.deepEqual(c.itemsDeReceta(torti, 2, c.elegidosIniciales(torti), () => 'c_x').map(i => [i.nombre, i.cantidad]),
    [['banana', 2], ['huevos', 4], ['canela', 1], ['manteca', 2]]);
});

test('armarLista: por lugar, sumando entre recetas con el desglose, y «Revisá si tenés» al final', async () => {
  const c = await cargar('compras.js');
  const lugares = fixture().lugares;
  const it = itemCompra;
  const compras = [
    it('c_1', 'r_brown', 'huevos', 6, 'u', 'lácteos y huevos'),
    it('c_2', 'r_brown', 'harina 0000', 200, 'g', 'almacén'),
    it('c_3', 'r_brown', 'sal', null, 'a ojo', 'almacén', 'condimento'),
    it('c_4', 'r_brown', 'nueces', 200, 'g', 'almacén', 'opcional'),
    it('c_5', 'r_vasca', 'huevo', 4, 'u', 'lácteos y huevos'),
    it('c_6', 'r_vasca', 'Harina 0000', 1, 'cda', 'almacén'),
    it('c_7', 'r_vasca', 'crema de leche', 250, 'ml', 'lácteos y huevos'),
    it('c_8', 'r_vasca', 'papel manteca', null, 'a ojo', 'otros', 'utensilio'),
    it('c_9', 'r_sopa', 'crema de leche', 100, 'ml', 'lácteos y huevos', 'opcional'),
    it('c_10', 'r_sopa', 'zapallo', 1, 'kg', 'verdulería'),
    it('c_11', 'r_sopa', 'zapallo', 300, 'g', 'verdulería'),
    it('c_12', 'r_sopa', 'nuez moscada', null, 'a ojo', 'almacén', 'condimento'),
    it('c_13', '', 'Servilletas', null, 'a ojo', ''),
    it('c_14', 'r_sopa', 'caldo de verduras', 1, 'l', 'almacén', 'principal', { lugar: 'dietética' }),
  ];
  const lista = c.armarLista(compras, lugares);
  assert.deepEqual(lista.map(g => g.nombre), ['Supermercado', 'Verdulería', 'Almacenata', 'Dietética', 'Revisá si tenés']);
  const filas = (l, de = lista) => de.find(g => g.lugar === l).filas.map(f => [f.nombre, f.cantidad, f.desglose]);
  assert.deepEqual(filas('supermercado'), [
    ['Harina 0000', '200 g + 1 cda', ''],
    ['Nueces', '200 g', ''],
    ['Crema de leche', '350 ml', '(250 + 100)'],
    ['Servilletas', '', ''],
  ], 'por tipo de producto y nombre');
  assert.deepEqual(filas('verdulería'), [['Zapallo', '1,3 kg', '(1 kg + 300 g)']]);
  assert.deepEqual(filas('almacenata'), [['Huevos', '10', '(6 + 4)']]);
  assert.deepEqual(filas('dietética'), [['Caldo de verduras', '1 l', '']]);
  assert.deepEqual(filas('revisar'), [['Nuez moscada', '', ''], ['Sal', '', ''], ['Papel manteca', '', '']]);
  assert.equal(lista[0].filas[1].opcional, true);
  assert.equal(lista[0].filas[2].opcional, false, 'la crema solo es opcional en una');
  assert.deepEqual(lista.find(g => g.lugar === 'almacenata').filas[0].ids, ['c_1', 'c_5']);
  assert.equal(c.cuantasPorComprar(lista), 7);

  // Lo que está para revisar se suma a lo mismo que ya está para comprar.
  const conSal = c.armarLista(compras.concat(it('c_15', '', 'Sal', null, 'a ojo', '')), lugares);
  assert.deepEqual(conSal[0].filas.find(f => f.nombre === 'Sal').ids, ['c_15', 'c_3']);
  assert.ok(!filas('revisar', conSal).some(f => f[0] === 'Sal'));

  // Una fila está hecha cuando está todo lo de todas las recetas.
  const marcar = ids => compras.map(x => (ids.includes(x.id) ? Object.assign({}, x, { hecho: true }) : x));
  assert.equal(c.armarLista(marcar(['c_1']), lugares).find(g => g.lugar === 'almacenata').filas[0].hecho, false);
  const hechas = c.armarLista(marcar(['c_1', 'c_5', 'c_3']), lugares);
  assert.equal(hechas.find(g => g.lugar === 'almacenata').filas[0].hecho, true);
  assert.equal(c.cuantasPorComprar(hechas), 6);
  assert.equal(c.textoWhatsApp(hechas), [
    '*Supermercado*', '- Harina 0000: 200 g + 1 cda', '- Nueces: 200 g', '- Crema de leche: 350 ml', '- Servilletas', '',
    '*Verdulería*', '- Zapallo: 1,3 kg', '',
    '*Dietética*', '- Caldo de verduras: 1 l', '',
    '*Revisá si tenés*', '- Nuez moscada', '- Papel manteca',
  ].join('\n'));
  assert.equal(c.textoWhatsApp(c.armarLista([], lugares)), '');
  assert.deepEqual(c.recetasEnLista(compras).map(r => [r.receta_id, r.ids.length]), [['r_brown', 4], ['r_vasca', 4], ['r_sopa', 5]]);
});

test('sumarCantidades: gramos y mililitros se pasan a kilos y litros; lo «a ojo» no suma', async () => {
  const { sumarCantidades } = await cargar('compras.js');
  assert.equal(sumarCantidades([{ cantidad: 2.5, unidad: 'g' }]), '2,5 g');
  assert.equal(sumarCantidades([{ cantidad: 0.5, unidad: 'taza' }, { cantidad: 0.25, unidad: 'taza' }]), '¾ taza');
  assert.equal(sumarCantidades([{ cantidad: 2, unidad: 'cda' }, { cantidad: 1, unidad: 'cda' }]), '3 cdas');
  assert.equal(sumarCantidades([{ cantidad: 1500, unidad: 'ml' }]), '1,5 l');
  assert.equal(sumarCantidades([{ cantidad: 0.75, unidad: 'kg' }, { cantidad: 250, unidad: 'g' }]), '1 kg');
  assert.equal(sumarCantidades([{ cantidad: null, unidad: 'a ojo' }, { cantidad: 2, unidad: 'u' }]), '2');
  assert.equal(sumarCantidades([{ cantidad: null, unidad: 'a ojo' }]), '');
});

test('agruparBandeja: ayuda, esperando a la Mac, recién llegadas y la última corrida', async () => {
  const { indexar, aplicarDelta } = await cargar('datos.js');
  const b = await cargar('bandeja.js');
  const datos = aplicarDelta(null, fixture());
  const { porId } = indexar(datos);
  const g = b.agruparBandeja(datos.bandeja, porId, Date.parse('2026-10-12T12:00:00.000Z'));
  assert.deepEqual(g.ayuda.map(f => f.id), ['b_00075']);
  assert.deepEqual(g.esperando.map(f => f.id), ['b_00074', 'b_00072', 'b_00073'], 'la que se está procesando, primero');
  assert.deepEqual(g.recientes.map(r => r.receta.id).sort(), ['r_brown', 'r_galle', 'r_pollo', 'r_sopa', 'r_torti', 'r_vasca']);
  assert.equal(g.ultimaCorrida, '2026-10-11T10:00:00.000Z');
  assert.deepEqual(b.agruparBandeja(datos.bandeja, porId, Date.parse('2026-10-20T12:00:00.000Z')).recientes, [], 'solo la última semana');
  assert.deepEqual(b.agruparBandeja([], porId), { ayuda: [], esperando: [], recientes: [], ultimaCorrida: '' });

  assert.equal(b.cuantasCapturas({ capturas: 'a, b' }), 2);
  assert.equal(b.cuantasCapturas({ capturas: '' }), 0);
  assert.equal(b.descripcionLink({ plataforma: 'youtube', url: 'https://www.youtube.com/shorts/abc' }), 'Short de YouTube');
  assert.equal(b.descripcionLink({ plataforma: 'youtube', url: 'https://www.youtube.com/watch?v=abc' }), 'Video de YouTube');
  assert.equal(b.descripcionLink({ plataforma: 'instagram', url: 'https://www.instagram.com/reel/abc/' }), 'Reel de Instagram');
  assert.equal(b.descripcionLink({ plataforma: 'web', url: 'https://www.paulinacocina.net/receta/' }), 'paulinacocina.net');
});

test('aplicarEdicion: compras, lugares y bandeja, como la API, e idempotentes', async () => {
  const { aplicarDelta } = await cargar('datos.js');
  const { aplicarEdicion, aplicarCola, nuevaEdicion } = await cargar('ediciones.js');
  const datos = aplicarDelta(null, fixture());
  const items = [
    { id: 'c_aaaaaaaa', nombre: 'huevos', cantidad: 6, unidad: 'u', gondola: 'lácteos y huevos', rol: 'principal' },
    { id: 'c_bbbbbbbb', nombre: 'sal', cantidad: null, unidad: 'a ojo', gondola: 'almacén', rol: 'condimento' },
  ];
  const agregar = nuevaEdicion('compras.agregar', { receta_id: 'r_brown', porciones: 12, items });
  let d = aplicarCola(datos, [agregar, agregar]);
  assert.deepEqual(d.compras[0], { id: 'c_aaaaaaaa', receta_id: 'r_brown', nombre: 'huevos', cantidad: 6, unidad: 'u',
    gondola: 'lácteos y huevos', hecho: false, rol: 'principal', lugar: '', porciones: 12 });
  assert.equal(d.compras.length, 2, 'dos veces no duplica');
  d = aplicarEdicion(d, nuevaEdicion('compras.marcar', { ids: ['c_aaaaaaaa'], hecho: true }));
  d = aplicarEdicion(d, nuevaEdicion('compras.mover', { ids: ['c_bbbbbbbb'], lugar: 'dietética' }));
  d = aplicarEdicion(d, agregar);
  assert.deepEqual(d.compras.map(c => [c.hecho, c.lugar]), [[true, ''], [false, 'dietética']], 'volver a mandarla no pisa lo marcado ni lo movido');

  // Agregarla con otros ids la reemplaza; lo agregado a mano queda.
  d = aplicarEdicion(d, nuevaEdicion('compras.agregar', { items: [{ id: 'c_cccccccc', nombre: 'Servilletas' }] }));
  d = aplicarEdicion(d, nuevaEdicion('compras.agregar', { receta_id: 'r_brown', porciones: 6,
    items: [Object.assign({}, items[0], { id: 'c_dddddddd', cantidad: 3 })] }));
  assert.deepEqual(d.compras.map(c => c.id), ['c_cccccccc', 'c_dddddddd']);
  assert.deepEqual([d.compras[0].unidad, d.compras[0].rol, d.compras[0].receta_id], ['a ojo', 'principal', '']);
  const quitar = nuevaEdicion('compras.quitar', { ids: ['c_cccccccc'] });
  d = aplicarCola(d, [quitar, quitar]);
  assert.deepEqual(d.compras.map(c => c.id), ['c_dddddddd']);

  const nueces = nuevaEdicion('lugares.asignar', { por: 'ingrediente', clave: 'Nueces', lugar: 'dietética' });
  d = aplicarCola(d, [nueces, nueces]);
  assert.deepEqual(d.lugares.filter(l => l.clave === 'Nueces').map(l => l.lugar), ['dietética']);
  d = aplicarEdicion(d, nuevaEdicion('lugares.asignar', { por: 'tipo', clave: 'almacén', lugar: 'almacenata' }));
  assert.equal(d.lugares.find(l => l.clave === 'almacén').lugar, 'almacenata');
  d = aplicarEdicion(d, nuevaEdicion('lugares.asignar', { por: 'ingrediente', clave: 'HUEVOS', lugar: '' }));
  assert.ok(!d.lugares.some(l => l.clave === 'huevos'));
  assert.equal(d.lugares.length, 9);

  d = aplicarEdicion(d, nuevaEdicion('bandeja.actualizar', { id: 'b_00075', estado: 'pendiente' }));
  const ayuda = d.bandeja.find(b => b.id === 'b_00075');
  assert.deepEqual([ayuda.estado, ayuda.motivo, ayuda.intentos], ['pendiente', '', 0]);
  d = aplicarEdicion(d, nuevaEdicion('bandeja.actualizar', { id: 'b_00072', estado: 'descartada' }));
  assert.equal(d.bandeja.find(b => b.id === 'b_00072').estado, 'descartada');
  assert.deepEqual(datos.compras, [], 'no cambia los datos originales');
});

test('aplicarDelta y trajoCambios con lugares', async () => {
  const { aplicarDelta, trajoCambios } = await cargar('datos.js');
  const todo = fixture();
  const datos = aplicarDelta(null, todo);
  assert.equal(datos.lugares.length, 9);
  const vacio = { ahora: '2026-10-12T10:00:00.000Z', completo: false, recetas: [], ingredientes: [], pasos: [], notas: [], bandeja: [], compras: [] };
  assert.equal(trajoCambios(datos, Object.assign({}, vacio, { lugares: todo.lugares })), false);
  const otros = todo.lugares.map(l => (l.clave === 'almacén' ? Object.assign({}, l, { lugar: 'feria' }) : l));
  assert.equal(trajoCambios(datos, Object.assign({}, vacio, { lugares: otros })), true);
  assert.equal(aplicarDelta(datos, Object.assign({}, vacio, { lugares: otros })).lugares[1].lugar, 'feria');
  assert.equal(aplicarDelta(datos, vacio).lugares.length, 9, 'una API vieja, sin lugares, no los borra');
  assert.equal(trajoCambios(datos, vacio), false);
});
