/**
 * API de A ojo: web app de Apps Script que responde JSON.
 *
 * Se despliega como "Ejecutar como: yo · Acceso: cualquiera". La seguridad es
 * el token compartido `t`, guardado en Script Properties.
 *
 * Petición: `action` y `t` van en la query o en el cuerpo. El cuerpo puede ser
 * JSON enviado como text/plain (evita el preflight de CORS) o form-urlencoded.
 * Respuesta: { ok, data } o { ok: false, error, mensaje, detalles?, status }.
 * Con `formato=texto` responde solo el mensaje en texto plano (para avisos de Android).
 */

const VERSION_API = '0.3.0';

function doGet(e) {
  return manejar_(e, 'GET');
}

function doPost(e) {
  return manejar_(e, 'POST');
}

function rutas_() {
  return {
    'ping': { metodos: ['GET', 'POST'], fn: accionPing_ },
    'capturar': { metodos: ['POST'], fn: accionCapturar_ },
    'todo': { metodos: ['GET'], fn: accionTodo_ },
    'bandeja.pendientes': { metodos: ['GET'], fn: accionBandejaPendientes_ },
    'bandeja.actualizar': { metodos: ['POST'], fn: accionBandejaActualizar_ },
    'receta.upsert': { metodos: ['POST'], fn: accionRecetaUpsert_ },
    'receta.estado': { metodos: ['POST'], fn: accionRecetaEstado_ },
    'receta.porciones': { metodos: ['POST'], fn: accionRecetaPorciones_ },
    'receta.ingredientes': { metodos: ['POST'], fn: accionRecetaIngredientes_ },
    'receta.clasificar': { metodos: ['POST'], fn: accionRecetaClasificar_ },
    'nota.agregar': { metodos: ['POST'], fn: accionNotaAgregar_ },
  };
}

function manejar_(e, metodo) {
  let req = (e && e.parameter) || {};
  try {
    req = leerPeticion_(e);
    validarToken_(req.t);
    const ruta = rutas_()[req.action];
    if (!ruta) throw errorApi_('accion_desconocida', 404, 'No conozco la acción «' + (req.action || '') + '».');
    if (ruta.metodos.indexOf(metodo) === -1) {
      throw errorApi_('metodo_incorrecto', 405, 'La acción «' + req.action + '» va por ' + ruta.metodos.join(' o ') + '.');
    }
    return responder_(req, { ok: true, data: ruta.fn(req) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err && err.stack ? err.stack : err);
    return responder_(req, {
      ok: false,
      error: err.codigo || 'error_interno',
      mensaje: err.status ? err.message : 'Algo falló en la API: ' + err.message,
      detalles: err.detalles,
      status: status,
    });
  }
}

function leerPeticion_(e) {
  const req = Object.assign({}, (e && e.parameter) || {});
  const post = e && e.postData;
  const esFormulario = post && String(post.type || '').indexOf('application/x-www-form-urlencoded') === 0;
  // Con form-urlencoded, Apps Script ya dejó los campos en e.parameter.
  if (post && post.contents && !esFormulario) {
    let cuerpo;
    try {
      cuerpo = JSON.parse(post.contents);
    } catch (err) {
      throw errorApi_('cuerpo_invalido', 400, 'El cuerpo tiene que ser JSON o form-urlencoded.');
    }
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
      throw errorApi_('cuerpo_invalido', 400, 'El cuerpo tiene que ser un objeto JSON.');
    }
    Object.assign(req, cuerpo);
  }
  return req;
}

function validarToken_(t) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw errorApi_('sin_configurar', 500, 'La API no tiene token. Corré setup() en el editor de Apps Script.');
  if (!t || String(t) !== esperado) throw errorApi_('token_invalido', 401, 'Token inválido. Revisá la configuración.');
}

function responder_(req, cuerpo) {
  if (req && req.formato === 'texto') {
    const texto = cuerpo.ok ? (cuerpo.data && cuerpo.data.mensaje) || 'Listo' : cuerpo.mensaje;
    return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput(JSON.stringify(cuerpo)).setMimeType(ContentService.MimeType.JSON);
}

function errorApi_(codigo, status, mensaje) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  err.status = status;
  return err;
}

/** Corre `fn` con el lock del script: evita que dos escrituras simultáneas se pisen. */
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw errorApi_('ocupado', 503, 'La planilla está ocupada. Probá de nuevo en unos segundos.');
  try {
    const resultado = fn();
    SpreadsheetApp.flush();
    return resultado;
  } finally {
    lock.releaseLock();
  }
}
