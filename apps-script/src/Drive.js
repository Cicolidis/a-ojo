/**
 * Imágenes en Drive.
 *
 * - "A ojo/fotos": las fotos de las recetas. La Mac sube cada imagen en base64 y
 *   la API la deja pública con link: la PWA la muestra sin sesión de Google, y
 *   las miniaturas de Instagram vencen.
 * - "A ojo/capturas": las capturas que suben desde la app cuando un link necesita
 *   ayuda (capa 6). Son privadas: /recetas las baja por la API, con el token.
 */

const MIMES_IMAGEN_ = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES_IMAGEN_ = 5 * 1024 * 1024;

/** Carpeta "A ojo/fotos". */
function carpetaFotos_() {
  return carpeta_('CARPETA_FOTOS', 'fotos');
}

/** Carpeta "A ojo/capturas". */
function carpetaCapturas_() {
  return carpeta_('CARPETA_CAPTURAS', 'capturas');
}

/** Carpeta "A ojo/<nombre>": la busca o la crea, y guarda su id en Script Properties. */
function carpeta_(propiedad, nombre) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(propiedad);
  if (id) {
    try {
      const carpeta = DriveApp.getFolderById(id);
      if (!carpeta.isTrashed()) return carpeta;
    } catch (err) {
      // La borraron del todo: se crea de nuevo.
    }
  }
  const carpeta = subcarpeta_(subcarpeta_(DriveApp.getRootFolder(), 'A ojo'), nombre);
  props.setProperty(propiedad, carpeta.getId());
  return carpeta;
}

function subcarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * Valida una imagen { base64, mime } que llega por la API.
 * Acepta también un data URL ("data:image/jpeg;base64,…").
 * `que` es cómo se la nombra en los errores ("La foto", "La captura 2").
 * Devuelve { bytes, mime, extension } o tira un error 400.
 */
function leerImagen_(foto, que) {
  que = que || 'La foto';
  if (!foto || typeof foto !== 'object') throw errorApi_('foto_invalida', 400, que + ' tiene que ser { base64, mime }.');
  let base64 = String(foto.base64 || '');
  let mime = String(foto.mime || '').toLowerCase();
  const m = /^data:([^;,]+);base64,/.exec(base64);
  if (m) {
    mime = mime || m[1].toLowerCase();
    base64 = base64.slice(m[0].length);
  }
  if (!MIMES_IMAGEN_[mime]) {
    throw errorApi_('foto_invalida', 400, que + ' tiene que ser ' + Object.keys(MIMES_IMAGEN_).join(', ') + '.');
  }
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64.replace(/\s+/g, ''));
  } catch (err) {
    throw errorApi_('foto_invalida', 400, que + ' no es base64 válido.');
  }
  if (!bytes.length) throw errorApi_('foto_invalida', 400, que + ' está vacía.');
  if (bytes.length > MAX_BYTES_IMAGEN_) throw errorApi_('foto_invalida', 400, que + ' pesa más de 5 MB.');
  return { bytes: bytes, mime: mime, extension: MIMES_IMAGEN_[mime] };
}

/**
 * Guarda la imagen como `base` + extensión en la carpeta de fotos. Si ya había
 * una con ese nombre base, la manda a la papelera. Devuelve una URL para <img>.
 */
function guardarImagen_(base, imagen) {
  const carpeta = carpetaFotos_();
  Object.keys(MIMES_IMAGEN_).forEach(mime => {
    const anteriores = carpeta.getFilesByName(base + '.' + MIMES_IMAGEN_[mime]);
    while (anteriores.hasNext()) anteriores.next().setTrashed(true);
  });
  const nombre = base + '.' + imagen.extension;
  const archivo = carpeta.createFile(Utilities.newBlob(imagen.bytes, imagen.mime, nombre));
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return urlImagen_(archivo.getId());
}

function urlImagen_(idArchivo) {
  return 'https://drive.google.com/thumbnail?id=' + idArchivo + '&sz=w1200';
}

/**
 * Guarda una captura con el nombre `nombre` + extensión, privada. Si ya hay una
 * con ese nombre (un reintento del mismo envío), no la duplica. Devuelve su id.
 */
function guardarCaptura_(nombre, imagen) {
  const carpeta = carpetaCapturas_();
  const completo = nombre + '.' + imagen.extension;
  const existentes = carpeta.getFilesByName(completo);
  if (existentes.hasNext()) return existentes.next().getId();
  return carpeta.createFile(Utilities.newBlob(imagen.bytes, imagen.mime, completo)).getId();
}

/** Las capturas con esos ids, en base64. Saltea las que ya no existen o están en la papelera. */
function leerCapturas_(ids) {
  const imagenes = [];
  ids.forEach(id => {
    let archivo;
    try {
      archivo = DriveApp.getFileById(id);
    } catch (err) {
      return;
    }
    if (archivo.isTrashed()) return;
    const blob = archivo.getBlob();
    imagenes.push({ id: id, nombre: archivo.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) });
  });
  return imagenes;
}
