// Agregar una receta a compras (#/compras/recetas): buscador y lista de recetas,
// con las que ya están en la lista marcadas. Al tocar una, el paso para elegir
// (#/compras/agregar/:id) reemplaza a esta pantalla: guardar o volver lleva
// directo a la lista de compras.

import { h, icono, foto, rellenar } from '../dom.js';
import { buscar } from '../datos.js';
import { recetasEnLista } from '../compras.js';
import { cargando, vacio } from './controles.js';

export function montar(contenedor, { app, volver, reemplazar }) {
  let texto = '';
  const lista = h('ul', { class: 'lista-links' });
  // El buscador no se repinta nunca: no pierde el foco ni lo escrito.
  const buscador = h('input', {
    type: 'search',
    placeholder: 'Nombre o ingrediente… (ej: garbanzos)',
    'aria-label': 'Buscar recetas',
    autocomplete: 'off',
    enterkeyhint: 'search',
    oninput: e => {
      texto = e.target.value;
      pintar();
    },
  });

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver a compras', onclick: () => volver('#/compras') },
        icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Agregar una receta'),
    h('label', { class: 'buscador' }, icono('buscar', 18), buscador),
    lista,
  ));

  function pintar() {
    const enLista = new Map(recetasEnLista(app.datos?.compras).map(x => [x.receta_id, x]));
    const recetas = buscar(app.indice.lista, { texto }).filter(r => r.ingredientes.length);
    if (!recetas.length) {
      let estado;
      if (!app.datos) {
        estado = app.sync.estado === 'sincronizando' ? cargando('Bajando las recetas…')
          : vacio({ figura: 'aviso', titulo: 'Todavía no se bajaron las recetas' });
      } else if (texto.trim()) {
        estado = vacio({ figura: 'buscar', titulo: 'No hay recetas con «' + texto.trim() + '»', texto: 'Probá con otra palabra o con un ingrediente.' });
      } else {
        estado = vacio({ figura: 'recetas', titulo: 'Todavía no hay recetas con ingredientes',
          texto: 'Cuando /recetas guarde alguna, la vas a poder sumar desde acá.' });
      }
      return rellenar(lista, h('li', null, estado));
    }
    rellenar(lista, recetas.map(r => {
      const x = enLista.get(r.id);
      const destino = '#/compras/agregar/' + r.id;
      return h('li', null, h('a', {
        class: 'tarjeta-reciente',
        href: destino,
        onclick: e => {
          e.preventDefault();
          reemplazar(destino, '#/compras');
        },
      },
      foto(r, 'mini-foto'),
      h('span', { class: 'reciente-texto' },
        h('strong', null, r.titulo),
        h('span', { class: 'secundario' }, x ? 'En la lista' + (x.porciones ? ' · ' + x.porciones + ' porciones' : '') : r.autor || '')),
      icono('derecha', 20)));
    }));
  }

  pintar();
  return { actualizar: pintar };
}
