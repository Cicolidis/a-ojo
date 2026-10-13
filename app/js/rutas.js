// Rutas por hash: #/, #/receta/:id, #/cocina/:id, #/ingredientes/:id, #/compras,
// #/compras/recetas, #/compras/agregar/:id, #/lugares, #/bandeja y #/config?…  Pura.

export function leerRuta(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const ruta = h.split('?')[0].replace(/\/+$/, '') || '/';
  let m;
  if (ruta === '/') return { nombre: 'biblioteca' };
  if ((m = /^\/receta\/([\w-]+)$/.exec(ruta))) return { nombre: 'receta', id: m[1] };
  if ((m = /^\/cocina\/([\w-]+)$/.exec(ruta))) return { nombre: 'cocina', id: m[1] };
  if ((m = /^\/ingredientes\/([\w-]+)$/.exec(ruta))) return { nombre: 'ingredientes', id: m[1] };
  if (ruta === '/compras') return { nombre: 'compras' };
  if (ruta === '/compras/recetas') return { nombre: 'elegir' };
  if ((m = /^\/compras\/agregar\/([\w-]+)$/.exec(ruta))) return { nombre: 'agregar', id: m[1] };
  if (ruta === '/lugares') return { nombre: 'lugares' };
  if (ruta === '/bandeja') return { nombre: 'bandeja' };
  if (ruta === '/config') return { nombre: 'config' };
  return { nombre: 'biblioteca' };
}
