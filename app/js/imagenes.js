// Capturas elegidas en el celular: se achican antes de mandarlas a la API (JPEG
// de hasta 1600 px por lado), así pesan cientos de KB y no megas. Usa canvas: no
// es puro y no tiene tests en Node.

const LADO = 1600;
const CALIDAD = 0.85;

/** Un archivo de imagen → { base64, mime } para capturas.subir. */
export async function achicarImagen(archivo) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No pude leer «' + archivo.name + '». Probá con otra imagen.');
  }
  const escala = Math.min(1, LADO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((resolver, rechazar) => canvas.toBlob(
    b => (b ? resolver(b) : rechazar(new Error('No pude convertir «' + archivo.name + '».'))), 'image/jpeg', CALIDAD));
  return { base64: await aBase64(blob), mime: 'image/jpeg' };
}

function aBase64(blob) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result).split(',')[1]);
    lector.onerror = () => rechazar(lector.error);
    lector.readAsDataURL(blob);
  });
}
