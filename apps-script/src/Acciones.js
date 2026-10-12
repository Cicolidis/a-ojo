/**
 * Acciones de la API (§4). Cada una recibe la petición ya validada y devuelve `data`.
 * Las de las fases siguientes (compras.*, capturas.*) se suman acá.
 *
 * Las que usa la app se reintentan desde su cola offline: tienen que ser
 * idempotentes (mandar dos veces lo mismo deja todo igual).
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
      // Una nota escrita sin conexión llega con una `fecha` vieja: cuenta cuándo llegó.
      notas = notas.filter(n => cambio(n.creado || n.fecha));
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

    reemplazarDeReceta_('Ingredientes', id, v.ingredientes, conservarEdiciones_);
    reemplazarDeReceta_('Pasos', id, v.pasos);

    if (bandeja) {
      Object.assign(bandeja.datos, { estado: 'lista', motivo: '', receta_id: id, actualizado: ahora });
      escribirFila_('Bandeja', bandeja.fila, bandeja.datos);
    }
    return Object.assign({ id: id, foto_url: datos.foto_url, mensaje: '✓ Receta guardada' }, resumen);
  });
}

/**
 * Reemplaza todas las filas de una receta en `hoja` (Ingredientes o Pasos), con `orden` 1…n.
 * `ajustar(items, viejas)`, si viene, completa los items nuevos con datos de las filas viejas.
 */
function reemplazarDeReceta_(hoja, recetaId, items, ajustar) {
  const filas = leerFilas_(hoja);
  const viejas = filas.filter(f => f.datos.receta_id === recetaId);
  if (ajustar) items = ajustar(items, viejas.map(f => f.datos));
  borrarFilas_(hoja, viejas.map(f => f.fila));
  const usados = filas.map(f => f.datos.id);
  agregarFilas_(hoja, items.map((item, i) => {
    const id = nuevoId_(ESQUEMA[hoja].prefijo, usados);
    usados.push(id);
    return Object.assign({}, item, { id: id, receta_id: recetaId, orden: i + 1 });
  }));
}

/**
 * Al reprocesar, las ediciones de los usuarios (rol_usuario, seccion_usuario) pasan
 * al ingrediente nuevo que es «el mismo»: igual sección original e igual nombre o,
 * si no hay, igual nombre cuando había uno solo con ese nombre. Si lo nuevo de
 * /recetas ya coincide con lo que eligieron, la edición se borra.
 */
function conservarEdiciones_(nuevos, viejos) {
  const editados = viejos.filter(i => i.rol_usuario || i.seccion_usuario);
  if (!editados.length) return nuevos;
  const cuantos = {};
  viejos.forEach(i => {
    const k = claveTexto_(i.nombre);
    cuantos[k] = (cuantos[k] || 0) + 1;
  });
  const usados = [];
  const libre = i => usados.indexOf(i) === -1;
  return nuevos.map(ing => {
    const nombre = claveTexto_(ing.nombre);
    const viejo =
      editados.filter(i => libre(i) && claveTexto_(i.nombre) === nombre && claveTexto_(i.seccion) === claveTexto_(ing.seccion))[0] ||
      (cuantos[nombre] === 1 ? editados.filter(i => libre(i) && claveTexto_(i.nombre) === nombre)[0] : null);
    if (!viejo) return ing;
    usados.push(viejo);
    return Object.assign({}, ing, {
      rol_usuario: viejo.rol_usuario ? rolUsuario_(viejo.rol_usuario, ing.rol) : '',
      seccion_usuario: viejo.seccion_usuario ? seccionUsuario_(seccionElegida_(viejo.seccion_usuario), ing.seccion) : '',
    });
  });
}

/** Lo que se guarda en rol_usuario: vacío si coincide con el rol de /recetas. */
function rolUsuario_(elegido, original) {
  return elegido === (original || 'principal') ? '' : elegido;
}

