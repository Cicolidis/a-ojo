// Pantalla de bienvenida: la app todavía no tiene configuración, o el link no sirvió.

import { h } from '../dom.js';

export function montar(contenedor, { app }, error) {
  contenedor.append(h('div', { class: 'bienvenida' },
    h('img', { src: 'iconos/icono-192.png', alt: '', width: '88', height: '88' }),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'A ojo'),
    error ? h('p', { class: 'error', role: 'alert' }, error) : null,
    h('p', null, 'Para empezar, abrí el link de configuración que te pasó Camilo. Con eso la app queda lista y ya podés instalarla.'),
    h('p', { class: 'secundario' }, 'Para armar el link, en la Mac: ', h('code', null, 'npm run link-config -- pareja')),
    app.config ? h('a', { class: 'boton-secundario', href: '#/' }, 'Volver a las recetas') : null,
  ));
  return null;
}
