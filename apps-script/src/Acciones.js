/**
 * Acciones de la API (§4). Cada una recibe la petición ya validada y devuelve `data`.
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
      capturas: '',
      pedido: '',
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
 * Compras, Lugares, Despensa y Plan, que van siempre completas (son chicas y así cubren los borrados).
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
    // Antes de correr setup() la hoja no existe: la app usa el lugar por defecto.
    const lugares = planilla_().getSheetByName('Lugares') ? leerDatos_('Lugares') : [];
    // Siempre entera, como Compras y Lugares: así los borrados llegan al otro celular.
    const despensa = planilla_().getSheetByName('Despensa') ? leerDatos_('Despensa') : [];
    // El plan semanal, también entero (el backup lo poda: son pocas semanas).
    const plan = planilla_().getSheetByName('Plan') ? leerDatos_('Plan') : [];

    if (since) {
      recetas = recetas.filter(r => cambio(r.actualizado));
      const ids = recetas.map(r => r.id);
      ingredientes = ingredientes.filter(i => ids.indexOf(i.receta_id) !== -1);
      pasos = pasos.filter(p => ids.indexOf(p.receta_id) !== -1);
      // Una nota escrita sin conexión llega con una `fecha` vieja: cuenta cuándo llegó.
      // Y una editada o borrada, cuándo cambió.
      notas = notas.filter(n => cambio(n.creado || n.fecha) || (n.actualizado && cambio(n.actualizado)));
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
      lugares: lugares,
      despensa: despensa,
      plan: plan,
      bandeja: bandeja,
    };
  });
}

/**
 * GET bandeja.pendientes: filas `pendiente`, de la más vieja a la más nueva (las usa /recetas).
 * También devuelve las que quedaron trabadas en `procesando` por una corrida que se cortó.
 */
function accionBandejaPendientes_() {
  const filas = leerDatos_('Bandeja').filter(paraProcesar_).sort(porCreado_);
  return { filas: filas };
}

/** ¿Una corrida que se cortó dejó esta fila en `procesando` hace más de MINUTOS_TRABADA_? */
function trabada_(b) {
  return b.estado === 'procesando' && !(Date.parse(b.actualizado) > Date.now() - MINUTOS_TRABADA_ * 60 * 1000);
}

/** Lo que /recetas procesa: las `pendiente` y las trabadas. */
function paraProcesar_(b) {
  return b.estado === 'pendiente' || trabada_(b);
}

/** De la más vieja a la más nueva. */
function porCreado_(a, b) {
  return a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0;
}

const MAX_TOMAR_ = 20;

/**
 * POST bandeja.tomar { limite?, id? } (la usa /recetas, de a una)
 * Reserva filas para procesar dentro del lock: las pasa a `procesando`, suma un
 * intento y las devuelve. Así dos corridas a la vez (la Mac y la computadora de
 * Laura) nunca toman la misma. Sin `id`: las de bandeja.pendientes, de la más
 * vieja a la más nueva, hasta `limite` (1 si no viene). Con `id`: esa fila, esté
 * como esté (para reprocesar), salvo que otra corrida la esté procesando.
 * Devuelve { filas, quedan }: `quedan`, cuántas siguen para procesar.
 */
function accionBandejaTomar_(req) {
  const id = String(req.id || '').trim();
  const limite = req.limite === undefined || req.limite === null || req.limite === '' ? 1 : Number(req.limite);
  if (!(limite >= 1 && limite <= MAX_TOMAR_ && Math.floor(limite) === limite)) {
    throw errorApi_('limite_invalido', 400, '«limite» tiene que ser un número entero de 1 a ' + MAX_TOMAR_ + '.');
  }

  return conLock_(() => {
    const filas = leerFilas_('Bandeja');
    let elegidas;
    if (id) {
      const encontrada = filas.filter(f => f.datos.id === id)[0];
      if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + id + '» en la bandeja.');
      if (encontrada.datos.estado === 'procesando' && !trabada_(encontrada.datos)) {
        throw errorApi_('procesando', 409, 'Esa fila la está procesando otra corrida. Probá en unos minutos.');
      }
      elegidas = [encontrada];
    } else {
      elegidas = filas.filter(f => paraProcesar_(f.datos)).sort((a, b) => porCreado_(a.datos, b.datos)).slice(0, limite);
    }

    const ahora = ahoraIso_();
    elegidas.forEach(f => {
      Object.assign(f.datos, { estado: 'procesando', motivo: '', intentos: (Number(f.datos.intentos) || 0) + 1, actualizado: ahora });
      escribirFila_('Bandeja', f.fila, f.datos);
    });
    return { filas: elegidas.map(f => f.datos), quedan: filas.filter(f => paraProcesar_(f.datos)).length };
  });
}

/** GET bandeja.fila { id }: una fila cualquiera de la bandeja (la usa `/recetas <id>`), sin bajar `todo` entero. */
function accionBandejaFila_(req) {
  const id = String(req.id || '').trim();
  if (!id) throw errorApi_('sin_id', 400, 'Falta el «id» de la fila.');
  const fila = leerDatos_('Bandeja').filter(b => b.id === id)[0];
  if (!fila) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + id + '» en la bandeja.');
  return { fila: fila };
}

/** Por qué no se aplicó un cambio de la app: según dónde quedó la fila mientras tanto. */
const MOTIVOS_ESTADO_CAMBIO_ = {
  lista: 'Ese link ya es una receta: no lo cambié.',
  procesando: 'Ese link se está procesando justo ahora: no lo cambié.',
  pendiente: 'Ese link ya había vuelto a la cola: no lo cambié.',
  ayuda: 'Ese link volvió a necesitar ayuda: no lo cambié.',
  descartada: 'Ese link ya estaba descartado: no lo cambié.',
};

/** Lo mismo, para la fila de una receta propia (no tiene link). */
const MOTIVOS_ESTADO_PROPIA_ = {
  lista: 'Esa receta ya está ordenada: no la cambié.',
  procesando: 'La Mac está ordenando esa receta justo ahora: no la cambié.',
  pendiente: 'Esa receta ya había vuelto a la cola: no la cambié.',
  ayuda: 'Esa receta volvió a necesitar ayuda: no la cambié.',
  descartada: 'Esa receta ya no estaba en la bandeja: no la cambié.',
};

/**
 * POST bandeja.actualizar { id, estado, motivo?, receta_id?, desde? }
 * La usan /recetas y la app (Descartar, Probar de nuevo). Volver a `pendiente`
 * desde `ayuda` o `descartada` reinicia los intentos.
 *
 * `desde` (la app): el estado que veía la fila. Si mientras tanto cambió (la Mac
 * la dejó en `lista`, el otro celular la descartó), responde 409 y no la toca:
 * la cola descarta la edición con un aviso. Si ya está en `estado` (un reintento
 * de algo que sí llegó), responde ok sin escribir.
 */
