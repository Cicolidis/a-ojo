// Agregar a compras (#/compras/agregar/:id): qué comprar de una receta. Los
// principales arrancan marcados y los opcionales no; los condimentos y utensilios
// van a «Revisá si tenés». Si la receta ya está en la lista, guardar la reemplaza.
// Se llega desde la ficha (y se vuelve ahí, con «Ver la lista» en el aviso) o
// desde Compras, por el buscador de recetas (y se vuelve a la lista).

import { h, icono, rellenar } from '../dom.js';
import { capitalizar, formatearCantidad } from '../formato.js';
import { agrupar, enUnaLinea, escalar, porcionesBase, porcionesIniciales } from '../ingredientes.js';
import { elegidosIniciales, itemsDeReceta, recetasEnLista, vaARevisar } from '../compras.js';
import { idAzar, nuevaEdicion } from '../ediciones.js';
import { contadorPorciones } from './controles.js';

export function montar(contenedor, { app, volver, editar, avisar }, id) {
  const r = app.indice.porId.get(id);
  if (!r || !r.ingredientes.length) {
    contenedor.append(h('div', { class: 'bienvenida' },
      h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'No encontramos esta receta'),
      h('a', { class: 'boton-secundario', href: '#/' }, 'Ir a las recetas')));
    return null;
  }

  const base = porcionesBase(r);
  let porciones = app.porciones.get(id) || porcionesIniciales(r);
  const elegidos = elegidosIniciales(r);
  const hayRevisar = r.ingredientes.some(vaARevisar);
  const enLista = recetasEnLista(app.datos?.compras).find(x => x.receta_id === id);
  // Vuelve a la lista si se llegó desde ahí; si no, a la receta.
  const desde = history.state && history.state.desde;
  const aLaLista = desde === '#/compras';
  const salir = () => volver(aLaLista ? '#/compras' : '#/receta/' + id);
  const verLista = aLaLista ? undefined : { texto: 'Ver la lista', href: '#/compras' };

  const guardar = () => {
    const items = itemsDeReceta(r, porciones, elegidos, () => idAzar('c'));
    editar(nuevaEdicion('compras.agregar', { receta_id: id, porciones: base ? porciones : null, items }));
    if (base) app.porciones.set(id, porciones);
    salir();
    avisar(enLista ? '✓ Actualicé la receta en compras' : '✓ Agregada a compras', verLista);
  };
  const quitar = () => {
    editar(nuevaEdicion('compras.quitar', { ids: enLista.ids }));
    salir();
    avisar('Saqué la receta de compras');
  };

  const lista = h('div', { class: 'agregar-lista' });
  const boton = h('button', { type: 'button', class: 'boton-principal', onclick: guardar });

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver', onclick: salir }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Agregar a compras'),
    h('p', { class: 'secundario' }, r.titulo),
    base ? contadorPorciones(porciones, n => {
      porciones = n;
      pintar();
    }) : null,
    enLista ? h('div', { class: 'aviso-lista' },
      h('p', null, 'Ya está en la lista' + (enLista.porciones ? ' para ' + enLista.porciones + ' porciones' : '') +
        '. Si guardás, se reemplaza.'),
      h('button', { type: 'button', class: 'boton-texto alerta-texto', onclick: quitar }, 'Quitar de la lista')) : null,
    lista,
    h('div', { class: 'barra-acciones' }, boton),
  ));

  function pintar() {
    const factor = base ? porciones / base : 1;
    const { secciones, utensilios } = agrupar(r.ingredientes);
    const condimentos = secciones.flatMap(s => s.condimentos);
    const casilla = (i, opcional) => h('li', null,
      h('label', { class: 'casilla' + (opcional ? ' opcional' : '') },
        h('input', { type: 'checkbox', checked: elegidos.has(i.id), onchange: e => {
          if (e.target.checked) elegidos.add(i.id);
          else elegidos.delete(i.id);
          pintarBoton();
        } }),
        h('span', { class: 'casilla-texto' }, capitalizar(i.nombre),
          opcional ? h('span', { class: 'marca-opcional' }, 'opcional') : null),
        h('span', { class: 'cantidad' }, formatearCantidad(escalar(i.cantidad, i.unidad, factor), i.unidad))));

    rellenar(lista,
      h('h2', { class: 'etiqueta-seccion' }, 'Para comprar'),
      secciones.filter(s => s.principales.length || s.opcionales.length).map(s => h('div', { class: 'grupo-ingredientes' },
        s.nombre ? h('h3', { class: 'etiqueta-seccion' }, s.nombre) : null,
        h('ul', { class: 'lista-casillas' },
          s.principales.map(i => casilla(i, false)),
          s.opcionales.map(i => casilla(i, true))))),
      condimentos.length || utensilios.length ? h('div', { class: 'agregar-revisar' },
        h('h2', { class: 'etiqueta-seccion' }, 'Revisá si tenés'),
        h('p', { class: 'secundario' }, 'Van aparte en la lista, para que te fijes en casa.'),
        condimentos.length ? h('p', null, enUnaLinea(condimentos, factor)) : null,
        utensilios.length ? h('p', null, enUnaLinea(utensilios, factor)) : null) : null,
    );
    pintarBoton();
  }

  function pintarBoton() {
    const n = elegidos.size;
    boton.disabled = !n && !hayRevisar;
    boton.textContent = n === 1 ? 'Agregar 1 cosa' : n ? 'Agregar ' + n + ' cosas' : hayRevisar ? 'Agregar solo lo de revisar' : 'Elegí qué comprar';
  }

  pintar();
  // Lo que bajó la sincronización no pisa lo que están eligiendo.
  return { actualizar() {} };
}