/** Lo que se guarda en seccion_usuario: vacío si coincide con la de /recetas, SIN_SECCION si la sacaron. */
function seccionUsuario_(elegida, original) {
  return elegida === (original || '') ? '' : elegida || SIN_SECCION;
}

/** La sección que eligieron los usuarios, a partir de seccion_usuario (no vacía). */
function seccionElegida_(seccionUsuario) {
  return seccionUsuario === SIN_SECCION ? '' : seccionUsuario;
}

/** Para comparar nombres: sin tildes, en minúsculas y sin espacios de más. */
function claveTexto_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
    const rol = texto(ing.rol);
    if (!rol) errores.push(donde + ': falta el rol (' + ENUMS.rol.join(', ') + ')');
    else enLista(rol, 'rol', donde + ': rol');
    const seccion = texto(ing.seccion);
    if (seccion.length > 40) errores.push(donde + ': la sección tiene que ser corta');
    const cantidad = numero(ing.cantidad, donde + ': cantidad');
    if (unidad === 'a ojo' && cantidad !== null) errores.push(donde + ': con unidad «a ojo» la cantidad va vacía');
    if (unidad !== 'a ojo' && vacio(ing.cantidad)) errores.push(donde + ': sin cantidad, la unidad tiene que ser «a ojo»');
    return { cantidad: cantidad, unidad: unidad, nombre: nombre, nota: texto(ing.nota), gondola: gondola, seccion: seccion, rol: rol };
  });
  const comestibles = ings.filter(i => i.rol !== 'utensilio');
  const conSeccion = comestibles.filter(i => i.seccion).length;
  if (conSeccion && conSeccion < comestibles.length) {
    errores.push('si la receta tiene secciones, cada ingrediente (salvo los utensilios) lleva la suya');
  }

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

// Ediciones desde la app (§7.2) y desde /recetas --clasificar.

/** Fila de la receta `id`, o un error claro. Se llama dentro del lock. */
function filaReceta_(id) {
  const buscado = String(id || '').trim();
  if (!buscado) throw errorApi_('sin_id', 400, 'Falta el «id» de la receta.');
  const encontrada = leerFilas_('Recetas').filter(f => f.datos.id === buscado)[0];
  if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré la receta «' + buscado + '».');
  return encontrada;
}

function vacio_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** POST receta.estado { id, estado?, valoracion? } */
function accionRecetaEstado_(req) {
  const cambios = {};
  if (!vacio_(req.estado)) {
    const estado = String(req.estado).trim();
    if (ENUMS.estadoReceta.indexOf(estado) === -1) {
      throw errorApi_('estado_invalido', 400, '«estado» tiene que ser uno de: ' + ENUMS.estadoReceta.join(', ') + '.');
    }
    cambios.estado = estado;
  }
  if (!vacio_(req.valoracion)) {
    const valoracion = Number(req.valoracion);
    if (!Number.isInteger(valoracion) || valoracion < 0 || valoracion > 5) {
      throw errorApi_('valoracion_invalida', 400, '«valoracion» tiene que ser un entero de 0 a 5.');
    }
    cambios.valoracion = valoracion;
  }
  if (!Object.keys(cambios).length) throw errorApi_('sin_cambios', 400, 'Mandá «estado», «valoracion» o los dos.');

  return conLock_(() => {
    const receta = filaReceta_(req.id);
    Object.assign(receta.datos, cambios, { actualizado: ahoraIso_() });
    escribirFila_('Recetas', receta.fila, receta.datos);
    return { id: receta.datos.id, estado: receta.datos.estado, valoracion: receta.datos.valoracion };
  });
}

/** Cuántas vistas de porciones se guardan por receta, como máximo. */
const MAX_VISTAS_ = 6;

/**
 * POST receta.porciones { id, porciones, quitar? }
 * Pone `porciones` al frente de las vistas de la receta (la última usada va primero) o, con `quitar`, la saca.
 */
