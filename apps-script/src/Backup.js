/**
 * Backup semanal de la planilla.
 *
 * Un trigger de tiempo (lo instala setup()) corre hacerBackup() los domingos a
 * la madrugada: copia la planilla a "A ojo/backups" y deja solo las últimas
 * BACKUPS_A_GUARDAR_ copias (las viejas van a la papelera de Drive, 30 días).
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
 * Copia la planilla a "A ojo/backups" y borra las copias de más. La llama el
 * trigger semanal; también se puede correr a mano desde el editor.
 * Devuelve { nombre, id, borrados }.
 */
function hacerBackup() {
  const ss = planilla_();
  const carpeta = carpetaBackups_();
  const nombre = ss.getName() + ' · backup ' + ahoraIso_().slice(0, 10);
  const copia = DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);
  const borrados = podarBackups_(carpeta, BACKUPS_A_GUARDAR_);
  console.log('Backup: «' + nombre + '» en A ojo/backups' + (borrados ? ' (' + borrados + ' viejos a la papelera)' : '') + '.');
  return { nombre: nombre, id: copia.getId(), borrados: borrados };
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
