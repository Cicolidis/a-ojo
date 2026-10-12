/**
 * Preparación de la Sheet. Se corre a mano desde el editor de Apps Script.
 *
 * setup() es idempotente: crea las hojas y columnas que falten, sin tocar
 * datos existentes. Se puede volver a correr cada vez que cambie el esquema.
 */

const COLOR_ENCABEZADO_ = '#EFE2CF'; // --superficie-2
const COLOR_TINTA_ = '#2A211B';      // --tinta

function setup() {
  const ss = planilla_();
  ss.setSpreadsheetTimeZone('America/Argentina/Buenos_Aires');

  const nombres = Object.keys(ESQUEMA);
  nombres.forEach(nombre => prepararHoja_(ss, nombre, ESQUEMA[nombre]));

  // Borra la hoja vacía que viene por defecto ("Hoja 1" / "Sheet1").
  ss.getSheets().forEach(sh => {
    if (!ESQUEMA[sh.getName()] && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });

  nombres.forEach((nombre, i) => {
    ss.setActiveSheet(ss.getSheetByName(nombre));
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(ss.getSheetByName('Bandeja'));
  const sembrados = sembrarLugares_();

  // La primera vez, esto pide el permiso de Drive (el web app lo necesita para las fotos y las capturas).
  const fotos = carpetaFotos_();
  const capturas = carpetaCapturas_();
  const token = asegurarToken_();
  console.log('Listo: hojas creadas o actualizadas (' + nombres.join(', ') + ').');
  if (sembrados) console.log('Lugares: ' + sembrados + ' reglas iniciales (se editan desde la app).');
  console.log('Carpeta de fotos: A ojo/' + fotos.getName() + ' (' + fotos.getId() + ').');
  console.log('Carpeta de capturas: A ojo/' + capturas.getName() + ' (' + capturas.getId() + ').');
  console.log('Token de la API: ' + token);
}

function prepararHoja_(ss, nombre, def) {
  const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);

  // Encabezados: se agregan los que falten, a la derecha.
  const encabezados = encabezados_(sh);
  const faltantes = def.columnas.map(c => c.nombre).filter(n => encabezados.indexOf(n) === -1);
  if (faltantes.length) {
    const desde = encabezados.length + 1;
    const necesarias = desde + faltantes.length - 1;
    if (necesarias > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), necesarias - sh.getMaxColumns());
    sh.getRange(1, desde, 1, faltantes.length).setValues([faltantes]);
  }

  const todas = encabezados_(sh);
  const n = todas.length;
  if (sh.getMaxColumns() > n && sh.getLastColumn() <= n) sh.deleteColumns(n + 1, sh.getMaxColumns() - n);

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, n)
    .setFontWeight('bold')
    .setBackground(COLOR_ENCABEZADO_)
    .setFontColor(COLOR_TINTA_);

  // Formato y validación por columna, de la fila 2 al final.
  const filas = Math.max(sh.getMaxRows() - 1, 1);
  const porNombre = {};
  def.columnas.forEach(c => { porNombre[c.nombre] = c; });
  todas.forEach((h, j) => {
    const c = porNombre[h];
    const rango = sh.getRange(2, j + 1, filas, 1);
    if (!c || esTexto_(c.tipo)) rango.setNumberFormat('@');
    if (!c) return;
    // Sin casillas en las columnas bool: aplicadas a toda la columna pueden hacer que
    // Sheets cuente esas filas como ocupadas y se rompa getLastRow().
    let regla = null;
    if (c.enum) regla = SpreadsheetApp.newDataValidation().requireValueInList(ENUMS[c.enum], true);
    else if (c.rango) regla = SpreadsheetApp.newDataValidation().requireNumberBetween(c.rango[0], c.rango[1]);
    // Sin regla, se borra la que haya: al insertar una columna, Sheets le copia la de la columna de al lado.
    if (regla) rango.setDataValidation(regla.setAllowInvalid(false).build());
    else rango.clearDataValidations();
  });

  sh.autoResizeColumns(1, n);
}

/** Si la hoja Lugares está vacía, le pone el mapa inicial. Devuelve cuántas reglas sumó. */
function sembrarLugares_() {
  const existentes = leerDatos_('Lugares');
  if (existentes.length) return 0;
  const ahora = ahoraIso_();
  const usados = [];
  agregarFilas_('Lugares', LUGARES_INICIALES.map(r => {
    const id = nuevoId_(ESQUEMA.Lugares.prefijo, usados);
    usados.push(id);
    return Object.assign({ id: id, actualizado: ahora }, r);
  }));
  return LUGARES_INICIALES.length;
}

/** Muestra el token actual en el registro de ejecución. */
function verToken() {
  console.log('Token de la API: ' + asegurarToken_());
}

/**
 * Genera un token nuevo. Después hay que actualizarlo en la extensión de
 * Chrome, en HTTP Shortcuts y en el .env de cada computadora.
 */
function rotarToken() {
  const token = generarToken_();
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  console.log('Token nuevo: ' + token);
  console.log('Actualizalo en la extensión, en HTTP Shortcuts y en el .env.');
}

function asegurarToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = generarToken_();
    props.setProperty('TOKEN', token);
  }
  return token;
}

function generarToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}