function accionRecetaPorciones_(req) {
  const porciones = Number(req.porciones);
  if (!Number.isInteger(porciones) || porciones < 1 || porciones > 999) {
    throw errorApi_('porciones_invalidas', 400, '«porciones» tiene que ser un número entero desde 1.');
  }
  const quitar = req.quitar === true || req.quitar === 'true';

  return conLock_(() => {
    exigirColumnas_('Recetas', ['porciones_vistas']);
    const receta = filaReceta_(req.id);
    const vistas = listaPorciones_(receta.datos.porciones_vistas).filter(n => n !== porciones);
    if (!quitar) vistas.unshift(porciones);
    receta.datos.porciones_vistas = vistas.slice(0, MAX_VISTAS_).join(',');
    receta.datos.actualizado = ahoraIso_();
    escribirFila_('Recetas', receta.fila, receta.datos);
    return { id: receta.datos.id, porciones_vistas: receta.datos.porciones_vistas };
  });
}

/** «12, 3,6» → [12, 3, 6], sin repetidos ni basura. */
function listaPorciones_(texto) {
  return String(texto || '').split(',')
    .map(s => Number(s.trim()))
    .filter((n, i, lista) => Number.isInteger(n) && n > 0 && lista.indexOf(n) === i);
}

/**
 * POST receta.ingredientes { id, ingredientes: [{ id, seccion, rol }] }
 * Los usuarios cambian el rol o la sección de algunos ingredientes. Se guarda
 * aparte (rol_usuario, seccion_usuario), así reprocesar la receta no lo pisa.
 */
function accionRecetaIngredientes_(req) {
  return editarIngredientes_(req, false);
}

/**
 * POST receta.clasificar { id, ingredientes: [{ id, seccion, rol }] }
 * /recetas --clasificar completa la sección y el rol de una receta ya guardada,
 * sin reprocesarla. Tienen que venir todos sus ingredientes.
 */
function accionRecetaClasificar_(req) {
  return editarIngredientes_(req, true);
}

function editarIngredientes_(req, deProceso) {
  const lista = Array.isArray(req.ingredientes) ? req.ingredientes : [];
  if (!lista.length) throw errorApi_('sin_ingredientes', 400, 'Falta «ingredientes».');
  const errores = [];
  const cambios = {};
  lista.forEach((ing, i) => {
    const donde = 'ingrediente ' + (i + 1);
    ing = ing || {};
    const id = String(ing.id || '').trim();
    const rol = String(ing.rol || '').trim();
    const seccion = vacio_(ing.seccion) ? '' : String(ing.seccion).trim();
    if (!id) errores.push(donde + ': falta el id');
    else if (cambios[id]) errores.push(donde + ': «' + id + '» está repetido');
    if (ENUMS.rol.indexOf(rol) === -1) errores.push(donde + ': rol «' + rol + '» no es válido (' + ENUMS.rol.join(', ') + ')');
    if (seccion.length > 40) errores.push(donde + ': la sección tiene que ser corta');
    if (seccion === SIN_SECCION) errores.push(donde + ': «' + SIN_SECCION + '» no es una sección');
    if (id) cambios[id] = { rol: rol, seccion: seccion };
  });
  if (errores.length) {
    const err = errorApi_('ingredientes_invalidos', 400, 'Revisá los ingredientes: ' + errores.join('; ') + '.');
    err.detalles = errores;
    throw err;
  }

  return conLock_(() => {
    exigirColumnas_('Ingredientes', ['seccion', 'rol', 'seccion_usuario', 'rol_usuario']);
    const receta = filaReceta_(req.id);
    const filas = leerFilas_('Ingredientes').filter(f => f.datos.receta_id === receta.datos.id);
    const ids = filas.map(f => f.datos.id);
    const ajenos = Object.keys(cambios).filter(id => ids.indexOf(id) === -1);
    if (ajenos.length) {
      throw errorApi_('ingredientes_cambiaron', 409,
        'La receta cambió mientras tanto (no tiene ' + ajenos.join(', ') + '). Volvé a editar los ingredientes.');
    }
    const faltan = deProceso ? ids.filter(id => !cambios[id]) : [];
    if (faltan.length) throw errorApi_('faltan_ingredientes', 400, 'Faltan ingredientes de la receta: ' + faltan.join(', ') + '.');

    filas.filter(f => cambios[f.datos.id]).forEach(f => {
      const c = cambios[f.datos.id];
      const d = f.datos;
      if (deProceso) {
        d.rol = c.rol;
        d.seccion = c.seccion;
        if (d.rol_usuario) d.rol_usuario = rolUsuario_(d.rol_usuario, d.rol);
        if (d.seccion_usuario) d.seccion_usuario = seccionUsuario_(seccionElegida_(d.seccion_usuario), d.seccion);
      } else {
        d.rol_usuario = rolUsuario_(c.rol, d.rol);
        d.seccion_usuario = seccionUsuario_(c.seccion, d.seccion);
      }
      escribirFila_('Ingredientes', f.fila, d);
    });
    // Así el próximo delta de `todo` lleva los ingredientes al otro celular.
    receta.datos.actualizado = ahoraIso_();
    escribirFila_('Recetas', receta.fila, receta.datos);
    return { id: receta.datos.id, ingredientes: Object.keys(cambios).length };
  });
}

