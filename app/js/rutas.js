// Rutas por hash: #/, #/receta/:id, #/cocina/:id y #/config?…  Pura.

export function leerRuta(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const ruta = h.split('?')[0].replace(/\/+$/, '') || '/';
  let m;
  if (ruta === '/') return { nombre: 'biblioteca' };
  if ((m = /^\/receta\/([\w-]+)$/.exec(ruta))) return { nombre: 'receta', id: m[1] };
  if ((m = /^\/cocina\/([\w-]+)$/.exec(ruta))) return { nombre: 'cocina', id: m[1] };
  if (ruta === '/config') return { nombre: 'config' };
  return { nombre: 'biblioteca' };
}
