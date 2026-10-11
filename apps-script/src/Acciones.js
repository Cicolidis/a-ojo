/**
 * Acciones de la API (§4). Cada una recibe la petición ya validada y devuelve `data`.
 * Las de la Fase 2 en adelante (receta.*, nota.*, compras.*, capturas.*) se suman acá.
 */

function accionPing_() {
  const ss = planilla_();
  return {
    version: VERSION_API,
    ahora: ahoraIso_(),
    hojas_faltantes: Object.keys(ESQUEMA).filter(n => !ss.getSheetByName(n)),
    mensaje: 'Conectado',
  };
}

/**
 * POST capturar { url, quien }
 * `url` puede ser un texto con un link adentro (lo que manda "Compartir" en Android).
 */
function accionCapturar_(req) {
  const quien = String(req.quien || '').trim().toLowerCase();
  if (ENUMS.quien.indexOf(quien) === -1) {
    throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');
  }
  const norm = normalizarUrl(req.url);
  if (!norm) throw errorApi_('sin_url', 400, 'No encontré un link en lo que mandaste.');

  return conLock_(() => {
    const filas = leerFilas_('Bandeja');
    const existente = filas.filter(f => claveDe_(f.datos.url) === norm.clave)[0];
    const ahora = ahoraIso_();

    if (existente) {
      const datos = existente.datos;
      // Volver a guardar algo descartado es querer cocinarlo de nuevo.
      if (datos.estado === 'descartada') {
        Object.assign(datos, { estado: 'pendiente', motivo: '', intentos: 0, actualizado: ahora });
        escribirFila_('Bandeja', existente.fila, datos);
      }
      return { duplicada: true, id: datos.id, estado: datos.estado, mensaje: 'Ya estaba guardada' };
    }

    const id = nuevoId_(ESQUEMA.Bandeja.prefijo, filas.map(f => f.datos.id));
    agregarFila_('Bandeja', {
      id: id,
      creado: ahora,
      url: norm.url,
      plataforma: norm.plataforma,
      quien: quien,
      estado: 'pendiente',
      motivo: '',
      receta_id: '',
      intentos: 0,
      actualizado: ahora,
    });
    return { id: id, estado: 'pendiente', mensaje: '✓ Guardada' };
  });
}

function claveDe_(url) {
  const n = normalizarUrl(url);
  return n ? n.clave : String(url);
}

/**
 * GET todo { since? }
 * Sin `since`: todo. Con `since`: solo lo cambiado después de esa fecha, salvo
 * Compras, que va siempre completa (es chica y así cubre los borrados).
 * `ahora` es el valor a usar como próximo `since`.
 */
function accionTodo_(req) {
  const since = req.since ? String(req.since) : '';
  const desde = since ? Date.parse(since) : NaN;
  if (since && isNaN(desde)) throw errorApi_('since_invalido', 400, '«since» tiene que ser una fecha ISO.');

  // Se lee con el lock: así ninguna escritura queda a mitad de camino entre `ahora` y la lectura.
  return conLock_(() => {
    const ahora = ahoraIso_();
    const cambio = v => {
      const ms = Date.parse(v);
      return isNaN(ms) || ms > desde;
    };

    let recetas = leerDatos_('Recetas');
    let ingredientes = leerDatos_('Ingredientes');
    let pasos = leerDatos_('Pasos');
    let notas = leerDatos_('Notas');
    let bandeja = leerDatos_('Bandeja');
    const compras = leerDatos_('Compras');

    if (since) {
      recetas = recetas.filter(r => cambio(r.actualizado));
      const ids = recetas.map(r => r.id);
      ingredientes = ingredientes.filter(i => ids.indexOf(i.receta_id) !== -1);
      pasos = pasos.filter(p => ids.indexOf(p.receta_id) !== -1);
      notas = notas.filter(n => cambio(n.fecha));
      bandeja = bandeja.filter(b => cambio(b.actualizado));
    }

    return {
      ahora: ahora,
      completo: !since,
      recetas: recetas,
      ingredientes: ingredientes,
      pasos: pasos,
      notas: notas,
      compras: compras,
      bandeja: bandeja,
    };
  });
}

/** GET bandeja.pendientes: filas `pendiente`, de la más vieja a la más nueva (las usa /recetas). */
function accionBandejaPendientes_() {
  const filas = leerDatos_('Bandeja')
    .filter(b => b.estado === 'pendiente')
    .sort((a, b) => (a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0));
  return { filas: filas };
}

/** POST bandeja.actualizar { id, estado, motivo?, receta_id? } */
function accionBandejaActualizar_(req) {
  const id = String(req.id || '').trim();
  const estado = String(req.estado || '').trim();
  if (!id) throw errorApi_('sin_id', 400, 'Falta el «id» de la fila.');
  if (ENUMS.estadoBandeja.indexOf(estado) === -1) {
    throw errorApi_('estado_invalido', 400, '«estado» tiene que ser uno de: ' + ENUMS.estadoBandeja.join(', ') + '.');
  }

  return conLock_(() => {
    const encontrada = leerFilas_('Bandeja').filter(f => f.datos.id === id)[0];
    if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + id + '» en la bandeja.');

    const datos = encontrada.datos;
    datos.estado = estado;
    datos.motivo = estado === 'ayuda' ? String(req.motivo || '') : '';
    if (req.receta_id !== undefined && req.receta_id !== null) datos.receta_id = String(req.receta_id);
    if (estado === 'procesando') datos.intentos = (Number(datos.intentos) || 0) + 1;
    datos.actualizado = ahoraIso_();
    escribirFila_('Bandeja', encontrada.fila, datos);

    return { id: datos.id, estado: datos.estado, intentos: datos.intentos };
  });
}
