// Plan semanal (#/semana y #/semana/AAAA-MM-DD, SPEC_v2 §4.1): «Sin día» arriba y cada día con
// almuerzo y cena apilados. La semana va en la dirección (su lunes): una versión nueva de la app,
// que recarga la página, no cambia de semana. Abre en la actual; hoy se destaca.

import { h, icono, foto, rellenar } from '../dom.js';
import { armarSemana, hoyIso, lunesDe, sumarDias, textoDia, textoSemana } from '../plan.js';
import { cargando, navegacion, vacio } from './controles.js';

export function montar(contenedor, { app, reemplazar }, semanaPedida) {
  const hoy = hoyIso();
  const actual = lunesDe(hoy);
  const semana = semanaPedida || actual;
  // Sin semana en la dirección: se escribe la actual, así «volver» desde una ficha vuelve a esta misma.
  if (!semanaPedida) history.replaceState(history.state, '', '#/semana/' + semana);

  const titulo = h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, textoSemana(semana));
  const cual = h('p', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const zona = h('div', { class: 'semana-dias' });
  const nav = navegacion('semana', app);
  const ir = destino => reemplazar(destino, history.state && history.state.desde);

  const anterior = h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Semana anterior',
    onclick: () => ir('#/semana/' + sumarDias(semana, -7)) }, icono('volver'));
  const siguiente = h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Semana siguiente',
    onclick: () => ir('#/semana/' + sumarDias(semana, 7)) }, icono('derecha'));
  const volverAHoy = semana !== actual
    ? h('a', { class: 'boton-texto', href: '#/semana/' + actual }, 'Ir a esta semana') : null;

  contenedor.append(h('div', { class: 'semana con-navegacion' },
    h('div', { class: 'semana-cabeza' }, anterior, h('div', { class: 'semana-titulo' }, titulo, cual), siguiente),
    volverAHoy,
    sync,
    zona,
  ), nav);

  cual.textContent = semana === actual ? 'Esta semana' : semana === sumarDias(actual, 7) ? 'La que viene'
    : semana < actual ? 'Ya pasó' : '';

  /** Una entrada: foto chica, título y porciones; tocarla abre la ficha. */
  function entrada(e) {
    if (!e.receta) {
      return h('li', { class: 'entrada' }, h('span', { class: 'entrada-link sin-receta' },
        h('span', { class: 'reciente-texto' }, h('strong', null, 'Receta que ya no está'))));
    }
    const r = e.receta;
    return h('li', { class: 'entrada' },
      h('a', { class: 'entrada-link', href: '#/receta/' + r.id },
        foto(r, 'mini-foto'),
        h('span', { class: 'reciente-texto' },
          h('strong', null, r.titulo + (e.porciones ? ' · ' + e.porciones : '')),
          r.estado === 'descartada' ? h('span', { class: 'secundario' }, 'Descartada') : null)));
  }

  /** Un renglón de comida (o «Sin día»): el rótulo y sus entradas. */
  function comida(nombre, entradas) {
    return h('div', { class: 'semana-comida' },
      h('div', { class: 'semana-comida-cabeza' }, h('h3', { class: 'etiqueta-seccion' }, nombre)),
      entradas.length ? h('ul', { class: 'entradas' }, entradas.map(entrada)) : null);
  }

  function pintar() {
    if (!app.datos) {
      return rellenar(zona, app.sync.estado === 'sincronizando' ? cargando('Bajando la semana…')
        : vacio({ figura: 'aviso', titulo: 'Todavía no se bajó la semana', texto: 'Cuando haya conexión, aparece sola.' }));
    }
    if (!app.indice.lista.length) {
      return rellenar(zona, vacio({ figura: 'recetas', titulo: 'Todavía no hay recetas',
        texto: 'Guardá un link desde el celular o la extensión, o sumá una de las que ya hacen.',
        acciones: [{ texto: 'Nueva receta', href: '#/nueva' }] }));
    }
    const s = armarSemana(app.datos.plan, semana, app.indice.porId);
    rellenar(zona,
      !s.total ? vacio({ figura: 'calendario', titulo: 'Todavía no hay nada para esta semana' }) : null,
      s.sinDia.length ? h('section', { class: 'semana-dia sin-dia', 'aria-label': 'Sin día' },
        h('h2', null, 'Sin día'), h('ul', { class: 'entradas' }, s.sinDia.map(entrada))) : null,
      s.dias.map(d => h('section', { class: 'semana-dia' + (d.fecha === hoy ? ' hoy' : ''), 'aria-label': textoDia(d.fecha) },
        h('h2', null, textoDia(d.fecha), d.fecha === hoy ? h('span', { class: 'marca-hoy' }, 'Hoy') : null),
        comida('Almuerzo', d.almuerzo),
        comida('Cena', d.cena))),
    );
  }

  function actualizar() {
    const pendientes = app.cola.length;
    sync.textContent = [
      app.sync.estado === 'sin_conexion' || app.sync.estado === 'error' ? app.sync.mensaje : '',
      pendientes === 1 ? '1 cambio sin mandar' : pendientes ? pendientes + ' cambios sin mandar' : '',
    ].filter(Boolean).join(' · ');
    sync.classList.toggle('error', app.sync.estado === 'error');
    nav.actualizar();
    pintar();
  }

  actualizar();
  return { actualizar };
}
