const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extraerUrl, normalizarUrl } = require('../apps-script/src/Url.js');

function esperar(entrada, url, plataforma, clave) {
  const r = normalizarUrl(entrada);
  assert.ok(r, 'no normalizó: ' + entrada);
  assert.equal(r.url, url);
  assert.equal(r.plataforma, plataforma);
  if (clave) assert.equal(r.clave, clave);
  return r;
}

function mismaClave(a, b) {
  assert.equal(normalizarUrl(a).clave, normalizarUrl(b).clave, a + ' vs ' + b);
}

test('lote real del 27/09 (§6.5)', () => {
  esperar('youtube.com/shorts/cyTOswdJ4TY', 'https://www.youtube.com/shorts/cyTOswdJ4TY', 'youtube', 'youtube:cyTOswdJ4TY');
  esperar('https://youtube.com/shorts/a2qRJHVeJwk?si=Xy12AbCdEf', 'https://www.youtube.com/shorts/a2qRJHVeJwk', 'youtube', 'youtube:a2qRJHVeJwk');
  esperar('https://www.youtube.com/shorts/gAyX-DCnlwI', 'https://www.youtube.com/shorts/gAyX-DCnlwI', 'youtube', 'youtube:gAyX-DCnlwI');
  esperar('https://youtube.com/shorts/Y1QJJrXkqgw?feature=share', 'https://www.youtube.com/shorts/Y1QJJrXkqgw', 'youtube', 'youtube:Y1QJJrXkqgw');
  esperar('https://www.instagram.com/reel/Ddthx0exm4L/?igsh=MWx4dGZ6', 'https://www.instagram.com/reel/Ddthx0exm4L/', 'instagram', 'instagram:Ddthx0exm4L');
  esperar('instagram.com/reel/DdpNR_7N6hm', 'https://www.instagram.com/reel/DdpNR_7N6hm/', 'instagram', 'instagram:DdpNR_7N6hm');
  esperar('https://instagram.com/reel/DUyzCo6ETRP', 'https://www.instagram.com/reel/DUyzCo6ETRP/', 'instagram', 'instagram:DUyzCo6ETRP');
  esperar('https://www.instagram.com/reel/Dai7vRBSXvl/?utm_source=ig_web_copy_link', 'https://www.instagram.com/reel/Dai7vRBSXvl/', 'instagram', 'instagram:Dai7vRBSXvl');
});

test('YouTube: todas las formas del mismo video dan la misma clave', () => {
  const corto = 'https://www.youtube.com/shorts/cyTOswdJ4TY';
  mismaClave(corto, 'https://youtube.com/shorts/cyTOswdJ4TY?si=abc');
  mismaClave(corto, 'https://youtube.com/shorts/cyTOswdJ4TY?si=otro');
  mismaClave(corto, 'https://m.youtube.com/shorts/cyTOswdJ4TY?feature=share');
  mismaClave(corto, 'https://youtu.be/cyTOswdJ4TY?si=abc');
  mismaClave(corto, 'https://www.youtube.com/watch?v=cyTOswdJ4TY&t=30s&list=PL123');
  mismaClave(corto, 'https://www.youtube.com/watch?app=desktop&v=cyTOswdJ4TY');
  mismaClave(corto, 'https://www.youtube.com/live/cyTOswdJ4TY');
  mismaClave(corto, 'https://www.youtube.com/embed/cyTOswdJ4TY');
});

test('YouTube: lo que no es Short queda como watch?v=', () => {
  esperar('https://youtu.be/Y1QJJrXkqgw?si=x', 'https://www.youtube.com/watch?v=Y1QJJrXkqgw', 'youtube');
  esperar('https://www.youtube.com/watch?v=Y1QJJrXkqgw&t=12', 'https://www.youtube.com/watch?v=Y1QJJrXkqgw', 'youtube');
});

test('YouTube sin video (canal) se guarda limpio', () => {
  esperar('https://www.youtube.com/@cocinero?si=abc', 'https://www.youtube.com/@cocinero', 'youtube');
});

test('Instagram: variantes del mismo post', () => {
  const reel = 'https://www.instagram.com/reel/Ddthx0exm4L/';
  mismaClave(reel, 'https://www.instagram.com/reels/Ddthx0exm4L/');
  mismaClave(reel, 'https://www.instagram.com/reel/Ddthx0exm4L');
  mismaClave(reel, 'https://instagram.com/reel/Ddthx0exm4L/?igsh=abc123==');
  mismaClave(reel, 'https://www.instagram.com/cocina.rica/reel/Ddthx0exm4L/');
  mismaClave(reel, 'https://www.instagram.com/p/Ddthx0exm4L/');
  esperar('https://www.instagram.com/p/Ddthx0exm4L/?img_index=1', 'https://www.instagram.com/p/Ddthx0exm4L/', 'instagram');
  esperar('https://www.instagram.com/tv/Ddthx0exm4L', 'https://www.instagram.com/reel/Ddthx0exm4L/', 'instagram');
  esperar('https://www.instagram.com/cocina.rica/reel/Ddthx0exm4L/', 'https://www.instagram.com/reel/Ddthx0exm4L/', 'instagram');
});

test('texto compartido con cosas alrededor', () => {
  esperar('Mirá este reel https://www.instagram.com/reel/Ddthx0exm4L/?igsh=abc qué rico!',
    'https://www.instagram.com/reel/Ddthx0exm4L/', 'instagram');
  esperar('Receta (https://youtu.be/cyTOswdJ4TY).', 'https://www.youtube.com/watch?v=cyTOswdJ4TY', 'youtube');
  esperar('Mirá esto: https://youtube.com/shorts/cyTOswdJ4TY?si=abc\nbesos', 'https://www.youtube.com/shorts/cyTOswdJ4TY', 'youtube');
  esperar('«https://www.instagram.com/reel/Ddthx0exm4L/»', 'https://www.instagram.com/reel/Ddthx0exm4L/', 'instagram');
});

test('web: saca tracking y fragmento, conserva los parámetros propios', () => {
  esperar('https://www.Recetas.com/banana-bread/?utm_source=yt&utm_medium=x&page=2#comentarios',
    'https://www.recetas.com/banana-bread/?page=2', 'web');
  esperar('https://example.com', 'https://example.com/', 'web');
  mismaClave('https://www.recetas.com/banana-bread/?page=2', 'http://recetas.com/banana-bread?page=2&fbclid=abc');
  assert.notEqual(normalizarUrl('https://recetas.com/a?page=2').clave, normalizarUrl('https://recetas.com/a?page=3').clave);
});

test('otras redes van como "otro"', () => {
  assert.equal(normalizarUrl('https://www.tiktok.com/@alguien/video/7300000000000000000').plataforma, 'otro');
  assert.equal(normalizarUrl('https://vm.tiktok.com/ZMabc123/').plataforma, 'otro');
  assert.equal(normalizarUrl('https://fb.watch/abc123/').plataforma, 'otro');
  assert.equal(normalizarUrl('https://x.com/alguien/status/123').plataforma, 'otro');
});

test('sin link: null', () => {
  assert.equal(normalizarUrl('hola, sin link'), null);
  assert.equal(normalizarUrl(''), null);
  assert.equal(normalizarUrl(null), null);
  assert.equal(normalizarUrl(undefined), null);
  assert.equal(normalizarUrl('ftp://example.com/archivo'), null);
  assert.equal(extraerUrl('chrome://extensions'), null);
});