/**
 * POST nota.agregar { id?, receta_id, quien, texto, fecha? }
 * La app manda su propio id: si la nota ya llegó (un reintento), responde lo mismo sin duplicarla.
 */
function accionNotaAgregar_(req) {
  const recetaId = String(req.receta_id || '').trim();
  if (!recetaId) throw errorApi_('sin_receta', 400, 'Falta «receta_id».');
  const quien = String(req.quien || '').trim().toLowerCase();
  if (ENUMS.quien.indexOf(quien) === -1) {
    throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');
  }
  const texto = String(req.texto || '').trim();
  if (!texto) throw errorApi_('sin_texto', 400, 'La nota está vacía.');
  if (texto.length > 2000) throw errorApi_('texto_largo', 400, 'La nota es muy larga (máximo 2000 caracteres).');
  const idPedido = String(req.id || '').trim();
  if (idPedido && !/^n_[0-9a-z]{5,12}$/.test(idPedido)) throw errorApi_('id_invalido', 400, '«' + idPedido + '» no es un id de nota.');
  const fechaMs = vacio_(req.fecha) ? NaN : Date.parse(req.fecha);
  if (!vacio_(req.fecha) && isNaN(fechaMs)) throw errorApi_('fecha_invalida', 400, '«fecha» tiene que ser una fecha ISO.');

  return conLock_(() => {
    exigirColumnas_('Notas', ['creado']);
    filaReceta_(recetaId);
    const notas = leerDatos_('Notas');
    const existente = idPedido ? notas.filter(n => n.id === idPedido)[0] : null;
    if (existente) {
      if (existente.receta_id !== recetaId) throw errorApi_('id_usado', 409, 'El id «' + idPedido + '» ya es de otra nota.');
      return { id: existente.id, fecha: existente.fecha, repetida: true };
    }
    const ahora = ahoraIso_();
    const nota = {
      id: idPedido || nuevoId_(ESQUEMA.Notas.prefijo, notas.map(n => n.id)),
      receta_id: recetaId,
      // Un reloj adelantado no puede dejar una nota en el futuro.
      fecha: !isNaN(fechaMs) && fechaMs <= Date.parse(ahora) ? new Date(fechaMs).toISOString() : ahora,
      quien: quien,
      texto: texto,
      creado: ahora,
    };
    agregarFila_('Notas', nota);
    return { id: nota.id, fecha: nota.fecha };
  });
}
