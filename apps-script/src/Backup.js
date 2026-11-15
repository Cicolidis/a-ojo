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
 * Después de copiar, poda el plan semanal: borra las entradas de más de
 * SEMANAS_PLAN_ semanas (el backup recién hecho todavía las tiene).
 *
 * Usa ScriptApp (los triggers), un permiso que el web app no pedía antes de la
 * Fase 6: después del push hay que correr setup() en el editor y aceptarlo
 * ANTES del deploy, o el web app deja de responder.
 */

const BACKUPS_A_GUARDAR_ = 8;
const FUNCION_BACKUP_ = 'hacerBackup';
// Cuántas semanas anteriores a la actual quedan en la hoja Plan (SPEC_v2 §2): el historial para copiar.
const SEMANAS_PLAN_ = 8;

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
  // Con el lock, nadie escribe mientras se copia: Recetas, Ingredientes y Pasos quedan
  // parejas. Lo que llegue en esos segundos espera o recibe «ocupado» (la cola reintenta).
  const id = conLock_(() => copiarHojas_(ss, nombre, carpeta));
  // Si podar el plan falla, igual se podan los backups viejos (y el próximo domingo se vuelve a intentar).
  let plan = 0;
  try {
    const hoy = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
    plan = conLock_(() => podarPlan_(hoy));
  } catch (err) {
    console.error('No pude podar el plan: ' + (err && err.stack ? err.stack : err));
  }
  const borrados = podarBackups_(carpeta, BACKUPS_A_GUARDAR_);
  console.log('Backup: «' + nombre + '» en A ojo/backups' + (borrados ? ' (' + borrados + ' viejos a la papelera)' : '') +
    (plan ? '; ' + plan + ' entradas viejas del plan borradas' : '') + '.');
  return { nombre: nombre, id: id, borrados: borrados, plan: plan };
}

/**
 * Crea una planilla nueva (sin script) con una copia de cada hoja de `ss`, con
 * los mismos nombres y en el mismo orden, la mueve a `carpeta` y devuelve su id.
 * Si algo falla a mitad de camino, la manda a la papelera: no quedan backups a
 * medias ni sueltos en la raíz de Drive.
 */
function copiarHojas_(ss, nombre, carpeta) {
  const copia = SpreadsheetApp.create(nombre);
  try {
    copia.setSpreadsheetTimeZone(ss.getSpreadsheetTimeZone());
    const porDefecto = copia.getSheets();
    // copyTo() las suma al final, como «Copia de …»: se renombran después de
    // borrar la hoja por defecto, por si alguna se llamara igual que ella.
    const copiadas = ss.getSheets().map(h => ({ nombre: h.getName(), hoja: h.copyTo(copia) }));
    porDefecto.forEach(h => copia.deleteSheet(h));
    copiadas.forEach(c => c.hoja.setName(c.nombre));
    DriveApp.getFileById(copia.getId()).moveTo(carpeta);
    return copia.getId();
  } catch (err) {
    try {
      DriveApp.getFileById(copia.getId()).setTrashed(true);
    } catch (otro) {
      console.error('No pude mandar a la papelera el backup a medias «' + nombre + '»: ' + otro);
    }
    throw err;
  }
}

/**
 * Borra del plan las entradas de semanas anteriores al lunes de hace SEMANAS_PLAN_ semanas, contando
 * desde la semana de `hoy` («2026-11-18»): quedan la semana actual, las 8 anteriores y las futuras.
 * Una fila con `semana` que no es una fecha no se toca. Sin la hoja, no hace nada. Devuelve cuántas borró.
 */
function podarPlan_(hoy) {
  if (!planilla_().getSheetByName('Plan')) return 0;
  const dia = diaNumero_(hoy);
  if (isNaN(dia)) throw errorApi_('fecha_invalida', 500, 'No entiendo la fecha de hoy: «' + hoy + '».');
  // (dia + 4) % 7 es el día de la semana (0 = domingo): cuántos días pasaron desde el lunes.
  const lunes = dia - ((dia + 4) % 7 + 6) % 7;
  const limite = lunes - 7 * SEMANAS_PLAN_;
  const viejas = leerFilas_('Plan').filter(f => {
    const semana = diaNumero_(f.datos.semana);
    return !isNaN(semana) && semana < limite;
  });
  borrarFilas_('Plan', viejas.map(f => f.fila));
  return viejas.length;
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
