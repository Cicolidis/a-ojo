// Lo que hay en casa (#/despensa, SPEC_v2 §5.1): una lista de nombres, compartida por
// los dos, sin cantidades. Se llega desde Compras y desde «Con lo que tengo»; los
// cambios van por la cola (ediciones.js).

import { h, icono, rellenar } from '../dom.js';
import { capitalizar } from '../formato.js';
import { nombresEscritos, paraDespensa } from '../compras.js';
import { idAzar, nuevaEdicion } from '../ediciones.js';
import { leerRuta } from '../rutas.js';
import { cargando, vacio } from './controles.js';

export function montar(contenedor, { app, volver, editar, avisar }) {
  // Vuelve adonde estaban: la Biblioteca («Con lo que tengo») o, si no, Compras.
  const desde = history.state && history.state.desde;
  const origen = typeof desde === 'string' && leerRuta(desde).nombre === 'biblioteca' ? '#/' : '#/compras';
  const titulo = h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Lo que hay en casa');
  const zonaLista = h('div', { class: 'despensa-lista' });

  // Sumar varios de una vez, separados por coma. El formulario no se repinta: no pierde lo escrito.
  const campo = h('input', { type: 'text', autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Sumar a la despensa', placeholder: 'Sumar algo (ej.: harina, huevos, manteca)' });
  const sumar = h('form', { class: 'sumar', onsubmit: e => {
    e.preventDefault();
    if (!campo.value.trim()) return campo.focus();
    const nombres = paraDespensa(nombresEscritos(campo.value).map(nombre => ({ nombre })), app.datos?.despensa);
    if (!nombres.length) {
      avisar('Ya estaba en la despensa.');
      return campo.select();
    }
    editar(nuevaEdicion('despensa.sumar', { quien: app.config.quien, items: nombres.map(nombre => ({ id: idAzar('d'), nombre })) }));
    campo.value = '';
    pintar();
    campo.focus();
  } }, campo, h('button', { type: 'submit', class: 'boton-secundario boton-chico' }, icono('mas', 18), 'Sumar'));

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': origen === '#/' ? 'Volver a las recetas' : 'Volver a compras',
        onclick: () => volver(origen) }, icono('volver'))),
    titulo,
    h('p', { class: 'editor-ayuda' }, 'Anotá lo que tenés para que la compra no lo repita. Lo ven los dos.'),
    sumar,
    zonaLista,
  ));

  function pintar() {
    // Sin datos, lo sumado se perdería (editar() no encola sin datos): no se ofrece.
    if (!app.datos) {
      sumar.hidden = true;
      return rellenar(zonaLista, app.sync.estado === 'sincronizando' ? cargando('Bajando la despensa…')
        : h('p', { class: 'secundario' }, 'Todavía no se bajó la despensa.'));
    }
    sumar.hidden = false;
    const filas = (app.datos.despensa || []).slice()
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
    if (!filas.length) {
      return rellenar(zonaLista, vacio({ figura: 'casa', titulo: 'Todavía no anotaron nada',
        texto: 'Sumá lo que tengan en casa. También se llena al tildar «lo tengo» y al limpiar lo comprado en la lista.' }));
    }
    rellenar(zonaLista, h('ul', { class: 'lista-lugares' }, filas.map((d, i) => h('li', null,
      h('span', null, capitalizar(d.nombre)),
      h('button', { type: 'button', class: 'boton-texto', 'aria-label': 'Quitar ' + d.nombre + ' de la despensa',
        onclick: () => {
          editar(nuevaEdicion('despensa.quitar', { ids: [d.id] }));
          pintar();
          // El foco va al «Quitar» que quedó en ese lugar (o al anterior); si no queda ninguno, al título.
          const botones = zonaLista.querySelectorAll('button');
          (botones[Math.min(i, botones.length - 1)] || titulo).focus();
        } }, 'Quitar')))));
  }

  pintar();
  // Al sincronizar se repinta solo la lista: lo que estén escribiendo no se pierde.
  return { actualizar: pintar };
}
