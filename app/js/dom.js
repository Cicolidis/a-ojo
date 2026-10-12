// Armado del DOM. El texto de las recetas viene de captions y videos de terceros:
// siempre va con textContent, nunca con innerHTML.

/**
 * h('a', { class: 'x', href: '#/', onclick: fn }, 'texto', otroNodo, [más], null)
 * Atributos: `class`, `on<evento>`, booleanos (true/false) y el resto como texto.
 * Hijos: nodos o texto; los null, undefined y false se saltean.
 */
export function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta);
  Object.entries(atributos || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  });
  agregar(el, hijos);
  return el;
}

/** Reemplaza el contenido de `el`, con los mismos hijos que acepta h() (listas, null…). */
export function rellenar(el, ...hijos) {
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  hijos.forEach(hijo => {
    if (hijo === null || hijo === undefined || hijo === false) return;
    if (Array.isArray(hijo)) agregar(el, hijo);
    else el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  });
}

// Íconos de trazo de 2 px con puntas redondeadas (§8). Son SVG fijos del código, no datos.
const TRAZOS = {
  buscar: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  volver: '<path d="M15 6l-6 6 6 6"/>',
  cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  derecha: '<path d="M9 6l6 6-6 6"/>',
  externo: '<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>',
  reloj: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  aviso: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  cocinar: '<path d="M4 11h16v2a7 7 0 01-7 7h-2a7 7 0 01-7-7z"/><path d="M8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  recetas: '<path d="M4 5.5c2.5-1 5.5-1 8 .5v13c-2.5-1.5-5.5-1.5-8-.5z"/><path d="M20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z"/>',
  compras: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 10V7a3 3 0 016 0v3"/>',
  bandeja: '<path d="M4 13l2.5-8h11l2.5 8v6H4z"/><path d="M4 13h4.5l1 2.5h5l1-2.5H20"/>',
  mover: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
  compartir: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  imagen: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
};

export function icono(nombre, tamano = 20) {
  const span = document.createElement('span');
  span.className = 'icono';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${tamano}" height="${tamano}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TRAZOS[nombre] || ''}</svg>`;
  return span;
}

/** Color de fondo para las fotos que faltan o no cargan: uno cálido, fijo por receta. */
const RELLENOS = ['#5A3A28', '#C99A5B', '#7C8455', '#D8B78A', '#8A5A3C', '#B5835A'];

export function relleno(id) {
  let n = 0;
  for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return RELLENOS[n % RELLENOS.length];
}

/** Foto de una receta, sobre su color de relleno. Si no hay foto o no carga, queda el color. */
export function foto(receta, clase) {
  const marco = h('div', { class: clase });
  marco.style.backgroundColor = relleno(receta.id);
  if (/^(https:\/\/|\/)/.test(receta.foto_url || '')) {
    const img = h('img', { src: receta.foto_url, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    marco.append(img);
  }
  return marco;
}

/** Solo links http(s): la fuente viene de la Sheet y no tiene que poder ser `javascript:`. */
export function urlSegura(url) {
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : null;
}
