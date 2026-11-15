/**
 * Versión mínima, en memoria, de los servicios de Apps Script que usa el código
 * de apps-script/src. Alcanza para probar la API en Node sin desplegar.
 *
 * Imita a propósito tres trampas reales: si una celda no tiene formato de texto
 * (@), las fechas ISO y los números escritos como texto se convierten; las
 * columnas insertadas copian la validación de la de al lado; y makeCopy() de la
 * planilla copia también el script ligado (`conScript`).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

class HojaFalsa {
  constructor(nombre, planilla) {
    this.nombre = nombre;
    this.planilla = planilla;
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
  setName(n) {
    if (this.planilla.hojas.some(h => h !== this && h.nombre === n)) throw new Error('Ya existe una hoja con el nombre «' + n + '».');
    this.nombre = n;
    return this;
  }
  /** Como Sheets: la copia va al final de `destino`, como «Copia de …», con valores, formatos y validaciones. */
  copyTo(destino) {
    const h = new HojaFalsa('Copia de ' + this.nombre, destino);
    Object.assign(h, { maxFilas: this.maxFilas, maxCols: this.maxCols, filasFijas: this.filasFijas });
    for (const [k, v] of this.celdas) h.celdas.set(k, { ...v });
    destino.hojas.push(h);
    return h;
  }
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
  /** Como Sheets: corre las columnas de la derecha y las nuevas copian la validación de la columna `c`. */
  insertColumnsAfter(c, n) {
    const nuevas = new Map();
    for (const [k, v] of this.celdas) {
      const [f, col] = k.split(',').map(Number);
      nuevas.set(f + ',' + (col > c ? col + n : col), v);
      if (col === c && v.validacion) {
        for (let i = 1; i <= n; i++) nuevas.set(f + ',' + (c + i), { valor: '', formato: v.formato, validacion: v.validacion });
      }
    }
    this.celdas = nuevas;
    this.maxCols += n;
  }
  deleteRows(desde, n) {
    if (desde <= this.filasFijas || desde + n - 1 > this.maxFilas) throw new Error('deleteRows fuera de rango');
    if (this.maxFilas - n <= this.filasFijas) throw new Error('No se pueden borrar todas las filas no fijas');
    const nuevas = new Map();
    for (const [k, v] of this.celdas) {
      const [f, c] = k.split(',').map(Number);
      if (f < desde) nuevas.set(k, v);
      else if (f >= desde + n) nuevas.set(f - n + ',' + c, v);
    }
    this.celdas = nuevas;
    this.maxFilas -= n;
  }
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
      const regla = celda.validacion;
      if (regla && !regla.permiteInvalidos && v !== '' && v !== null &&
          ((regla.lista && !regla.lista.includes(v)) || (regla.rango && !(v >= regla.rango[0] && v <= regla.rango[1])))) {
        throw new Error('Los datos que ingresaste en la celda ' + String.fromCharCode(64 + this.c + j) + (this.f + i) +
          ' infringen las reglas de validación de datos establecidas.');
      }
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
  clearDataValidations() { return this.setDataValidation(null); }
}

