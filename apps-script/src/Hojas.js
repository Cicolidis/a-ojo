/**
 * Acceso a las hojas. Todo se lee y escribe por nombre de columna, nunca por
 * índice, así se pueden sumar columnas sin romper nada.
 */

function planilla_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function hoja_(nombre) {
  const sh = planilla_().getSheetByName(nombre);
  if (!sh) throw errorApi_('falta_hoja', 500, 'Falta la hoja «' + nombre + '». Corré setup() en el editor de Apps Script.');
  return sh;
}

function encabezados_(sh) {
  const n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

/** Lee una hoja entera. Devuelve [{ fila, datos }] y saltea las filas sin id. */
function leerFilas_(nombre) {
  const valores = hoja_(nombre).getDataRange().getValues();
  if (!valores.length) return [];
  const encabezados = valores[0].map(String);
  const tipos = tiposDe_(nombre);
  const filas = [];
  for (let i = 1; i < valores.length; i++) {
    const datos = {};
    encabezados.forEach((h, j) => {
      if (h) datos[h] = desdeCelda_(valores[i][j], tipos[h]);
    });
    if (datos.id) filas.push({ fila: i + 1, datos: datos });
  }
  return filas;
}

function leerDatos_(nombre) {
  return leerFilas_(nombre).map(f => f.datos);
}

/** Agrega una fila al final. Las columnas que falten en `obj` quedan vacías. */
function agregarFila_(nombre, obj) {
  return agregarFilas_(nombre, [obj]);
}

/** Agrega varias filas al final con una sola escritura. Devuelve el número de la primera. */
function agregarFilas_(nombre, objetos) {
  if (!objetos.length) return 0;
  const sh = hoja_(nombre);
  const encabezados = encabezados_(sh);
  const tipos = tiposDe_(nombre);
  const fila = sh.getLastRow() + 1;
  const ultima = fila + objetos.length - 1;
  if (ultima > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), ultima - sh.getMaxRows() + 100);
  const rango = sh.getRange(fila, 1, objetos.length, encabezados.length);
  // Texto plano en las columnas de texto: así Sheets no convierte fechas ISO ni IDs.
  const formatos = rango.getNumberFormats().map(f => f.map((x, j) => (esTexto_(tipos[encabezados[j]]) ? '@' : x)));
  rango.setNumberFormats(formatos);
  rango.setValues(objetos.map(obj => encabezados.map(h => haciaCelda_(obj[h], tipos[h]))));
  return fila;
}

/** Borra filas por número, de abajo hacia arriba, con un solo deleteRows por tramo contiguo. */
function borrarFilas_(nombre, filas) {
  const orden = filas.filter((f, i) => filas.indexOf(f) === i).sort((a, b) => b - a);
  if (!orden.length) return;
  const sh = hoja_(nombre);
  // Sheets no deja borrar todas las filas no fijas: si haría falta, primero se suman vacías.
  if (sh.getMaxRows() - orden.length < 2) sh.insertRowsAfter(sh.getMaxRows(), 100);
  let fin = orden[0];
  let inicio = fin;
  for (let i = 1; i <= orden.length; i++) {
    if (i < orden.length && orden[i] === inicio - 1) {
      inicio = orden[i];
      continue;
    }
    sh.deleteRows(inicio, fin - inicio + 1);
    if (i < orden.length) fin = inicio = orden[i];
  }
}

/** Reescribe una fila completa con `datos` (el objeto entero, no solo los cambios). */
function escribirFila_(nombre, fila, datos) {
  const sh = hoja_(nombre);
  const encabezados = encabezados_(sh);
  const tipos = tiposDe_(nombre);
  sh.getRange(fila, 1, 1, encabezados.length).setValues([encabezados.map(h => haciaCelda_(datos[h], tipos[h]))]);
}

function desdeCelda_(v, tipo) {
  if (v instanceof Date) return v.toISOString();
  if (tipo === 'numero') return v === '' || v === null ? null : Number(v);
  if (tipo === 'bool') return v === true || String(v).toLowerCase() === 'true';
  return v === null || v === undefined ? '' : String(v);
}

function haciaCelda_(v, tipo) {
  if (v === null || v === undefined) return tipo === 'bool' ? false : '';
  if (tipo === 'bool') return v === true || String(v).toLowerCase() === 'true';
  if (tipo === 'numero') return v === '' ? '' : Number(v);
  return String(v);
}

const ALFABETO_ID_ = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Id corto con prefijo por hoja (ej.: b_7f3k2), distinto de los de `usados`. */
function nuevoId_(prefijo, usados) {
  for (let intento = 0; intento < 50; intento++) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALFABETO_ID_.charAt(Math.floor(Math.random() * ALFABETO_ID_.length));
    const id = prefijo + '_' + s;
    if (!usados || usados.indexOf(id) === -1) return id;
  }
  throw errorApi_('id', 500, 'No pude generar un id único.');
}

function ahoraIso_() {
  return new Date().toISOString();
}
