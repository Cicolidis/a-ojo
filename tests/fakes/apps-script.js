/**
 * Versión mínima, en memoria, de los servicios de Apps Script que usa el código
 * de apps-script/src. Alcanza para probar la API en Node sin desplegar.
 *
 * Imita a propósito una trampa real de Sheets: si una celda no tiene formato
 * de texto (@), las fechas ISO y los números escritos como texto se convierten.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

class HojaFalsa {
  constructor(nombre) {
    this.nombre = nombre;
    this.maxFilas = 1000;
    this.maxCols = 26;
    this.celdas = new Map(); // "fila,col" → { valor, formato }
    this.filasFijas = 0;
  }
  celda(f, c) {
    const k = f + ',' + c;
    if (!this.celdas.has(k)) this.celdas.set(k, { valor: '', formato: 'General' });
    return this.celdas.get(k);
  }
  getName() { return this.nombre; }
  getMaxRows() { return this.maxFilas; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    let ultima = 0;
    for (const [k, v] of this.celdas) if (v.valor !== '') ultima = Math.max(ultima, Number(k.split(',')[0]));
    return ultima;
  }
  getLastColumn() {
    let ultima = 0;
    for (const [k, v] of this.celdas) if (v.valor !== '') ultima = Math.max(ultima, Number(k.split(',')[1]));
    return ultima;
  }
  getRange(f, c, nf = 1, nc = 1) {
    if (f < 1 || c < 1 || f + nf - 1 > this.maxFilas || c + nc - 1 > this.maxCols) {
      throw new Error('Rango fuera de la hoja: ' + [f, c, nf, nc].join(','));
    }
    return new RangoFalso(this, f, c, nf, nc);
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  insertRowsAfter(_f, n) { this.maxFilas += n; }
  insertColumnsAfter(_c, n) { this.maxCols += n; }
  deleteColumns(desde, n) {
    for (const k of [...this.celdas.keys()]) if (Number(k.split(',')[1]) >= desde) this.celdas.delete(k);
    this.maxCols -= n;
  }
  setFrozenRows(n) { this.filasFijas = n; }
  autoResizeColumns() {}
}

class RangoFalso {
  constructor(hoja, f, c, nf, nc) { Object.assign(this, { hoja, f, c, nf, nc }); }
  cada(fn) {
    const out = [];
    for (let i = 0; i < this.nf; i++) {
      const fila = [];
      for (let j = 0; j < this.nc; j++) fila.push(fn(this.hoja.celda(this.f + i, this.c + j), i, j));
      out.push(fila);
    }
    return out;
  }
  getValues() { return this.cada(celda => celda.valor); }
  getNumberFormats() { return this.cada(celda => celda.formato); }
  setValues(valores) {
    if (valores.length !== this.nf || valores[0].length !== this.nc) throw new Error('setValues: dimensiones incorrectas');
    this.cada((celda, i, j) => {
      let v = valores[i][j];
      if (typeof v === 'string' && celda.formato !== '@') {
        if (ISO.test(v)) v = new Date(v);
        else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      }
      celda.valor = v;
    });
    return this;
  }
  setNumberFormats(formatos) { this.cada((celda, i, j) => { celda.formato = formatos[i][j]; }); return this; }
  setNumberFormat(formato) { this.cada(celda => { celda.formato = formato; }); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setDataValidation(regla) { this.cada(celda => { celda.validacion = regla; }); return this; }
}

class PlanillaFalsa {
  constructor() {
    this.hojas = [new HojaFalsa('Hoja 1')];
    this.activa = this.hojas[0];
  }
  getSheetByName(n) { return this.hojas.find(h => h.nombre === n) || null; }
  getSheets() { return [...this.hojas]; }
  insertSheet(n) { const h = new HojaFalsa(n); this.hojas.push(h); return h; }
  deleteSheet(h) { this.hojas = this.hojas.filter(x => x !== h); }
  setActiveSheet(h) { this.activa = h; return h; }
  moveActiveSheet(pos) {
    this.hojas = this.hojas.filter(x => x !== this.activa);
    this.hojas.splice(pos - 1, 0, this.activa);
  }
  setSpreadsheetTimeZone() {}
}

function constructorValidacion() {
  const regla = {};
  const b = {
    requireValueInList(lista) { regla.lista = lista; return b; },
    requireCheckbox() { regla.checkbox = true; return b; },
    requireNumberBetween(a, z) { regla.rango = [a, z]; return b; },
    setAllowInvalid(x) { regla.permiteInvalidos = x; return b; },
    build() { return regla; },
  };
  return b;
}

/** Carga los archivos de apps-script/src en un contexto aislado con los servicios falsos. */
function cargarProyecto() {
  const planilla = new PlanillaFalsa();
  const propiedades = new Map();
  const registro = [];
  const contexto = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => planilla,
      newDataValidation: constructorValidacion,
      flush: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (propiedades.has(k) ? propiedades.get(k) : null),
        setProperty: (k, v) => { propiedades.set(k, v); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: contenido => ({
        contenido,
        mime: null,
        setMimeType(m) { this.mime = m; return this; },
      }),
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    console: { log: (...a) => registro.push(a.join(' ')), error: (...a) => registro.push('ERROR ' + a.join(' ')) },
  };
  vm.createContext(contexto);
  const dir = path.join(__dirname, '..', '..', 'apps-script', 'src');
  // Apps Script evalúa cada archivo por separado, en orden alfabético.
  for (const archivo of fs.readdirSync(dir).filter(a => a.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, archivo), 'utf8'), contexto, { filename: archivo });
  }
  const evaluar = codigo => vm.runInContext(codigo, contexto);
  return { ctx: contexto, evaluar, planilla, propiedades, registro };
}

module.exports = { cargarProyecto };
