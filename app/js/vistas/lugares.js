// Dónde compramos cada cosa (#/lugares): el lugar de cada tipo de producto y los
// ingredientes que van siempre a un lugar. Se guarda en la Sheet, así los dos ven
// lo mismo; los cambios van por la cola (ediciones.js).

import { h, icono, rellenar } from '../dom.js';
import { capitalizar } from '../formato.js';
import { LUGARES, TIPOS, nombreLugar } from '../compras.js';
import { nuevaEdicion } from '../ediciones.js';

export function montar(contenedor, { app, volver, editar }) {
  const zonaTipos = h('ul', { class: 'lista-lugares' });
  const zonaIngredientes = h('div');

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver a compras', onclick: () => volver('#/compras') },
        icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Dónde compramos'),
    h('p', { class: 'editor-ayuda' }, 'Cada cosa de la lista va al lugar de su tipo, salvo los ingredientes que tienen un lugar fijo. Lo ven los dos.'),
    h('section', { class: 'bloque' }, h('h2', { class: 'etiqueta-seccion' }, 'Por tipo de producto'), zonaTipos),
    h('section', { class: 'bloque' }, h('h2', { class: 'etiqueta-seccion' }, 'Ingredientes con lugar fijo'), zonaIngredientes),
  ));

  const opciones = () => LUGARES.map(l => h('option', { value: l }, nombreLugar(l)));

  function pintar() {
    const lugares = app.datos?.lugares || [];
    rellenar(zonaTipos, TIPOS.map(tipo => {
      const regla = lugares.find(l => l.por === 'tipo' && l.clave === tipo);
      const selector = h('select', { 'aria-label': 'Dónde compran ' + tipo,
        onchange: () => editar(nuevaEdicion('lugares.asignar', { por: 'tipo', clave: tipo, lugar: selector.value })) },
      opciones());
      selector.value = regla && LUGARES.includes(regla.lugar) ? regla.lugar : 'supermercado';
      return h('li', null, h('span', null, capitalizar(tipo)), selector);
    }));

    const fijos = lugares.filter(l => l.por === 'ingrediente' && LUGARES.includes(l.lugar))
      .sort((a, b) => a.clave.localeCompare(b.clave, 'es'));
    rellenar(zonaIngredientes, fijos.length
      ? h('ul', { class: 'lista-lugares' }, fijos.map(l => h('li', null,
        h('span', null, capitalizar(l.clave), h('span', { class: 'secundario' }, ' · ' + nombreLugar(l.lugar))),
        h('button', { type: 'button', class: 'boton-texto', 'aria-label': 'Olvidar dónde se compra ' + l.clave,
          onclick: () => {
            editar(nuevaEdicion('lugares.asignar', { por: 'ingrediente', clave: l.clave, lugar: '' }));
            pintar();
          } }, 'Olvidar'))))
      : h('p', { class: 'secundario' }, 'Todavía no hay. Al mover algo de la lista, tildá «Comprar siempre ahí».'));
  }

  pintar();
  return {
    // Un select abierto no se repinta: lo que eligen no se pierde.
    actualizar() {
      if (!contenedor.contains(document.activeElement) || document.activeElement.tagName !== 'SELECT') pintar();
    },
  };
}