class PlanillaFalsa {
  constructor(id = 'planilla-a-ojo', nombre = 'A ojo — datos') {
    this.id = id;
    this.nombre = nombre;
    this.zona = 'America/Argentina/Buenos_Aires';
    this.hojas = [new HojaFalsa('Hoja 1', this)];
    this.activa = this.hojas[0];
  }
  getSheetByName(n) { return this.hojas.find(h => h.nombre === n) || null; }
  getSheets() { return [...this.hojas]; }
  insertSheet(n) { const h = new HojaFalsa(n, this); this.hojas.push(h); return h; }
  deleteSheet(h) {
    if (this.hojas.length === 1) throw new Error('No se pueden quitar todas las hojas de un documento.');
    this.hojas = this.hojas.filter(x => x !== h);
  }
  setActiveSheet(h) { this.activa = h; return h; }
  moveActiveSheet(pos) {
    this.hojas = this.hojas.filter(x => x !== this.activa);
    this.hojas.splice(pos - 1, 0, this.activa);
  }
  setSpreadsheetTimeZone(z) { this.zona = z; }
  getSpreadsheetTimeZone() { return this.zona; }
  getId() { return this.id; }
  getName() { return this.nombre; }
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

function iterador(lista) {
  let i = 0;
  return { hasNext: () => i < lista.length, next: () => lista[i++] };
}

/** Drive en memoria: carpetas, archivos, papelera y permisos de link. */
class DriveFalso {
  constructor() {
    this.porId = new Map();
    this.siguiente = 1;
    this.raiz = this.carpeta('Mi unidad');
  }
  nuevoId(prefijo) { return prefijo + this.siguiente++; }
  /** Reloj de Drive: cada archivo nuevo es 1 s más nuevo que el anterior (así se pueden ordenar). */
  ahora() { this.reloj = (this.reloj || Date.parse('2026-11-01T00:00:00Z')) + 1000; return this.reloj; }
  /**
   * Una planilla también es un archivo de Drive; sin bytes, no cuenta en
   * archivosVivos(). `conScript`: la de la API tiene el script ligado; las que
   * crea SpreadsheetApp.create(), no.
   */
  registrarPlanilla(planilla, carpeta, conScript) {
    const a = this.archivo({ getName: () => planilla.getName(), getContentType: () => 'application/vnd.google-apps.spreadsheet', getBytes: () => null });
    this.porId.delete(a.id);
    a.id = planilla.getId();
    a.planilla = planilla;
    a.conScript = conScript;
    this.porId.set(a.id, a);
    if (carpeta) { carpeta.archivos.push(a); a.padre = carpeta; }
    return a;
  }
  carpeta(nombre) {
    const drive = this;
    const c = {
      id: this.nuevoId('carpeta'), nombre, carpetas: [], archivos: [], papelera: false,
      getId: () => c.id,
      getName: () => c.nombre,
      isTrashed: () => c.papelera,
      setTrashed: x => { c.papelera = x; return c; },
      getFoldersByName: n => iterador(c.carpetas.filter(x => x.nombre === n && !x.papelera)),
      createFolder: n => { const nueva = drive.carpeta(n); c.carpetas.push(nueva); return nueva; },
      getFilesByName: n => iterador(c.archivos.filter(x => x.nombre === n && !x.papelera)),
      getFiles: () => iterador(c.archivos.filter(x => !x.papelera)),
      createFile: blob => { const a = drive.archivo(blob); c.archivos.push(a); a.padre = c; return a; },
    };
    this.porId.set(c.id, c);
    return c;
  }
  archivo(blob) {
    const drive = this;
    const a = {
      id: this.nuevoId('archivo'), nombre: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes(),
      papelera: false, acceso: null, permiso: null, creado: this.ahora(),
      getId: () => a.id,
      getName: () => a.nombre,
      getDateCreated: () => new Date(a.creado),
      makeCopy: (nombre, carpeta) => {
        const copia = drive.archivo({ getName: () => nombre, getContentType: () => a.mime, getBytes: () => a.bytes });
        copia.conScript = a.conScript;
        carpeta.archivos.push(copia);
        copia.padre = carpeta;
        return copia;
      },
      moveTo: carpeta => {
        if (a.padre) a.padre.archivos = a.padre.archivos.filter(x => x !== a);
        carpeta.archivos.push(a);
        a.padre = carpeta;
        return a;
      },
      isTrashed: () => a.papelera,
      setTrashed: x => { a.papelera = x; return a; },
      setSharing: (acceso, permiso) => { a.acceso = acceso; a.permiso = permiso; return a; },
      getBlob: () => ({ getBytes: () => a.bytes, getContentType: () => a.mime, getName: () => a.nombre }),
    };
    this.porId.set(a.id, a);
    return a;
  }
  /** Archivos que no están en la papelera, de cualquier carpeta. */
  archivosVivos() { return [...this.porId.values()].filter(x => x.bytes && !x.papelera); }
  servicio() {
    return {
      getRootFolder: () => this.raiz,
      getFolderById: id => {
        const c = this.porId.get(id);
        if (!c || !c.carpetas) throw new Error('No item with the given ID could be found');
        return c;
      },
      getFileById: id => {
        const a = this.porId.get(id);
        if (!a || a.carpetas) throw new Error('No item with the given ID could be found');
        return a;
      },
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
    };
  }
}

/** Carga los archivos de apps-script/src en un contexto aislado con los servicios falsos. */
function cargarProyecto() {
  const planilla = new PlanillaFalsa();
  const drive = new DriveFalso();
  drive.registrarPlanilla(planilla, null, true);
  const triggers = [];
  const propiedades = new Map();
  const registro = [];
  const contexto = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => planilla,
      /** Como en Drive: la planilla nueva queda en la raíz, con una hoja vacía y sin script. */
      create: nombre => {
        const nueva = new PlanillaFalsa(drive.nuevoId('planilla'), nombre);
        drive.registrarPlanilla(nueva, drive.raiz, false);
        return nueva;
      },
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
    DriveApp: drive.servicio(),
    ScriptApp: {
      WeekDay: { SUNDAY: 'SUNDAY' },
      getProjectTriggers: () => [...triggers],
      newTrigger: funcion => {
        const t = { funcion, getHandlerFunction: () => funcion };
        const b = {
          timeBased: () => b,
          everyWeeks: n => { t.cadaSemanas = n; return b; },
          onWeekDay: d => { t.dia = d; return b; },
          atHour: h => { t.hora = h; return b; },
          create: () => { triggers.push(t); return t; },
        };
        return b;
      },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      // Solo el formato que usa el proyecto: el día del calendario en esa zona.
      formatDate: (fecha, zona, formato) => {
        if (formato !== 'yyyy-MM-dd') throw new Error('El falso de formatDate solo sabe «yyyy-MM-dd».');
        return new Intl.DateTimeFormat('en-CA', { timeZone: zona || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
      },
      base64Decode: s => {
        if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Could not decode string.');
        return [...Buffer.from(s, 'base64')];
      },
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mime, nombre) => ({
        getBytes: () => bytes,
        getContentType: () => mime,
        getName: () => nombre,
      }),
    },
    console: { log: (...a) => registro.push(a.join(' ')), error: (...a) => registro.push('ERROR ' + a.join(' ')) },
  };
  vm.createContext(contexto);
  const dir = path.join(__dirname, '..', '..', 'apps-script', 'src');
  // Apps Script evalúa cada archivo por separado, en orden alfabético.
  for (const archivo of fs.readdirSync(dir).filter(a => a.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, archivo), 'utf8'), contexto, { filename: archivo });
  }
  const evaluar = codigo => vm.runInContext(codigo, contexto);
  return { ctx: contexto, evaluar, planilla, drive, propiedades, registro, triggers };
}

module.exports = { cargarProyecto };
