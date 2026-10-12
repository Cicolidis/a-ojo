// Editor de ingredientes (#/ingredientes/:id): el rol y la sección de cada uno.
// Solo eso: los nombres y las cantidades son los de /recetas. Se guarda aparte
// (rol_usuario, seccion_usuario), así reprocesar la receta no lo pisa.

import { h, icono } from '../dom.js';
import { capitalizar, formatearCantidad } from '../formato.js';
import { NOMBRES_ROL, ROLES, rolDe, seccionDe } from '../ingredientes.js';
import { nuevaEdicion } from '../ediciones.js';
import { segmentado } from './controles.js';

// Valor de «Nueva sección…» en los selectores. Empieza con espacio: ninguna sección puede (se guardan sin espacios a los costados).
const NUEVA = ' nueva';
const OPCIONES_ROL = ROLES.map(valor => ({ valor, nombre: NOMBRES_ROL[valor] }));

export function montar(contenedor, { app, volver, editar }, id) {
  const r = app.indice.porId.get(id);
  if (!r || !r.ingredientes.length) {
    contenedor.append(h('div', { class: 'bienvenida' },
      h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'No encontramos esta receta'),
      h('a', { class: 'boton-secundario', href: '#/' }, 'Ir a las recetas')));
    return null;
  }

  // Lo que van eligiendo, por id. Arranca con lo que muestra la ficha.
  const elegidos = new Map(r.ingredientes.map(i => [i.id, { rol: rolDe(i), seccion: seccionDe(i) }]));
  const cambiados = () => r.ingredientes.filter(i => {
    const e = elegidos.get(i.id);
    return e.rol !== rolDe(i) || e.seccion !== seccionDe(i);
  });
  const aLaFicha = () => volver('#/receta/' + id);
  const salir = () => {
    if (!cambiados().length || confirm('¿Salir sin guardar los cambios?')) aLaFicha();
  };
  const guardar = () => {
    const lista = cambiados();
    if (lista.length) {
      editar(nuevaEdicion('receta.ingredientes', {
        id,
        ingredientes: lista.map(i => Object.assign({ id: i.id }, elegidos.get(i.id))),
      }));
    }
    aLaFicha();
  };

  const lista = h('div', { class: 'editor-lista' });
  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver a la receta', onclick: salir }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Editar ingredientes'),
    h('p', { class: 'secundario' }, r.titulo),
    h('p', { class: 'editor-ayuda' },
      'Principal es lo infaltable. En la ficha, los condimentos van en una línea, lo opcional queda tenue y los utensilios van al final.'),
    lista,
    h('div', { class: 'barra-acciones' }, h('button', { type: 'button', class: 'boton-principal', onclick: guardar }, 'Guardar')),
  ));

  /** Secciones en el orden en que aparecen; la vacía («Sin sección»), primero. */
  function secciones() {
    const nombres = [...new Set(r.ingredientes.map(i => elegidos.get(i.id).seccion))];
    return nombres.filter(n => !n).concat(nombres.filter(Boolean));
  }

  function pintar(enfocar) {
    const nombres = secciones();
    const conSecciones = nombres.some(Boolean);
    lista.replaceChildren(...nombres.map(nombre => h('section', { class: 'editor-seccion' },
      conSecciones ? cabeza(nombre) : null,
      h('ul', { class: 'editor-ingredientes' },
        r.ingredientes.filter(i => elegidos.get(i.id).seccion === nombre).map(i => fila(i, nombres))),
    )));
    if (enfocar) {
      const el = lista.querySelector('[data-id="' + enfocar + '"] select');
      if (el) el.focus();
    }
  }

  /** Título de una sección, con «Renombrar» (que la cambia en todos sus ingredientes). */
  function cabeza(nombre) {
    if (!nombre) return h('h2', { class: 'etiqueta-seccion' }, 'Sin sección');
    const titulo = h('div', { class: 'editor-cabeza' },
      h('h2', { class: 'etiqueta-seccion' }, nombre),
      h('button', { type: 'button', class: 'boton-texto', onclick: () => titulo.replaceWith(campoNombre(nombre, nuevo => {
        elegidos.forEach(e => { if (e.seccion === nombre) e.seccion = nuevo; });
        pintar();
      }, () => pintar())) }, 'Renombrar'));
    return titulo;
  }

  function fila(i, nombres) {
    const e = elegidos.get(i.id);
    const detalle = [formatearCantidad(i.cantidad, i.unidad), i.nota].filter(Boolean).join(' · ');
    const selector = h('select', {
      'aria-label': 'Sección de ' + i.nombre,
      onchange: () => {
        if (selector.value !== NUEVA) {
          e.seccion = selector.value;
          return pintar(i.id);
        }
        selector.replaceWith(campoNombre('', nuevo => {
          e.seccion = nuevo;
          pintar(i.id);
        }, () => pintar(i.id)));
      },
    },
    h('option', { value: '' }, 'Sin sección'),
    nombres.filter(Boolean).map(n => h('option', { value: n }, n)),
    h('option', { value: NUEVA }, 'Nueva sección…'));
    selector.value = e.seccion;

    return h('li', { 'data-id': i.id },
      h('div', { class: 'editor-nombre' },
        h('strong', null, capitalizar(i.nombre)),
        detalle ? h('span', { class: 'secundario' }, detalle) : null),
      segmentado('Rol de ' + i.nombre, OPCIONES_ROL, e.rol, rol => { e.rol = rol; }, 'chico'),
      h('label', { class: 'editor-seccion-elegir' }, h('span', { class: 'secundario' }, 'Sección'), selector),
    );
  }

  pintar();
  // Lo que bajó la sincronización no pisa lo que están editando.
  return { actualizar() {} };
}

/** Campo para escribir el nombre de una sección, con «Listo» y «Cancelar». */
function campoNombre(inicial, alListo, alCancelar) {
  const campo = h('input', { type: 'text', value: inicial, maxlength: '40', 'aria-label': 'Nombre de la sección',
    placeholder: 'Ej.: Masa, Relleno, Para servir', enterkeyhint: 'done' });
  const listo = () => {
    const nombre = campo.value.trim();
    if (nombre) alListo(nombre);
    else alCancelar();
  };
  const form = h('form', { class: 'campo-seccion', onsubmit: ev => { ev.preventDefault(); listo(); } },
    campo,
    h('button', { type: 'submit', class: 'boton-secundario boton-chico' }, 'Listo'),
    h('button', { type: 'button', class: 'boton-texto', onclick: alCancelar }, 'Cancelar'));
  requestAnimationFrame(() => campo.focus());
  return form;
}
