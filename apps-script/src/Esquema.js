/**
 * Esquema de la Sheet "A ojo — datos" (§3 de la spec).
 *
 * Fuente única para setup() y para validar lo que entra por la API.
 * Tipos de columna: texto · fecha (ISO, guardada como texto) · numero · bool.
 * Para sumar una columna: agregarla acá y volver a correr setup().
 */

const ENUMS = {
  plataforma: ['youtube', 'instagram', 'web', 'otro'],
  quien: ['camilo', 'pareja'],
  estadoBandeja: ['pendiente', 'procesando', 'lista', 'ayuda', 'descartada'],
  tipo: ['dulce', 'salado', 'sopa', 'bebida', 'otro'],
  estadoReceta: ['para_probar', 'probada', 'favorita', 'descartada'],
  confianza: ['alta', 'media', 'baja'],
  unidad: ['g', 'kg', 'ml', 'l', 'u', 'cda', 'cdita', 'taza', 'pizca', 'a ojo', 'lata', 'paquete', 'diente', 'ramo'],
  gondola: ['verdulería', 'almacén', 'lácteos y huevos', 'carnicería', 'panadería', 'congelados', 'otros'],
  // Capas de §6.1 que pueden aparecer en Recetas.origen_datos.
  capa: ['descripcion', 'subtitulos', 'web', 'audio', 'frames', 'capturas'],
  // Rol de un ingrediente en la receta: lo infaltable, lo que da sabor, lo que se puede saltear y lo que no se come.
  rol: ['principal', 'condimento', 'opcional', 'utensilio'],
};

// En Ingredientes.seccion_usuario: los usuarios sacaron el ingrediente de la sección que le puso /recetas.
const SIN_SECCION = '-';

const ESQUEMA = {
  Bandeja: {
    prefijo: 'b',
    columnas: [
      col_('id'),
      col_('creado', 'fecha'),
      col_('url'),
      col_('plataforma', 'texto', { enum: 'plataforma' }),
      col_('quien', 'texto', { enum: 'quien' }),
      col_('estado', 'texto', { enum: 'estadoBandeja' }),
      col_('motivo'),
      col_('receta_id'),
      col_('intentos', 'numero'),
      col_('actualizado', 'fecha'),
    ],
  },
  Recetas: {
    prefijo: 'r',
    columnas: [
      col_('id'),
      col_('titulo'),
      col_('tipo', 'texto', { enum: 'tipo' }),
      col_('etiquetas'),
      col_('estado', 'texto', { enum: 'estadoReceta' }),
      col_('valoracion', 'numero', { rango: [0, 5] }),
      col_('porciones', 'numero'),
      col_('tiempo_min', 'numero'),
      col_('molde'),
      col_('autor'),
      col_('fuente_url'),
      col_('plataforma'),
      col_('foto_url'),
      col_('confianza', 'texto', { enum: 'confianza' }),
      col_('origen_datos'),
      col_('idioma_original'),
      col_('creado', 'fecha'),
      col_('actualizado', 'fecha'),
      // Nota interna del procesamiento (§6.2): correcciones de transcripción y supuestos.
      col_('notas_proceso'),
      // Porciones con las que la cocinaron («12,3,6»), la última primero: las vistas de la ficha.
      col_('porciones_vistas'),
    ],
  },
  Ingredientes: {
    prefijo: 'i',
    columnas: [
      col_('id'),
      col_('receta_id'),
      col_('orden', 'numero'),
      col_('cantidad', 'numero'),
      col_('unidad', 'texto', { enum: 'unidad' }),
      col_('nombre'),
      col_('nota'),
      col_('gondola', 'texto', { enum: 'gondola' }),
      // Los asigna /recetas. Vacíos en las recetas viejas: cuentan como principal y sin sección.
      col_('seccion'),
      col_('rol', 'texto', { enum: 'rol' }),
      // Ediciones de los usuarios: reprocesar no las pisa (vacío = lo de /recetas).
      col_('seccion_usuario'),
      col_('rol_usuario', 'texto', { enum: 'rol' }),
    ],
  },
  Pasos: {
    prefijo: 'p',
    columnas: [
      col_('id'),
      col_('receta_id'),
      col_('orden', 'numero'),
      col_('texto'),
      col_('timer_min', 'numero'),
      col_('tip'),
    ],
  },
  Notas: {
    prefijo: 'n',
    columnas: [
      col_('id'),
      col_('receta_id'),
      col_('fecha', 'fecha'),
      col_('quien', 'texto', { enum: 'quien' }),
      col_('texto'),
      // Cuándo llegó a la Sheet. `fecha` es la del celular, que puede haberla escrito sin conexión.
      col_('creado', 'fecha'),
    ],
  },
  Compras: {
    prefijo: 'c',
    columnas: [
      col_('id'),
      col_('receta_id'),
      col_('nombre'),
      col_('cantidad', 'numero'),
      col_('unidad', 'texto', { enum: 'unidad' }),
      col_('gondola', 'texto', { enum: 'gondola' }),
      col_('hecho', 'bool'),
      col_('creado', 'fecha'),
    ],
  },
};

function col_(nombre, tipo, extra) {
  return Object.assign({ nombre: nombre, tipo: tipo || 'texto' }, extra || {});
}

/** { nombreColumna: tipo } de una hoja; las columnas que no están en el esquema cuentan como texto. */
function tiposDe_(hoja) {
  const tipos = {};
  (ESQUEMA[hoja] ? ESQUEMA[hoja].columnas : []).forEach(c => { tipos[c.nombre] = c.tipo; });
  return tipos;
}

function esTexto_(tipo) {
  return !tipo || tipo === 'texto' || tipo === 'fecha';
}
