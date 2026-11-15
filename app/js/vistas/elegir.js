// Elegir una receta. Dos usos:
// - Compras (#/compras/recetas): las recetas con ingredientes, con las que ya están en la lista
//   marcadas. Al tocar una, el paso para elegir (#/compras/agregar/:id) reemplaza a esta pantalla:
//   guardar o volver lleva directo a la lista de compras.
// - La semana (#/semana/AAAA-MM-DD/elegir?fecha=…&comida=…, SPEC_v2 §4.1): todas las recetas (también
//   las propias sin escribir), con «Una receta nuestra» arriba. Al tocar una, el paso de las porciones
//   (#/semana/…/poner/:id) reemplaza a esta pantalla; guardar o volver lleva a la semana.

import { h, icono, foto, rellenar } from '../dom.js';
import { buscar, esPropia } from '../datos.js';
import { porcionesTexto } from '../formato.js';
import { recetasEnLista } from '../compras.js';
import { textoLugar } from './semana.js';
import { cargando, vacio } from './controles.js';

/** El destino como consulta de la dirección: «?fecha=…&comida=…» (o nada, si es «Sin día»). */
const consultaDe = destino => (destino && destino.fecha ? '?fecha=' + destino.fecha + '&comida=' + destino.comida : '');

export function montar(contenedor, { app, volver, reemplazar }, ruta = {}) {
  const enSemana = ruta.nombre === 'semana-elegir';
  const origen = enSemana ? '#/semana/' + ruta.semana : '#/compras';
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

  // «Una receta nuestra» (SPEC_v2 §6.1): se crea y queda puesta donde se tocó «+».
  const nuestra = enSemana ? h('a', {
    class: 'tarjeta-reciente una-nuestra',
    href: '#/nueva?semana=' + ruta.semana + (consultaDe(ruta.destino) ? '&' + consultaDe(ruta.destino).slice(1) : ''),
    onclick: e => {
      e.preventDefault();
      reemplazar(e.currentTarget.getAttribute('href'), origen);
    },
  }, h('span', { class: 'mini-foto icono-nuestra' }, icono('mas', 24)),
  h('span', { class: 'reciente-texto' }, h('strong', null, 'Una receta nuestra'),
    h('span', { class: 'secundario' }, 'De las que ya hacemos, sin video ni web')),
  icono('derecha', 20)) : null;

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': enSemana ? 'Volver a la semana' : 'Volver a compras',
        onclick: () => volver(origen) }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, enSemana ? 'Elegir una receta' : 'Agregar una receta'),
    enSemana ? h('p', { class: 'secundario' }, 'Para ' + textoLugar(ruta.destino.fecha, ruta.destino.comida).replace('Sin día', 'esta semana, sin día')) : null,
    h('label', { class: 'buscador' }, icono('buscar', 18), buscador),
    nuestra,
    lista,
  ));

  function pintar() {
    const enLista = new Map(recetasEnLista(app.datos?.compras).map(x => [x.receta_id, x]));
    // Para compras hacen falta ingredientes; para la semana, no (una propia sin escribir también se planea).
    const recetas = buscar(app.indice.lista, { texto }).filter(r => enSemana || r.ingredientes.length);
    if (!recetas.length) {
      let estado;
      if (!app.datos) {
        estado = app.sync.estado === 'sincronizando' ? cargando('Bajando las recetas…')
          : vacio({ figura: 'aviso', titulo: 'Todavía no se bajaron las recetas' });
      } else if (texto.trim()) {
        estado = vacio({ figura: 'buscar', titulo: 'No hay recetas con «' + texto.trim() + '»', texto: 'Probá con otra palabra o con un ingrediente.' });
      } else if (enSemana) {
        estado = vacio({ figura: 'recetas', titulo: 'Todavía no hay recetas',
          texto: 'Guardá un link desde el celular o la extensión, o sumá una de las que ya hacen.' });
      } else {
        estado = vacio({ figura: 'recetas', titulo: 'Todavía no hay recetas con ingredientes',
          texto: 'Cuando /recetas guarde alguna, la vas a poder sumar desde acá.' });
      }
      return rellenar(lista, h('li', null, estado));
    }
    rellenar(lista, recetas.map(r => {
      const x = enLista.get(r.id);
      const destino = enSemana ? '#/semana/' + ruta.semana + '/poner/' + r.id + consultaDe(ruta.destino) : '#/compras/agregar/' + r.id;
      const detalle = !enSemana && x ? 'En la lista' + (x.porciones ? ' · ' + porcionesTexto(x.porciones) : '')
        : esPropia(r) ? 'Receta nuestra' : r.autor || '';
      return h('li', null, h('a', {
        class: 'tarjeta-reciente',
        href: destino,
        onclick: e => {
          e.preventDefault();
          reemplazar(destino, origen);
        },
      },
      foto(r, 'mini-foto'),
      h('span', { class: 'reciente-texto' },
        h('strong', null, r.titulo),
        h('span', { class: 'secundario' }, detalle)),
      icono('derecha', 20)));
    }));
  }

  pintar();
  return { actualizar: pintar };
}
