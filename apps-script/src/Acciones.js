/**
 * Acciones de la API (§4). Cada una recibe la petición ya validada y devuelve `data`.
 * Las de las fases siguientes (receta.estado, nota.*, compras.*, capturas.*) se suman acá.
 */

/** Una fila que quedó en `procesando` más que esto es de una corrida de /recetas que se cortó. */
const MINUTOS_TRABADA_ = 30;

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

/**
 * GET bandeja.pendientes: filas `pendiente`, de la más vieja a la más nueva (las usa /recetas).
 * También devuelve las que quedaron trabadas en `procesando` por una corrida que se cortó.
 */
function accionBandejaPendientes_() {
  const limite = Date.now() - MINUTOS_TRABADA_ * 60 * 1000;
  const filas = leerDatos_('Bandeja')
    .filter(b => b.estado === 'pendiente' || (b.estado === 'procesando' && !(Date.parse(b.actualizado) > limite)))
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

/**
 * POST receta.upsert { receta, bandeja_id?, foto?, validar? }
 *
 * `receta` trae los campos de §3 más sus `ingredientes` y `pasos` completos.
 * Busca la receta por id, después por el receta_id de la fila de la bandeja y por
 * último por fuente_url: así, reprocesar un link no la duplica. Al actualizar
 * conserva estado, valoracion, creado y foto_url (salvo que venga una foto nueva),
 * y reemplaza todos sus ingredientes y pasos.
 * Con `bandeja_id`, deja esa fila en `lista`. Con `validar`, no escribe nada (dry-run).
 */
function accionRecetaUpsert_(req) {
  const r = req.receta;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw errorApi_('sin_receta', 400, 'Falta «receta».');
  const v = validarReceta_(r);
  const imagen = req.foto ? leerImagen_(req.foto) : null;
  const bandejaId = String(req.bandeja_id || '').trim();
  const validar = req.validar === true || req.validar === 'true';

  return conLock_(() => {
    const recetas = leerFilas_('Recetas');
    const porId = id => recetas.filter(f => f.datos.id === id)[0] || null;
    let bandeja = null;
    if (bandejaId) {
      bandeja = leerFilas_('Bandeja').filter(f => f.datos.id === bandejaId)[0];
      if (!bandeja) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + bandejaId + '» en la bandeja.');
    }
    let existente = null;
    if (v.id) {
      existente = porId(v.id);
      if (!existente) throw errorApi_('no_encontrada', 404, 'No encontré la receta «' + v.id + '».');
    }
    if (!existente && bandeja && bandeja.datos.receta_id) existente = porId(bandeja.datos.receta_id);
    if (!existente) existente = recetas.filter(f => claveDe_(f.datos.fuente_url) === v.clave)[0] || null;

    const resumen = { nueva: !existente, ingredientes: v.ingredientes.length, pasos: v.pasos.length };
    if (validar) {
      return Object.assign({ validar: true, id: existente ? existente.datos.id : null, mensaje: 'La receta es válida' }, resumen);
    }

    const ahora = ahoraIso_();
    const id = existente ? existente.datos.id : nuevoId_(ESQUEMA.Recetas.prefijo, recetas.map(f => f.datos.id));
    const datos = Object.assign(
      existente ? existente.datos : { estado: 'para_probar', valoracion: 0, foto_url: '', creado: ahora },
      v.campos,
      { id: id, actualizado: ahora }
    );
    if (imagen) datos.foto_url = guardarImagen_(id, imagen);
    if (existente) escribirFila_('Recetas', existente.fila, datos);
    else agregarFila_('Recetas', datos);

    reemplazarDeReceta_('Ingredientes', id, v.ingredientes);
    reemplazarDeReceta_('Pasos', id, v.pasos);

    if (bandeja) {
      Object.assign(bandeja.datos, { estado: 'lista', motivo: '', receta_id: id, actualizado: ahora });
      escribirFila_('Bandeja', bandeja.fila, bandeja.datos);
    }
    return Object.assign({ id: id, foto_url: datos.foto_url, mensaje: '✓ Receta guardada' }, resumen);
  });
}

/** Reemplaza todas las filas de una receta en `hoja` (Ingredientes o Pasos), con `orden` 1…n. */
function reemplazarDeReceta_(hoja, recetaId, items) {
  const filas = leerFilas_(hoja);
  borrarFilas_(hoja, filas.filter(f => f.datos.receta_id === recetaId).map(f => f.fila));
  const usados = filas.map(f => f.datos.id);
  agregarFilas_(hoja, items.map((item, i) => {
    const id = nuevoId_(ESQUEMA[hoja].prefijo, usados);
    usados.push(id);
    return Object.assign({}, item, { id: id, receta_id: recetaId, orden: i + 1 });
  }));
}

