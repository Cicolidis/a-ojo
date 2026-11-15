/**
 * Backup semanal de la planilla.
 *
 * Un trigger de tiempo (lo instala setup()) corre hacerBackup() los domingos a
 * la madrugada: arma una planilla nueva en "A ojo/backups" con una copia de
 * cada hoja y deja solo las últimas BACKUPS_A_GUARDAR_ (las viejas van a la
 * papelera de Drive, 30 días).
 *
 * No usa makeCopy: copiar el archivo copia también el script ligado, y cada
 * semana aparecía un proyecto de Apps Script nuevo con todo el código de la
 * API. sheet.copyTo() copia valores, formatos y validaciones, pero no el script.
 *
 * Usa ScriptApp (los triggers), un permiso que el web app no pedía antes de la
 * Fase 6: después del push hay que correr setup() en el editor y aceptarlo
 * ANTES del deploy, o el web app deja de responder.
 */

const BACKUPS_A_GUARDAR_ = 8;
const FUNCION_BACKUP_ = 'hacerBackup';

/** Carpeta "A ojo/backups". */
function carpetaBackups_() {
  return carpeta_('CARPETA_BACKUPS', 'backups');
}

/**
 * Arma el backup en "A ojo/backups" y borra los de más. La llama el trigger
 * semanal; también se puede correr a mano desde el editor.
 * Devuelve { nombre, id, borrados }.
 */
function hacerBackup() {
  const ss = planilla_();
  const carpeta = carpetaBackups_();
  const nombre = ss.getName() + ' · backup ' + ahoraIso_().slice(0, 10);
  const id = copiarHojas_(ss, nombre);
  DriveApp.getFileById(id).moveTo(carpeta);
  const borrados = podarBackups_(carpeta, BACKUPS_A_GUARDAR_);
  console.log('Backup: «' + nombre + '» en A ojo/backups' + (borrados ? ' (' + borrados + ' viejos a la papelera)' : '') + '.');
  return { nombre: nombre, id: id, borrados: borrados };
}

/**
 * Crea una planilla nueva (sin script) con una copia de cada hoja de `ss`, con
 * los mismos nombres y en el mismo orden, y devuelve su id. Si algo falla a
 * mitad de camino, la manda a la papelera: no quedan backups a medias.
 */
function copiarHojas_(ss, nombre) {
  const copia = SpreadsheetApp.create(nombre);
  try {
    copia.setSpreadsheetTimeZone(ss.getSpreadsheetTimeZone());
    const porDefecto = copia.getSheets();
    // copyTo() las nombra «Copia de …»: se renombran después de borrar la hoja
    // por defecto, por si alguna se llamara igual que ella. El orden se fija a
    // mano para no depender de dónde las ponga copyTo().
    const copiadas = ss.getSheets().map(h => ({ nombre: h.getName(), hoja: h.copyTo(copia) }));
    porDefecto.forEach(h => copia.deleteSheet(h));
    copiadas.forEach((c, i) => {
      c.hoja.setName(c.nombre);
      copia.setActiveSheet(c.hoja);
      copia.moveActiveSheet(i + 1);
    });
    return copia.getId();
  } catch (err) {
    DriveApp.getFileById(copia.getId()).setTrashed(true);
    throw err;
  }
}

/** Deja las `cuantos` copias más nuevas de la carpeta y manda las demás a la papelera. Devuelve cuántas mandó. */
function podarBackups_(carpeta, cuantos) {
  const archivos = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const archivo = it.next();
    if (!archivo.isTrashed()) archivos.push(archivo);
  }
  archivos.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  const viejos = archivos.slice(cuantos);
  viejos.forEach(a => a.setTrashed(true));
  return viejos.length;
}

/**
 * Instala el trigger semanal si no está (setup() puede correr muchas veces sin
 * duplicarlo). Devuelve true si lo creó.
 */
function instalarBackup_() {
  const ya = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === FUNCION_BACKUP_);
  if (ya) return false;
  ScriptApp.newTrigger(FUNCION_BACKUP_).timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create();
  return true;
}

/** ¿Hay algún backup en la carpeta? */
function hayBackups_() {
  const it = carpetaBackups_().getFiles();
  while (it.hasNext()) {
    if (!it.next().isTrashed()) return true;
  }
  return false;
}
