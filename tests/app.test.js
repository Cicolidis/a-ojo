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