/**
 * Valida y normaliza la receta que manda /recetas. Junta todos los errores en uno
 * solo (receta_invalida, con `detalles`) para que se puedan corregir de una vez.
 * Devuelve { id, clave, campos, ingredientes, pasos }.
 */
function validarReceta_(r) {
  const errores = [];
  const vacio = v => v === null || v === undefined || String(v).trim() === '';
  const texto = v => (vacio(v) ? '' : String(v).trim());
  const lista = v => (Array.isArray(v) ? v.map(texto) : texto(v).split(',').map(s => s.trim())).filter(Boolean);
  const numero = (v, donde) => {
    if (vacio(v)) return null;
    const n = Number(v);
    if (!isFinite(n) || n <= 0) {
      errores.push(donde + ' tiene que ser un número mayor que 0 o quedar vacío');
      return null;
    }
    return n;
  };
  const enLista = (v, nombreEnum, donde) => {
    if (ENUMS[nombreEnum].indexOf(v) === -1) {
      errores.push(donde + ' «' + v + '» no es válido (' + ENUMS[nombreEnum].join(', ') + ')');
    }
  };

  const titulo = texto(r.titulo);
  if (!titulo) errores.push('falta el título');
  const tipo = texto(r.tipo);
  enLista(tipo, 'tipo', 'tipo');
  const confianza = texto(r.confianza);
  enLista(confianza, 'confianza', 'confianza');
  const origen = lista(r.origen_datos);
  if (!origen.length) errores.push('falta origen_datos');
  origen.forEach(c => enLista(c, 'capa', 'origen_datos'));
  const idioma = texto(r.idioma_original).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(idioma)) errores.push('idioma_original tiene que ser un código como «es» o «en»');
  const norm = normalizarUrl(r.fuente_url);
  if (!norm) errores.push('falta fuente_url (el link original)');

  const ingredientes = Array.isArray(r.ingredientes) ? r.ingredientes : [];
  if (!ingredientes.length) errores.push('falta al menos un ingrediente');
  const ings = ingredientes.map((ing, i) => {
    const donde = 'ingrediente ' + (i + 1);
    ing = ing || {};
    const nombre = texto(ing.nombre);
    if (!nombre) errores.push(donde + ': falta el nombre');
    const unidad = texto(ing.unidad);
    enLista(unidad, 'unidad', donde + ': unidad');
    const gondola = texto(ing.gondola);
    enLista(gondola, 'gondola', donde + ': góndola');
    const cantidad = numero(ing.cantidad, donde + ': cantidad');
    if (unidad === 'a ojo' && cantidad !== null) errores.push(donde + ': con unidad «a ojo» la cantidad va vacía');
    if (unidad !== 'a ojo' && vacio(ing.cantidad)) errores.push(donde + ': sin cantidad, la unidad tiene que ser «a ojo»');
    return { cantidad: cantidad, unidad: unidad, nombre: nombre, nota: texto(ing.nota), gondola: gondola };
  });

  const pasos = Array.isArray(r.pasos) ? r.pasos : [];
  if (!pasos.length) errores.push('falta al menos un paso');
  const ps = pasos.map((p, i) => {
    const donde = 'paso ' + (i + 1);
    if (typeof p === 'string') p = { texto: p };
    p = p || {};
    const t = texto(p.texto);
    if (!t) errores.push(donde + ': falta el texto');
    return { texto: t, timer_min: numero(p.timer_min, donde + ': timer_min'), tip: texto(p.tip) };
  });

  const campos = {
    titulo: titulo,
    tipo: tipo,
    etiquetas: lista(r.etiquetas).join(', '),
    porciones: numero(r.porciones, 'porciones'),
    tiempo_min: numero(r.tiempo_min, 'tiempo_min'),
    molde: texto(r.molde),
    autor: texto(r.autor),
    fuente_url: norm ? norm.url : '',
    plataforma: norm ? norm.plataforma : '',
    confianza: confianza,
    origen_datos: origen.join(','),
    idioma_original: idioma,
    notas_proceso: texto(r.notas_proceso),
  };

  if (errores.length) {
    const err = errorApi_('receta_invalida', 400,
      'La receta tiene ' + (errores.length === 1 ? '1 error: ' : errores.length + ' errores: ') + errores.join('; ') + '.');
    err.detalles = errores;
    throw err;
  }
  return { id: texto(r.id), clave: norm.clave, campos: campos, ingredientes: ings, pasos: ps };
}
