/**
 * Fotos de las recetas en Drive, en la carpeta "A ojo/fotos".
 *
 * La Mac sube cada imagen en base64 y la API la deja pública con link: la PWA
 * la muestra sin sesión de Google, y las miniaturas de Instagram vencen.
 */

const MIMES_IMAGEN_ = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES_IMAGEN_ = 5 * 1024 * 1024;

/** Carpeta "A ojo/fotos": la busca o la crea, y guarda su id en Script Properties. */
function carpetaFotos_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_FOTOS');
  if (id) {
    try {
      const carpeta = DriveApp.getFolderById(id);
      if (!carpeta.isTrashed()) return carpeta;
    } catch (err) {
      // La borraron del todo: se crea de nuevo.
    }
  }
  const fotos = subcarpeta_(subcarpeta_(DriveApp.getRootFolder(), 'A ojo'), 'fotos');
  props.setProperty('CARPETA_FOTOS', fotos.getId());
  return fotos;
}

function subcarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * Valida una imagen { base64, mime } que llega por la API.
 * Acepta también un data URL ("data:image/jpeg;base64,…").
 * Devuelve { bytes, mime, extension } o tira un error 400.
 */
function leerImagen_(foto) {
  if (!foto || typeof foto !== 'object') throw errorApi_('foto_invalida', 400, '«foto» tiene que ser { base64, mime }.');
  let base64 = String(foto.base64 || '');
  let mime = String(foto.mime || '').toLowerCase();
  const m = /^data:([^;,]+);base64,/.exec(base64);
  if (m) {
    mime = mime || m[1].toLowerCase();
    base64 = base64.slice(m[0].length);
  }
  if (!MIMES_IMAGEN_[mime]) {
    throw errorApi_('foto_invalida', 400, 'La foto tiene que ser ' + Object.keys(MIMES_IMAGEN_).join(', ') + '.');
  }
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64.replace(/\s+/g, ''));
  } catch (err) {
    throw errorApi_('foto_invalida', 400, 'La foto no es base64 válido.');
  }
  if (!bytes.length) throw errorApi_('foto_invalida', 400, 'La foto está vacía.');
  if (bytes.length > MAX_BYTES_IMAGEN_) throw errorApi_('foto_invalida', 400, 'La foto pesa más de 5 MB.');
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