function accionBandejaActualizar_(req) {
  const id = String(req.id || '').trim();
  const estado = String(req.estado || '').trim();
  const desde = req.desde === undefined || req.desde === null ? '' : String(req.desde).trim();
  if (!id) throw errorApi_('sin_id', 400, 'Falta el «id» de la fila.');
  if (ENUMS.estadoBandeja.indexOf(estado) === -1) {
    throw errorApi_('estado_invalido', 400, '«estado» tiene que ser uno de: ' + ENUMS.estadoBandeja.join(', ') + '.');
  }
  if (desde && ENUMS.estadoBandeja.indexOf(desde) === -1) {
    throw errorApi_('estado_invalido', 400, '«desde» tiene que ser uno de: ' + ENUMS.estadoBandeja.join(', ') + '.');
  }

  return conLock_(() => {
    const encontrada = leerFilas_('Bandeja').filter(f => f.datos.id === id)[0];
    if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + id + '» en la bandeja.');

    const datos = encontrada.datos;
    if (desde && datos.estado === estado) return { id: datos.id, estado: datos.estado, intentos: datos.intentos };
    if (desde && datos.estado !== desde) {
      const propia = datos.plataforma === 'manual';
      const motivo = (propia ? MOTIVOS_ESTADO_PROPIA_ : MOTIVOS_ESTADO_CAMBIO_)[datos.estado] ||
        (propia ? 'Esa receta cambió mientras tanto: no la cambié.' : 'Ese link cambió mientras tanto: no lo cambié.');
      const err = errorApi_('estado_cambio', 409, motivo);
      err.detalles = { estado: datos.estado };
      throw err;
    }
    if (estado === 'pendiente' && (datos.estado === 'ayuda' || datos.estado === 'descartada')) datos.intentos = 0;
    datos.estado = estado;
    datos.motivo = estado === 'ayuda' ? String(req.motivo || '') : '';
    if (estado === 'lista') datos.pedido = '';
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
 * Con `bandeja_id`, deja esa fila en `lista` y manda sus capturas (si tenía) a la
 * papelera de Drive. Con `validar`, no escribe nada (dry-run).
 */
function accionRecetaUpsert_(req) {
  const r = req.receta;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw errorApi_('sin_receta', 400, 'Falta «receta».');
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
    // Primero por id y por la fila: así se sabe si es una receta propia (sin link) antes de validar.
    const idPedido = vacio_(r.id) ? '' : String(r.id).trim();
    let existente = null;
    if (idPedido) {
      existente = porId(idPedido);
      if (!existente) throw errorApi_('no_encontrada', 404, 'No encontré la receta «' + idPedido + '».');
    }
    if (!existente && bandeja && bandeja.datos.receta_id) existente = porId(bandeja.datos.receta_id);
    const propia = existente && esPropia_(existente.datos) ? existente.datos : null;
    const v = validarReceta_(r, propia);
    // Sin la columna, los ingredientes de los pasos se perderían en silencio.
    if (v.pasos.some(p => p.ingredientes)) exigirColumnas_('Pasos', ['ingredientes']);
    // Por link, solo si tiene: con el link vacío coincidiría con cualquier receta propia.
    if (!existente && v.clave) existente = recetas.filter(f => f.datos.fuente_url && claveDe_(f.datos.fuente_url) === v.clave)[0] || null;

    // Una propia que reescribieron mientras la Mac la ordenaba: receta.escribir la volvió a `pendiente`.
    // La receta se guarda igual, pero la fila queda así para ordenar el texto nuevo. (Un reintento del
    // upsert la encuentra `lista`, no `pendiente`: no cuenta como reescrita.)
    const reescrita = !!(propia && bandeja && bandeja.datos.estado === 'pendiente');
    const resumen = Object.assign({ nueva: !existente, ingredientes: v.ingredientes.length, pasos: v.pasos.length },
      ecoPasos_(v));
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

    let capturasPapelera = 0;
    if (bandeja && reescrita) {
      Object.assign(bandeja.datos, { receta_id: id, actualizado: ahora });
      escribirFila_('Bandeja', bandeja.fila, bandeja.datos);
    } else if (bandeja) {
      const capturas = listaCapturas_(bandeja.datos.capturas);
      // Si era un pedido de corrección («Algo está mal»), ya está resuelto. El texto de una propia queda.
      Object.assign(bandeja.datos, { estado: 'lista', motivo: '', receta_id: id, pedido: '', actualizado: ahora });
      if (capturas.length) bandeja.datos.capturas = '';
      escribirFila_('Bandeja', bandeja.fila, bandeja.datos);
      // Ya cumplieron: quedan 30 días en la papelera, por si hay que reprocesar.
      if (capturas.length) capturasPapelera = capturasAPapelera_(capturas);
    }
    return Object.assign({ id: id, foto_url: datos.foto_url,
      mensaje: reescrita ? '✓ Receta guardada. La reescribieron mientras tanto: queda pendiente para la próxima corrida.' : '✓ Receta guardada' },
    resumen, reescrita ? { reescrita: true } : {}, capturasPapelera ? { capturas_papelera: capturasPapelera } : {});
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
 * `propia`: la receta propia guardada (plataforma manual), si es una. Entonces no lleva link
 * ni autor, y el título, el tipo y las porciones vacíos conservan los que pusieron ellos.
 * Devuelve { id, clave, campos, ingredientes, pasos }.
 */
function validarReceta_(r, propia) {
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

  const titulo = texto(r.titulo) || (propia ? texto(propia.titulo) : '');
  if (!titulo) errores.push('falta el título');
  const tipo = texto(r.tipo) || (propia ? texto(propia.tipo) : '');
  enLista(tipo, 'tipo', 'tipo');
  const confianza = texto(r.confianza);
  enLista(confianza, 'confianza', 'confianza');
  const origen = lista(r.origen_datos);
  if (!origen.length) errores.push('falta origen_datos');
  origen.forEach(c => enLista(c, 'capa', 'origen_datos'));
  const idioma = texto(r.idioma_original).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(idioma)) errores.push('idioma_original tiene que ser un código como «es» o «en»');
  const norm = propia ? null : normalizarUrl(r.fuente_url);
  if (!norm && !propia) errores.push('falta fuente_url (el link original)');

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
    return { texto: t, timer_min: numero(p.timer_min, donde + ': timer_min'), tip: texto(p.tip),
      ingredientes: posicionesPaso_(p.ingredientes, ings.length, donde, errores) };
  });

  const campos = {
    titulo: titulo,
    tipo: tipo,
    etiquetas: lista(r.etiquetas).join(', '),
    porciones: vacio(r.porciones) && propia ? propia.porciones : numero(r.porciones, 'porciones'),
    tiempo_min: numero(r.tiempo_min, 'tiempo_min'),
    molde: texto(r.molde),
    autor: propia ? '' : texto(r.autor),
    fuente_url: norm ? norm.url : '',
    plataforma: propia ? 'manual' : norm ? norm.plataforma : '',
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
  return { id: texto(r.id), clave: norm ? norm.clave : '', campos: campos, ingredientes: ings, pasos: ps };
}

/**
 * Para que /recetas vea si las posiciones quedaron bien: los nombres de los ingredientes de
 * cada paso («2: chocolate, manteca») y los que no están en ningún paso (salvo los utensilios).
 * Solo si la receta trae ingredientes por paso. No bloquea nada.
 */
function ecoPasos_(v) {
  if (!v.pasos.some(p => p.ingredientes)) return {};
  const usadas = {};
  const pasos = v.pasos.map((p, i) => {
    const nums = p.ingredientes ? p.ingredientes.split(',').map(Number) : [];
    nums.forEach(n => { usadas[n] = true; });
    return (i + 1) + ': ' + (nums.length ? nums.map(n => v.ingredientes[n - 1].nombre).join(', ') : '—');
  });
  const sinPaso = v.ingredientes.filter((ing, i) => !usadas[i + 1] && ing.rol !== 'utensilio').map(ing => ing.nombre);
  return Object.assign({ pasos_con_ingredientes: v.pasos.filter(p => p.ingredientes).length, ingredientes_por_paso: pasos },
    sinPaso.length ? { sin_paso: sinPaso } : {});
}

/**
 * Los ingredientes de un paso: posiciones (desde 1) en la lista de ingredientes de la receta,
 * como lista ([1, 3]) o texto («1,3»). Devuelve «1,3» o '' si no vino nada; anota los errores.
 */
function posicionesPaso_(valor, cuantos, donde, errores) {
  if (valor === undefined || valor === null || valor === '') return '';
  const crudas = Array.isArray(valor) ? valor : String(valor).split(',').map(s => s.trim()).filter(Boolean);
  const vistas = [];
  crudas.forEach(x => {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 1) {
      errores.push(donde + ': «' + x + '» no es la posición de un ingrediente (números desde 1)');
    } else if (n > cuantos) {
      errores.push(donde + ': el ingrediente ' + n + ' no existe (hay ' + cuantos + ')');
    } else if (vistas.indexOf(n) !== -1) {
      errores.push(donde + ': el ingrediente ' + n + ' está repetido');
    } else {
      vistas.push(n);
    }
  });
  return vistas.join(',');
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

const MAX_PEDIDO_ = 1000;

/**
 * POST receta.corregir { id, texto, quien? } («Algo está mal en esta receta», desde la app)
 * Deja en la bandeja un pedido de corrección para /recetas: busca la fila de la
 * receta (la más nueva con ese receta_id; si no hay, la crea con su fuente_url),
 * suma el texto a `pedido` (si ya estaba, no lo repite) y la pasa a `pendiente`
 * con los intentos en 0. Sin `texto`, cancela: vacía `pedido` y, si la fila
 * esperaba o necesitaba ayuda, vuelve a `lista`. Idempotente. Si otra corrida la
 * está procesando, 409 sin tocarla.
 */
function accionRecetaCorregir_(req) {
  // Cada pedido, en una sola línea: así un reintento lo reconoce y «una línea, un pedido» vale para /recetas.
  const texto = unaLinea_(req.texto);
  if (texto.length > MAX_PEDIDO_) throw errorApi_('pedido_largo', 400, 'El pedido puede tener hasta ' + MAX_PEDIDO_ + ' caracteres.');
  const quien = String(req.quien || '').trim().toLowerCase();
  if (quien && ENUMS.quien.indexOf(quien) === -1) {
    throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');
  }

  return conLock_(() => {
    exigirColumnas_('Bandeja', ['pedido']);
    const receta = filaReceta_(req.id).datos;
    const propia = esPropia_(receta);
    // La fila de una propia lleva su texto (y plataforma manual, que la Sheet acepta después de setup()).
    if (propia) exigirColumnas_('Bandeja', ['texto']);
    const filas = leerFilas_('Bandeja');
    let suyas = filas.filter(f => f.datos.receta_id === receta.id);
    // Una receta guardada sin bandeja_id: puede haber una fila con su link que no la tiene anotada.
    // Nunca con un link vacío (una propia): coincidiría con las filas de las otras propias.
    if (!suyas.length && receta.fuente_url) suyas = filas.filter(f => claveDe_(f.datos.url) === claveDe_(receta.fuente_url));
    suyas.sort((a, b) => porCreado_(b.datos, a.datos));
    const fila = suyas[0] || null;
    const ahora = ahoraIso_();

    if (fila && fila.datos.estado === 'procesando' && !trabada_(fila.datos)) {
      throw errorApi_('procesando', 409, 'Esa receta se está procesando justo ahora. Probá de nuevo en un rato.');
    }
    if (!texto) {
      if (!fila) return { id: null, receta_id: receta.id, estado: null, pedido: '' };
      const d = fila.datos;
      // Solo se cancela un pedido: una fila que espera por otra cosa (un reprocesado) no se toca.
      // `intentos` en 0 marca que la dejó en `lista` la app y no la Mac (la Bandeja no la cuenta como recién llegada).
      if (d.pedido) {
        const vuelve = d.estado === 'pendiente' || d.estado === 'ayuda' || d.estado === 'procesando';
        Object.assign(d, { pedido: '', motivo: '', actualizado: ahora }, vuelve ? { estado: 'lista', intentos: 0 } : {});
        escribirFila_('Bandeja', fila.fila, d);
      }
      return { id: d.id, receta_id: receta.id, estado: d.estado, pedido: '' };
    }

    // Una propia sin ordenar, o con un texto esperando a la Mac: se corrige cambiando el texto.
    if (propia) {
      const esperaTexto = fila && !fila.datos.pedido && (fila.datos.estado === 'pendiente' || fila.datos.estado === 'ayuda');
      const sinOrdenar = !leerDatos_('Ingredientes').some(i => i.receta_id === receta.id);
      if (sinOrdenar || esperaTexto) {
        throw errorApi_('texto_pendiente', 409, 'Esa receta todavía no está ordenada: cambiá el texto en lugar de pedir una corrección.');
      }
    }
    if (!fila && propia) {
      const id = nuevoId_(ESQUEMA.Bandeja.prefijo, filas.map(f => f.datos.id));
      const datos = Object.assign(filaPropia_(id, receta.id, quien || 'camilo', '', ahora), { pedido: texto });
      agregarFila_('Bandeja', datos);
      return { id: id, receta_id: receta.id, estado: 'pendiente', pedido: texto };
    }
    if (!fila) {
      const norm = normalizarUrl(receta.fuente_url);
      if (!norm) throw errorApi_('sin_fuente', 400, 'La receta no tiene un link de origen para reprocesarla.');
      const id = nuevoId_(ESQUEMA.Bandeja.prefijo, filas.map(f => f.datos.id));
      const datos = { id: id, creado: ahora, url: norm.url, plataforma: norm.plataforma, quien: quien || 'camilo',
        estado: 'pendiente', motivo: '', receta_id: receta.id, intentos: 0, actualizado: ahora, capturas: '', pedido: texto };
      agregarFila_('Bandeja', datos);
      return { id: id, receta_id: receta.id, estado: 'pendiente', pedido: texto };
    }

    const d = fila.datos;
    const pedido = unirPedido_(d.pedido, texto);
    if (pedido !== d.pedido || d.estado !== 'pendiente') {
      Object.assign(d, { pedido: pedido, estado: 'pendiente', motivo: '', intentos: 0, receta_id: receta.id, actualizado: ahora });
      escribirFila_('Bandeja', fila.fila, d);
    }
    return { id: d.id, receta_id: receta.id, estado: d.estado, pedido: d.pedido };
  });
}

/** Un texto en una sola línea, sin espacios de más alrededor de los saltos. */
function unaLinea_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Suma un pedido nuevo a los que ya había, en otra línea, salvo que ya esté (un reintento). */
function unirPedido_(anterior, texto) {
  const lineas = String(anterior || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lineas.indexOf(texto) === -1) lineas.push(texto);
  return lineas.join('\n');
}

// Recetas propias (SPEC_v2 §6): los platos que ya hacemos, sin video ni web (plataforma manual).
// Los ids (r_…, b_…) los genera la app: un reintento de la cola no duplica nada.

const ID_RECETA_ = /^r_[0-9a-z]{5,12}$/;
const ID_BANDEJA_ = /^b_[0-9a-z]{5,12}$/;
const MAX_TITULO_ = 80;
const MAX_TEXTO_ = 5000;

function esPropia_(receta) {
  return !!receta && receta.plataforma === 'manual';
}

/** La fila más nueva de una receta en la bandeja (de las que devuelve leerFilas_), o null. */
function filaDeReceta_(filas, recetaId) {
  return filas.filter(f => f.datos.receta_id === recetaId).sort((a, b) => porCreado_(b.datos, a.datos))[0] || null;
}

/** La receta escrita, con sus renglones: sin espacios al final de cada uno ni más de un renglón vacío seguido. */
function textoPropio_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function quienOpcional_(v) {
  const quien = String(v || '').trim().toLowerCase();
  if (quien && ENUMS.quien.indexOf(quien) === -1) {
    throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');
  }
  return quien;
}

/**
 * Nombre, tipo y porciones de una receta propia, validados (anota los errores). Con `todos`
 * (al crearla), el nombre y el tipo son obligatorios; si no, solo se valida lo que vino.
 */
function camposPropia_(req, errores, todos) {
  const campos = {};
  if (todos || !vacio_(req.titulo)) {
    const titulo = unaLinea_(req.titulo).replace(/\s+/g, ' ');
    if (!titulo) errores.push('falta el nombre');
    else if (titulo.length > MAX_TITULO_) errores.push('el nombre puede tener hasta ' + MAX_TITULO_ + ' caracteres');
    campos.titulo = titulo;
  }
  if (todos || !vacio_(req.tipo)) {
    const tipo = String(req.tipo || '').trim();
    if (ENUMS.tipo.indexOf(tipo) === -1) errores.push('«tipo» tiene que ser uno de: ' + ENUMS.tipo.join(', '));
    campos.tipo = tipo;
  }
  if (!vacio_(req.porciones)) {
    const porciones = Number(req.porciones);
    if (!Number.isInteger(porciones) || porciones < 1 || porciones > 999) errores.push('«porciones» tiene que ser un número entero desde 1');
    campos.porciones = porciones;
  }
  return campos;
}

function sinErrores_(errores) {
  if (!errores.length) return;
  const err = errorApi_('receta_invalida', 400, 'Revisá la receta: ' + errores.join('; ') + '.');
  err.detalles = errores;
  throw err;
}

/** La fila de la bandeja de una receta propia escrita: `pendiente`, sin link, para que /recetas la ordene. */
function filaPropia_(id, recetaId, quien, texto, ahora) {
  return { id: id, creado: ahora, url: '', plataforma: 'manual', quien: quien, estado: 'pendiente', motivo: '',
    receta_id: recetaId, intentos: 0, actualizado: ahora, capturas: '', pedido: '', texto: texto };
}

/**
 * POST receta.crear { id, titulo, tipo, porciones?, texto?, bandeja_id?, quien? }
 * Crea una receta propia (plataforma manual, sin link ni autor) y, si viene la receta escrita,
 * su fila `pendiente` en la bandeja para que /recetas la ordene. Idempotente: si la receta ya
 * existe (un reintento), no la toca; pero si falta su fila, la crea (un intento cortado a la mitad).
 */
function accionRecetaCrear_(req) {
  const id = String(req.id || '').trim();
  const errores = [];
  if (!ID_RECETA_.test(id)) errores.push('«' + id + '» no es un id de receta');
  const campos = camposPropia_(req, errores, true);
  const texto = textoPropio_(req.texto);
  if (texto.length > MAX_TEXTO_) errores.push('la receta puede tener hasta ' + MAX_TEXTO_ + ' caracteres');
  const bandejaId = String(req.bandeja_id || '').trim();
  if (texto && !ID_BANDEJA_.test(bandejaId)) errores.push('con la receta escrita hace falta un «bandeja_id» (b_…)');
  sinErrores_(errores);
  const quien = quienOpcional_(req.quien);

  return conLock_(() => {
    // Antes de escribir nada: sin setup(), la fila de la bandeja no se podría guardar.
    exigirColumnas_('Bandeja', ['texto']);
    const existente = leerFilas_('Recetas').filter(f => f.datos.id === id)[0];
    if (existente && !esPropia_(existente.datos)) throw errorApi_('id_usado', 409, 'El id «' + id + '» ya es de otra receta.');
    const fila = texto ? leerFilas_('Bandeja').filter(f => f.datos.id === bandejaId)[0] : null;
    if (fila && fila.datos.receta_id !== id) throw errorApi_('id_usado', 409, 'El id «' + bandejaId + '» ya es de otra fila de la bandeja.');
    const ahora = ahoraIso_();
    if (!existente) {
      agregarFila_('Recetas', Object.assign({
        id: id, etiquetas: '', estado: 'para_probar', valoracion: 0, porciones: null, tiempo_min: null, molde: '',
        autor: '', fuente_url: '', plataforma: 'manual', foto_url: '', confianza: '', origen_datos: '',
        idioma_original: 'es', creado: ahora, actualizado: ahora, notas_proceso: '', porciones_vistas: '',
      }, campos));
    }
    if (texto && !fila) agregarFila_('Bandeja', filaPropia_(bandejaId, id, quien, texto, ahora));
    return { id: id, bandeja_id: texto ? bandejaId : null, repetida: !!existente };
  });
}

/**
 * POST receta.editar { id, titulo?, tipo?, porciones? }: el nombre, el tipo y cuánto rinde de una
 * receta propia (las demás las cambia /recetas). Idempotente: si no cambia nada, no escribe.
 */
function accionRecetaEditar_(req) {
  const errores = [];
  const campos = camposPropia_(req, errores, false);
  if (!errores.length && !Object.keys(campos).length) errores.push('mandá «titulo», «tipo» o «porciones»');
  sinErrores_(errores);

  return conLock_(() => {
    const receta = filaReceta_(req.id);
    const d = receta.datos;
    if (!esPropia_(d)) throw errorApi_('no_propia', 400, 'Así se editan solo las recetas nuestras: las demás las corrige /recetas.');
    const cambia = Object.keys(campos).some(k => String(d[k] === null || d[k] === undefined ? '' : d[k]) !== String(campos[k]));
    if (cambia) {
      Object.assign(d, campos, { actualizado: ahoraIso_() });
      escribirFila_('Recetas', receta.fila, d);
    }
    return { id: d.id, titulo: d.titulo, tipo: d.tipo, porciones: d.porciones };
  });
}

/**
 * POST receta.escribir { id, texto, bandeja_id, quien? }
 * Escribe (o reescribe) el texto de una receta propia y deja su fila `pendiente` para que
 * /recetas la ordene: la fila `bandeja_id` o, si no existe, la más nueva de la receta, o una
 * nueva con ese id. Reescribirla vacía cualquier pedido de corrección. Si la Mac la está
 * ordenando, el texto se guarda igual: esa corrida no cierra la fila (ver receta.upsert) y
 * queda para la siguiente. Idempotente: con el mismo texto, no escribe.
 */
function accionRecetaEscribir_(req) {
  const texto = textoPropio_(req.texto);
  if (!texto) throw errorApi_('sin_texto', 400, 'La receta está vacía.');
  if (texto.length > MAX_TEXTO_) throw errorApi_('texto_largo', 400, 'La receta puede tener hasta ' + MAX_TEXTO_ + ' caracteres.');
  const bandejaId = String(req.bandeja_id || '').trim();
  if (!ID_BANDEJA_.test(bandejaId)) throw errorApi_('id_invalido', 400, '«bandeja_id» tiene que ser un id de la bandeja (b_…).');
  const quien = quienOpcional_(req.quien);

  return conLock_(() => {
    // Primero: sin setup(), el texto se perdería en silencio (y el smoke lo detecta acá).
    exigirColumnas_('Bandeja', ['texto', 'pedido']);
    const receta = filaReceta_(req.id).datos;
    if (!esPropia_(receta)) throw errorApi_('no_propia', 400, 'Solo las recetas nuestras se escriben en la app.');
    const filas = leerFilas_('Bandeja');
    const pedida = filas.filter(f => f.datos.id === bandejaId)[0];
    if (pedida && pedida.datos.receta_id !== receta.id) throw errorApi_('id_usado', 409, 'El id «' + bandejaId + '» ya es de otra fila de la bandeja.');
    const fila = pedida || filaDeReceta_(filas, receta.id);
    const ahora = ahoraIso_();
    if (!fila) {
      agregarFila_('Bandeja', filaPropia_(bandejaId, receta.id, quien, texto, ahora));
      return { bandeja_id: bandejaId, estado: 'pendiente' };
    }
    const d = fila.datos;
    const yaEsta = d.texto === texto && ['pendiente', 'procesando', 'lista'].indexOf(d.estado) !== -1;
    if (!yaEsta) {
      // `quien`: quién la escribió por última vez («Escrita por…» en la Bandeja).
      Object.assign(d, { texto: texto, estado: 'pendiente', motivo: '', intentos: 0, pedido: '', actualizado: ahora },
        quien ? { quien: quien } : {});
      escribirFila_('Bandeja', fila.fila, d);
    }
    return { bandeja_id: d.id, estado: d.estado };
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

/** La nota del `id` de la petición, dentro del lock, o un error claro. */
function filaNota_(req) {
  const id = String(req.id || '').trim();
  if (!id) throw errorApi_('sin_id', 400, 'Falta el «id» de la nota.');
  const encontrada = leerFilas_('Notas').filter(f => f.datos.id === id)[0];
  if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré esa nota: puede que la hayan borrado.');
  return encontrada;
}

/**
 * POST nota.editar { id, texto }: cambia el texto de una nota. Idempotente: con el
 * mismo texto no escribe. Una nota borrada no se edita (409, la cola avisa).
 */
function accionNotaEditar_(req) {
  const texto = String(req.texto || '').trim();
  if (!texto) throw errorApi_('sin_texto', 400, 'La nota está vacía.');
  if (texto.length > 2000) throw errorApi_('texto_largo', 400, 'La nota es muy larga (máximo 2000 caracteres).');
  return conLock_(() => {
    exigirColumnas_('Notas', ['actualizado', 'borrada']);
    const nota = filaNota_(req);
    const d = nota.datos;
    if (d.borrada) throw errorApi_('nota_borrada', 409, 'Esa nota ya estaba borrada: no la cambié.');
    if (d.texto !== texto) {
      Object.assign(d, { texto: texto, actualizado: ahoraIso_() });
      escribirFila_('Notas', nota.fila, d);
    }
    return { id: d.id, texto: d.texto };
  });
}

/**
 * POST nota.borrar { id }: la marca como borrada (queda en la Sheet, así el otro celular
 * se entera por el delta). Idempotente.
 */
function accionNotaBorrar_(req) {
  return conLock_(() => {
    exigirColumnas_('Notas', ['actualizado', 'borrada']);
    const nota = filaNota_(req);
    const d = nota.datos;
    if (!d.borrada) {
      Object.assign(d, { borrada: true, actualizado: ahoraIso_() });
      escribirFila_('Notas', nota.fila, d);
    }
    return { id: d.id, borrada: true };
  });
}

// Lista de compras (§7.2). Los ids de los ítems los genera la app: un reintento no duplica nada.

const ID_COMPRA_ = /^c_[0-9a-z]{5,12}$/;
const MAX_ITEMS_COMPRA_ = 150;

/** Los `ids` de la petición, validados con `patron` (de compras, de la despensa…). */
function idsValidos_(req, patron, que) {
  const ids = Array.isArray(req.ids) ? req.ids.map(id => String(id || '').trim()) : [];
  if (!ids.length) throw errorApi_('sin_ids', 400, 'Falta «ids».');
  if (ids.length > MAX_ITEMS_COMPRA_) throw errorApi_('demasiados', 400, 'Son demasiados ítems de una vez.');
  const malos = ids.filter(id => !patron.test(id));
  if (malos.length) throw errorApi_('id_invalido', 400, 'No son ids de ' + que + ': ' + malos.join(', ') + '.');
  return ids;
}

function idsCompras_(req) {
  return idsValidos_(req, ID_COMPRA_, 'compras');
}

/** Filas de Compras con esos ids (las que ya no existen se ignoran: las borró el otro celular). */
function filasCompras_(ids) {
  return leerFilas_('Compras').filter(f => ids.indexOf(f.datos.id) !== -1);
}

/**
 * POST compras.agregar { receta_id?, porciones?, items: [{ id, nombre, cantidad, unidad, gondola, rol, lugar? }] }
 * Suma los ítems que todavía no están (por id). Con `receta_id`, los de esa receta que ya
 * están (la app reusa sus ids al volver a agregarla) se actualizan: cantidad, porciones, rol…,
 * sin tocar adónde los movieron; siguen marcados salvo que ahora haga falta más de algo que
 * se compra (misma unidad, más cantidad). Los de esa receta que no vengan se borran.
 */
function accionComprasAgregar_(req) {
  const lista = Array.isArray(req.items) ? req.items : [];
  if (!lista.length) throw errorApi_('sin_items', 400, 'Falta «items».');
  if (lista.length > MAX_ITEMS_COMPRA_) throw errorApi_('demasiados', 400, 'Son demasiados ítems de una vez.');
  const recetaId = vacio_(req.receta_id) ? '' : String(req.receta_id).trim();
  let porciones = null;
  if (!vacio_(req.porciones)) {
    porciones = Number(req.porciones);
    if (!Number.isInteger(porciones) || porciones < 1 || porciones > 999) {
      throw errorApi_('porciones_invalidas', 400, '«porciones» tiene que ser un número entero desde 1.');
    }
  }

  const errores = [];
  const vistos = {};
  const items = lista.map((it, i) => {
    const donde = 'ítem ' + (i + 1);
    it = it || {};
    const id = String(it.id || '').trim();
    if (!ID_COMPRA_.test(id)) errores.push(donde + ': «' + id + '» no es un id de compras');
    else if (vistos[id]) errores.push(donde + ': «' + id + '» está repetido');
    vistos[id] = true;
    const nombre = vacio_(it.nombre) ? '' : String(it.nombre).trim();
    if (!nombre) errores.push(donde + ': falta el nombre');
    if (nombre.length > 80) errores.push(donde + ': el nombre es muy largo');
    const unidad = vacio_(it.unidad) ? 'a ojo' : String(it.unidad).trim();
    if (ENUMS.unidad.indexOf(unidad) === -1) errores.push(donde + ': unidad «' + unidad + '» no es válida');
    let cantidad = null;
    if (!vacio_(it.cantidad)) {
      cantidad = Number(it.cantidad);
      if (!isFinite(cantidad) || cantidad <= 0) errores.push(donde + ': la cantidad tiene que ser un número mayor que 0');
      if (unidad === 'a ojo') errores.push(donde + ': con unidad «a ojo» la cantidad va vacía');
    }
    const gondola = vacio_(it.gondola) ? '' : String(it.gondola).trim();
    if (gondola && ENUMS.gondola.indexOf(gondola) === -1) errores.push(donde + ': góndola «' + gondola + '» no es válida');
    const rol = vacio_(it.rol) ? 'principal' : String(it.rol).trim();
    if (ENUMS.rol.indexOf(rol) === -1) errores.push(donde + ': rol «' + rol + '» no es válido');
    const lugar = vacio_(it.lugar) ? '' : String(it.lugar).trim();
    if (lugar && ENUMS.lugarCompra.indexOf(lugar) === -1) errores.push(donde + ': lugar «' + lugar + '» no es válido');
    return { id: id, nombre: nombre, cantidad: cantidad, unidad: unidad, gondola: gondola, rol: rol, lugar: lugar };
  });
  if (errores.length) {
    const err = errorApi_('items_invalidos', 400, 'Revisá la lista: ' + errores.join('; ') + '.');
    err.detalles = errores;
    throw err;
  }

  return conLock_(() => {
    exigirColumnas_('Compras', ['rol', 'lugar', 'porciones']);
    if (recetaId) filaReceta_(recetaId);
    const filas = leerFilas_('Compras');
    const ids = items.map(it => it.id);
    // Volver a agregar la receta (la app reusa los ids): los que ya están se actualizan
    // (cantidad, porciones, rol…) sin tocar lo que eligieron en la lista: si está marcado y adónde lo movieron.
    // Antes de borrar, que corre los números de fila.
    let actualizados = 0;
    filas.forEach(f => {
      const it = items.filter(x => x.id === f.datos.id)[0];
      if (!it || !recetaId || f.datos.receta_id !== recetaId) return;
      const nuevos = { nombre: it.nombre, cantidad: it.cantidad, unidad: it.unidad, gondola: it.gondola, rol: it.rol,
        porciones: porciones, hecho: f.datos.hecho && !haceFaltaMas_(f.datos, it) };
      const cambia = Object.keys(nuevos).some(k => String(f.datos[k] === null || f.datos[k] === undefined ? '' : f.datos[k])
        !== String(nuevos[k] === null || nuevos[k] === undefined ? '' : nuevos[k]));
      if (!cambia) return;
      Object.assign(f.datos, nuevos);
      escribirFila_('Compras', f.fila, f.datos);
      actualizados++;
    });
    const sobran = recetaId ? filas.filter(f => f.datos.receta_id === recetaId && ids.indexOf(f.datos.id) === -1) : [];
    borrarFilas_('Compras', sobran.map(f => f.fila));
    const existentes = filas.map(f => f.datos.id);
    const ahora = ahoraIso_();
    const nuevos = items.filter(it => existentes.indexOf(it.id) === -1).map(it => Object.assign({}, it, {
      receta_id: recetaId,
      porciones: porciones,
      hecho: false,
      creado: ahora,
    }));
    agregarFilas_('Compras', nuevos);
    return { ids: ids, nuevos: nuevos.length, actualizados: actualizados, quitados: sobran.length };
  });
}

/**
 * ¿Un ítem marcado como comprado tiene que volver a la lista? Si ahora hace falta más
 * (misma unidad, más cantidad) y es algo que se compra: en «Revisá si tenés», «lo tengo» sigue valiendo.
 * No mira la despensa (la calcula la app): lo que está «En casa» y se tildó, si ahora hace falta más, se revisa de nuevo.
 */
function haceFaltaMas_(viejo, nuevo) {
  const aRevisar = viejo.lugar === REVISAR || (!viejo.lugar && (nuevo.rol === 'condimento' || nuevo.rol === 'utensilio'));
  return !aRevisar && viejo.unidad === nuevo.unidad && Number(nuevo.cantidad) > Number(viejo.cantidad || 0);
}

/** POST compras.marcar { ids, hecho } */
function accionComprasMarcar_(req) {
  const ids = idsCompras_(req);
  if (req.hecho !== true && req.hecho !== false && req.hecho !== 'true' && req.hecho !== 'false') {
    throw errorApi_('sin_hecho', 400, '«hecho» tiene que ser true o false.');
  }
  const hecho = req.hecho === true || req.hecho === 'true';
  return conLock_(() => {
    const filas = filasCompras_(ids);
    filas.forEach(f => {
      f.datos.hecho = hecho;
      escribirFila_('Compras', f.fila, f.datos);
    });
    return { ids: filas.map(f => f.datos.id), hecho: hecho };
  });
}

/** POST compras.mover { ids, lugar } (vacío: el que da la regla) */
function accionComprasMover_(req) {
  const ids = idsCompras_(req);
  const lugar = vacio_(req.lugar) ? '' : String(req.lugar).trim();
  if (lugar && ENUMS.lugarCompra.indexOf(lugar) === -1) {
    throw errorApi_('lugar_invalido', 400, '«lugar» tiene que ser uno de: ' + ENUMS.lugarCompra.join(', ') + ' (o vacío).');
  }
  return conLock_(() => {
    exigirColumnas_('Compras', ['lugar']);
    const filas = filasCompras_(ids);
    filas.forEach(f => {
      f.datos.lugar = lugar;
      escribirFila_('Compras', f.fila, f.datos);
    });
    return { ids: filas.map(f => f.datos.id), lugar: lugar };
  });
}

/** POST compras.quitar { ids }: limpiar los marcados, sacar una receta o un ítem. */
function accionComprasQuitar_(req) {
  const ids = idsCompras_(req);
  return conLock_(() => {
    const filas = filasCompras_(ids);
    borrarFilas_('Compras', filas.map(f => f.fila));
    return { quitados: filas.length };
  });
}

// Despensa (SPEC_v2 §2 y §5): lo que hay en casa. Los ids d_… los genera la app.

const ID_DESPENSA_ = /^d_[0-9a-z]{5,12}$/;

/** La misma palabra en singular o plural: huevo/huevos, limón/limones (como mismaPalabra de app/js/compras.js). */
function mismaPalabra_(a, b) {
  return a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
}

/** ¿Es el mismo nombre? Sin tildes ni mayúsculas y tolerante a plurales simples (como mismoNombre de la app). */
function mismoNombre_(a, b) {
  const x = claveTexto_(a).split(' ').filter(String);
  const y = claveTexto_(b).split(' ').filter(String);
  return x.length > 0 && x.length === y.length && x.every((p, i) => mismaPalabra_(p, y[i]));
}

/**
 * POST despensa.sumar { items: [{ id, nombre }], quien }
 * Suma lo que todavía no está: ni por id ni por nombre (sin tildes, tolerando plurales;
 * «huevo» y «Huevos» son lo mismo). Un reintento no duplica nada. Devuelve { ids, nuevos }:
 * los ids que quedaron sumados ahora.
 */
function accionDespensaSumar_(req) {
  const lista = Array.isArray(req.items) ? req.items : [];
  if (!lista.length) throw errorApi_('sin_items', 400, 'Falta «items».');
  if (lista.length > MAX_ITEMS_COMPRA_) throw errorApi_('demasiados', 400, 'Son demasiados ítems de una vez.');
  const quien = String(req.quien || '').trim().toLowerCase();
  if (ENUMS.quien.indexOf(quien) === -1) {
    throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');
  }
  const errores = [];
  const items = lista.map((it, i) => {
    const donde = 'ítem ' + (i + 1);
    it = it || {};
    const id = String(it.id || '').trim();
    if (!ID_DESPENSA_.test(id)) errores.push(donde + ': «' + id + '» no es un id de la despensa');
    const nombre = vacio_(it.nombre) ? '' : String(it.nombre).trim().replace(/\s+/g, ' ');
    if (!nombre) errores.push(donde + ': falta el nombre');
    if (nombre.length > 80) errores.push(donde + ': el nombre es muy largo');
    return { id: id, nombre: nombre };
  });
  if (errores.length) {
    const err = errorApi_('items_invalidos', 400, 'Revisá la lista: ' + errores.join('; ') + '.');
    err.detalles = errores;
    throw err;
  }

  return conLock_(() => {
    exigirColumnas_('Despensa', ['id', 'nombre', 'desde', 'quien', 'actualizado']);
    const hay = leerDatos_('Despensa');
    const ahora = ahoraIso_();
    const nuevos = [];
    items.forEach(it => {
      const ya = hay.concat(nuevos).some(d => d.id === it.id || mismoNombre_(d.nombre, it.nombre));
      if (!ya) nuevos.push({ id: it.id, nombre: it.nombre, desde: ahora, quien: quien, actualizado: ahora });
    });
    if (nuevos.length) agregarFilas_('Despensa', nuevos);
    return { ids: nuevos.map(d => d.id), nuevos: nuevos.length };
  });
}

/** POST despensa.quitar { ids }: lo que se terminó o se sacó a mano. Los que ya no están se ignoran. */
function accionDespensaQuitar_(req) {
  const ids = idsValidos_(req, ID_DESPENSA_, 'la despensa');
  return conLock_(() => {
    const filas = leerFilas_('Despensa').filter(f => ids.indexOf(f.datos.id) !== -1);
    borrarFilas_('Despensa', filas.map(f => f.fila));
    return { quitados: filas.length };
  });
}

// Plan semanal (SPEC_v2 §2 y §4). Los ids s_… los genera la app: un reintento no duplica nada.

const ID_PLAN_ = /^s_[0-9a-z]{5,12}$/;
const MAX_PLAN_ = 50;
const DIA_MS_ = 24 * 60 * 60 * 1000;

/**
 * Un día del calendario («2026-11-16») como número de días desde el 1/1/1970, o NaN si no es
 * una fecha de verdad. Se calcula en UTC: el texto es un día, sin hora ni zona.
 */
function diaNumero_(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ''));
  if (!m) return NaN;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return NaN;
  return d.getTime() / DIA_MS_;
}

/** ¿Ese número de día es un lunes? (El 1/1/1970 fue jueves.) */
function esLunes_(dia) {
  return (dia + 4) % 7 === 1;
}

/**
 * Valida y normaliza las entradas del plan (las de plan.poner). Junta todos los errores en uno solo
 * (items_invalidos, con `detalles`). Cada una: { id, semana, fecha?, comida?, receta_id, porciones? }.
 * `semana` es un lunes; `fecha`, un día de esa semana o vacía («Sin día»); `comida` va si y solo si
 * hay `fecha`; `porciones`, vacía (la receta no las dice) o un entero desde 1. No mira la planilla.
 */
function validarPlan_(lista) {
  const items = Array.isArray(lista) ? lista : [];
  if (!items.length) throw errorApi_('sin_items', 400, 'Falta «items».');
  if (items.length > MAX_PLAN_) throw errorApi_('demasiados', 400, 'Son demasiadas entradas de una vez (hasta ' + MAX_PLAN_ + ').');
  const errores = [];
  const vistos = {};
  const salida = items.map((it, i) => {
    const donde = 'entrada ' + (i + 1);
    it = it || {};
    const id = String(it.id || '').trim();
    if (!ID_PLAN_.test(id)) errores.push(donde + ': «' + id + '» no es un id del plan');
    else if (vistos[id]) errores.push(donde + ': «' + id + '» está repetido');
    vistos[id] = true;
    const semana = String(it.semana || '').trim();
    const lunes = diaNumero_(semana);
    if (isNaN(lunes)) errores.push(donde + ': «semana» tiene que ser una fecha AAAA-MM-DD');
    else if (!esLunes_(lunes)) errores.push(donde + ': «semana» tiene que ser un lunes');
    const fecha = vacio_(it.fecha) ? '' : String(it.fecha).trim();
    if (fecha) {
      const dia = diaNumero_(fecha);
      if (isNaN(dia)) errores.push(donde + ': «fecha» tiene que ser una fecha AAAA-MM-DD');
      else if (!isNaN(lunes) && (dia < lunes || dia > lunes + 6)) errores.push(donde + ': la fecha no es de esa semana');
    }
    const comida = vacio_(it.comida) ? '' : String(it.comida).trim();
    if (fecha && ENUMS.comida.indexOf(comida) === -1) errores.push(donde + ': con día, «comida» tiene que ser ' + ENUMS.comida.join(' o '));
    if (!fecha && comida) errores.push(donde + ': sin día («Sin día»), va sin comida');
    const recetaId = String(it.receta_id || '').trim();
    if (!recetaId) errores.push(donde + ': falta «receta_id»');
    let porciones = null;
    if (!vacio_(it.porciones)) {
      porciones = Number(it.porciones);
      if (!Number.isInteger(porciones) || porciones < 1 || porciones > 999) errores.push(donde + ': «porciones» tiene que ser un número entero desde 1');
    }
    return { id: id, semana: semana, fecha: fecha, comida: comida, receta_id: recetaId, porciones: porciones };
  });
  if (errores.length) {
    const err = errorApi_('items_invalidos', 400, 'Revisá el plan: ' + errores.join('; ') + '.');
    err.detalles = errores;
    throw err;
  }
  return salida;
}

/**
 * POST plan.poner { items: [{ id, semana, fecha?, comida?, receta_id, porciones? }], quitar?: [ids], quien }
 * Crea o reemplaza cada entrada por id: sirve para sumar, mover (a otro día, a la otra comida o a
 * «Sin día»), cambiar las porciones y copiar una semana entera. Al reemplazar, conserva quién la puso
 * y cuándo. `quitar` (al reemplazar una semana) se borra en el mismo lock, después de validar todo:
 * si algo falla, no se quita nada. Idempotente. Devuelve { ids, nuevos, actualizados, quitados }.
 */
function accionPlanPoner_(req) {
  const items = validarPlan_(req.items);
  const quitar = Array.isArray(req.quitar) && req.quitar.length ? idsValidos_({ ids: req.quitar }, ID_PLAN_, 'el plan') : [];
  const quien = String(req.quien || '').trim().toLowerCase();
  if (ENUMS.quien.indexOf(quien) === -1) throw errorApi_('quien_invalido', 400, '«quien» tiene que ser ' + ENUMS.quien.join(' o ') + '.');

  return conLock_(() => {
    // Antes de leer nada: sin setup(), la hoja no existe (la cola reintenta).
    exigirColumnas_('Plan', ESQUEMA.Plan.columnas.map(c => c.nombre));
    const recetas = leerDatos_('Recetas').map(r => r.id);
    const faltan = items.map(it => it.receta_id).filter((id, i, l) => recetas.indexOf(id) === -1 && l.indexOf(id) === i);
    if (faltan.length) throw errorApi_('no_encontrada', 404, 'No encontré la receta «' + faltan.join('», «') + '».');

    const filas = leerFilas_('Plan');
    const ahora = ahoraIso_();
    const campos = ['semana', 'fecha', 'comida', 'receta_id', 'porciones'];
    const comoTexto = v => (v === null || v === undefined ? '' : String(v));
    // Primero las que ya están (antes de borrar, que corre los números de fila).
    let actualizados = 0;
    filas.forEach(f => {
      const it = items.filter(x => x.id === f.datos.id)[0];
      if (!it || !campos.some(k => comoTexto(f.datos[k]) !== comoTexto(it[k]))) return;
      campos.forEach(k => { f.datos[k] = it[k]; });
      f.datos.actualizado = ahora;
      escribirFila_('Plan', f.fila, f.datos);
      actualizados++;
    });
    const sobran = filas.filter(f => quitar.indexOf(f.datos.id) !== -1 && !items.some(it => it.id === f.datos.id));
    borrarFilas_('Plan', sobran.map(f => f.fila));
    const existentes = filas.map(f => f.datos.id);
    const nuevos = items.filter(it => existentes.indexOf(it.id) === -1)
      .map(it => Object.assign({}, it, { quien: quien, creado: ahora, actualizado: ahora }));
    agregarFilas_('Plan', nuevos);
    return { ids: items.map(it => it.id), nuevos: nuevos.length, actualizados: actualizados, quitados: sobran.length };
  });
}

/** POST plan.quitar { ids }: saca entradas del plan. Las que ya no están se ignoran. */
function accionPlanQuitar_(req) {
  const ids = idsValidos_(req, ID_PLAN_, 'el plan');
  return conLock_(() => {
    const filas = leerFilas_('Plan').filter(f => ids.indexOf(f.datos.id) !== -1);
    borrarFilas_('Plan', filas.map(f => f.fila));
    return { quitados: filas.length };
  });
}

/**
 * POST lugares.asignar { por, clave, lugar }
 * Dónde se compra cada tipo de producto (la góndola) o un ingrediente puntual.
 * Por ingrediente, `lugar` vacío borra la regla; el nombre se compara sin tildes
 * ni mayúsculas, pero se guarda como vino (así se muestra bien).
 */
function accionLugaresAsignar_(req) {
  const por = String(req.por || '').trim();
  if (ENUMS.porLugar.indexOf(por) === -1) throw errorApi_('por_invalido', 400, '«por» tiene que ser «tipo» o «ingrediente».');
  const lugar = vacio_(req.lugar) ? '' : String(req.lugar).trim();
  if (lugar && ENUMS.lugar.indexOf(lugar) === -1) {
    throw errorApi_('lugar_invalido', 400, '«lugar» tiene que ser uno de: ' + ENUMS.lugar.join(', ') + '.');
  }
  let clave;
  if (por === 'tipo') {
    clave = String(req.clave || '').trim();
    if (ENUMS.gondola.indexOf(clave) === -1) throw errorApi_('clave_invalida', 400, '«' + clave + '» no es un tipo de producto.');
    if (!lugar) throw errorApi_('lugar_invalido', 400, 'Cada tipo de producto tiene que tener un lugar.');
  } else {
    clave = String(req.clave || '').replace(/\s+/g, ' ').trim();
    if (!claveTexto_(clave)) throw errorApi_('clave_invalida', 400, 'Falta el ingrediente («clave»).');
    if (clave.length > 60) throw errorApi_('clave_invalida', 400, 'El nombre del ingrediente es muy largo.');
  }
  const misma = c => (por === 'tipo' ? c === clave : claveTexto_(c) === claveTexto_(clave));

  return conLock_(() => {
    const filas = leerFilas_('Lugares').filter(f => f.datos.por === por && misma(f.datos.clave));
    // Si por alguna edición a mano quedaron dos reglas iguales, sobrevive la primera.
    borrarFilas_('Lugares', filas.slice(lugar ? 1 : 0).map(f => f.fila));
    const ahora = ahoraIso_();
    if (lugar && filas.length) {
      Object.assign(filas[0].datos, { lugar: lugar, actualizado: ahora });
      escribirFila_('Lugares', filas[0].fila, filas[0].datos);
    } else if (lugar) {
      agregarFila_('Lugares', {
        id: nuevoId_(ESQUEMA.Lugares.prefijo, leerDatos_('Lugares').map(l => l.id)),
        por: por, clave: clave, lugar: lugar, actualizado: ahora,
      });
    }
    return { por: por, clave: clave, lugar: lugar };
  });
}

// Capturas (capa 6): cuando un link necesita ayuda, suben desde la app 2 o 3 capturas del video.

const MAX_CAPTURAS_ = 6;

/** Las capturas que ya tiene una fila de la bandeja: «id1,id2» → ['id1', 'id2']. */
function listaCapturas_(texto) {
  return String(texto || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * POST capturas.subir { bandeja_id, lote, imagenes: [{ base64, mime }] }
 * Las guarda en Drive (privadas) y deja la fila en `pendiente`, sin motivo y con
 * los intentos en 0, para que /recetas la vuelva a procesar. `lote` lo genera la
 * app: si el envío se reintenta, no se duplican las imágenes.
 */
function accionCapturasSubir_(req) {
  const bandejaId = String(req.bandeja_id || '').trim();
  if (!bandejaId) throw errorApi_('sin_id', 400, 'Falta «bandeja_id».');
  const lote = String(req.lote || '').trim();
  if (!/^[0-9a-z]{6,16}$/.test(lote)) throw errorApi_('lote_invalido', 400, '«lote» tiene que ser un código de 6 a 16 letras o números.');
  const lista = Array.isArray(req.imagenes) ? req.imagenes : [];
  if (!lista.length) throw errorApi_('sin_imagenes', 400, 'Falta al menos una captura.');
  if (lista.length > MAX_CAPTURAS_) throw errorApi_('demasiadas', 400, 'Mandá hasta ' + MAX_CAPTURAS_ + ' capturas.');
  const imagenes = lista.map((img, i) => leerImagen_(img, 'La captura ' + (i + 1)));

  return conLock_(() => {
    exigirColumnas_('Bandeja', ['capturas']);
    const encontrada = leerFilas_('Bandeja').filter(f => f.datos.id === bandejaId)[0];
    if (!encontrada) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + bandejaId + '» en la bandeja.');
    const datos = encontrada.datos;
    if (datos.estado === 'lista') throw errorApi_('ya_lista', 409, 'Ese link ya es una receta.');
    if (datos.estado === 'procesando') throw errorApi_('procesando', 409, 'La Mac lo está procesando ahora. Probá en unos minutos.');

    const ids = imagenes.map((img, i) => guardarCaptura_(bandejaId + '-' + lote + '-' + (i + 1), img));
    const todas = listaCapturas_(datos.capturas);
    ids.forEach(id => { if (todas.indexOf(id) === -1) todas.push(id); });
    Object.assign(datos, { capturas: todas.join(','), estado: 'pendiente', motivo: '', intentos: 0, actualizado: ahoraIso_() });
    escribirFila_('Bandeja', encontrada.fila, datos);
    return { id: bandejaId, estado: datos.estado, capturas: todas.length };
  });
}

/** GET capturas.bajar { bandeja_id }: las capturas de la fila en base64 (las usa /recetas). */
function accionCapturasBajar_(req) {
  const bandejaId = String(req.bandeja_id || '').trim();
  if (!bandejaId) throw errorApi_('sin_id', 400, 'Falta «bandeja_id».');
  const fila = leerDatos_('Bandeja').filter(b => b.id === bandejaId)[0];
  if (!fila) throw errorApi_('no_encontrada', 404, 'No encontré la fila «' + bandejaId + '» en la bandeja.');
  return { id: bandejaId, imagenes: leerCapturas_(listaCapturas_(fila.capturas)) };
}
