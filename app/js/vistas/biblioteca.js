// Biblioteca (#/): buscador, filtros, aviso de la bandeja y grilla de recetas.

import { h, icono, foto } from '../dom.js';
import { FILTROS, FILTRO_DESCARTADAS, buscar, etiquetasFrecuentes, filtroEtiqueta, motivoVacio, resumenBandeja } from '../datos.js';
import { formatearMinutos } from '../formato.js';
import { cargando, navegacion, vacio } from './controles.js';

export function montar(contenedor, { app, sincronizar }) {
  const estado = app.biblioteca;
  const cuenta = h('span', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar recetas' });
  const aviso = h('div');
  const grilla = h('div');
  const nav = navegacion('biblioteca', app);
  const buscador = h('input', {
    type: 'search',
    placeholder: 'Nombre o ingrediente… (ej: garbanzos)',
    'aria-label': 'Buscar recetas',
    autocomplete: 'off',
    enterkeyhint: 'search',
    value: estado.texto,
    oninput: e => {
      estado.texto = e.target.value;
      pintarGrilla();
    },
  });

  const campoBuscar = h('label', { class: 'buscador' }, icono('buscar', 18), buscador);

  contenedor.append(h('div', { class: 'biblioteca con-navegacion' },
    h('div', { class: 'encabezado' }, h('span', { class: 'marca' }, 'A ojo'), cuenta),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, '¿Qué cocinamos hoy?'),
    sync,
    campoBuscar,
    chips,
    aviso,
    grilla,
  ), nav);

  function pintarChips() {
    const filtros = FILTROS.concat(etiquetasFrecuentes(app.indice.lista).map(filtroEtiqueta),
      app.indice.lista.some(r => r.estado === 'descartada') ? [FILTRO_DESCARTADAS] : []);
    if (!filtros.some(f => f.id === estado.filtro)) estado.filtro = 'todas';
    chips.replaceChildren(...filtros.map(f => h('button', {
      type: 'button',
      class: 'chip',
      'data-filtro': f.id,
      'aria-pressed': String(f.id === estado.filtro),
      onclick: () => elegirFiltro(f.id),
    }, f.nombre)));
  }

  /** Elige un filtro (desde su chip o desde un estado vacío) y deja el foco en su chip. */
  function elegirFiltro(id, enfocar = false) {
    estado.filtro = id;
    chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filtro === id)));
    pintarGrilla();
    const chip = chips.querySelector('[aria-pressed="true"]');
    if (enfocar && chip) chip.focus();
  }

  function borrarBusqueda() {
    estado.texto = '';
    buscador.value = '';
    pintarGrilla();
    buscador.focus();
  }

  function pintarAviso() {
    const b = resumenBandeja(app.datos?.bandeja);
    if (!b.total) return aviso.replaceChildren();
    const partes = [];
    if (b.esperando) partes.push(b.esperando + ' esperando a la Mac');
    if (b.ayuda) partes.push(b.ayuda + (b.ayuda === 1 ? ' necesita ayuda' : ' necesitan ayuda'));
    aviso.replaceChildren(h('a', { class: 'aviso-bandeja', href: '#/bandeja' },
      h('span', { class: 'numero', 'aria-hidden': 'true' }, b.total),
      h('div', null,
        h('strong', null, b.total === 1 ? '1 link en la bandeja' : b.total + ' links en la bandeja'),
        h('span', { class: 'secundario' }, partes.join(' · '))),
      icono('derecha', 20),
    ));
  }

  function pintarGrilla() {
    const recetas = buscar(app.indice.lista, estado);
    if (recetas.length) {
      grilla.replaceChildren(h('div', { class: 'grilla' }, recetas.map(tarjeta)));
      return;
    }
    grilla.replaceChildren(estadoVacio(motivoVacio(app.indice.lista, estado, { hayDatos: !!app.datos, sync: app.sync.estado })));
  }

  function estadoVacio(motivo) {
    const otraVez = [{ texto: 'Probá de nuevo', onclick: () => sincronizar() }];
    if (motivo === 'cargando') return cargando('Bajando las recetas…');
    if (motivo === 'sin_conexion') {
      return vacio({ figura: 'aviso', titulo: 'Sin conexión', texto: 'Cuando vuelva, bajamos las recetas.', acciones: otraVez });
    }
    if (motivo === 'sin_datos') return vacio({ figura: 'aviso', titulo: 'Todavía no se bajaron las recetas', acciones: otraVez });
    if (motivo === 'busqueda') {
      return vacio({ figura: 'buscar', titulo: 'No hay recetas con «' + estado.texto.trim() + '»',
        texto: 'Probá con otra palabra o con un ingrediente.', acciones: [{ texto: 'Borrar la búsqueda', onclick: borrarBusqueda }] });
    }
    if (motivo === 'filtro') {
      return vacio({ figura: 'recetas', titulo: 'No hay recetas en este filtro',
        acciones: [{ texto: 'Ver todas', onclick: () => elegirFiltro('todas', true) }] });
    }
    if (motivo === 'descartadas') {
      return vacio({ figura: 'recetas', titulo: 'Todas las recetas están descartadas', texto: 'Se recuperan desde su ficha.',
        acciones: [{ texto: 'Ver las descartadas', onclick: () => elegirFiltro('descartada', true) }] });
    }
    return vacio({ figura: 'recetas', titulo: 'Todavía no hay recetas',
      texto: 'Guardá un link desde el celular o la extensión y corré /recetas en la Mac.',
      acciones: resumenBandeja(app.datos?.bandeja).total ? [{ texto: 'Ver la bandeja', href: '#/bandeja' }] : [] });
  }

  function actualizar() {
    // Sin ninguna receta (ni descartada), la cuenta, el buscador y los filtros no sirven.
    const hayRecetas = app.indice.lista.length > 0;
    const n = app.indice.lista.filter(r => r.estado !== 'descartada').length;
    cuenta.textContent = hayRecetas ? (n === 1 ? '1 receta' : n + ' recetas') : '';
    campoBuscar.hidden = !hayRecetas;
    chips.hidden = !hayRecetas;
    const pendientes = app.cola.length;
    // Sin datos y sin conexión, ya lo dice el estado vacío.
    const avisarSync = app.sync.estado === 'error' || (app.sync.estado === 'sin_conexion' && app.datos);
    sync.textContent = [
      avisarSync ? app.sync.mensaje : '',
      pendientes === 1 ? '1 cambio sin mandar' : pendientes ? pendientes + ' cambios sin mandar' : '',
    ].filter(Boolean).join(' · ');
    sync.classList.toggle('error', app.sync.estado === 'error');
    nav.actualizar();
    pintarChips();
    pintarAviso();
    pintarGrilla();
  }

  actualizar();
  requestAnimationFrame(() => window.scrollTo(0, estado.scroll || 0));
  return {
    actualizar,
    desmontar() {
      estado.scroll = window.scrollY;
    },
  };
}

function tarjeta(r) {
  const meta = [r.autor, formatearMinutos(r.tiempo_min)].filter(Boolean).join(' · ');
  const valoracion = Number(r.valoracion) > 0
    ? h('span', { class: 'valoracion', role: 'img', 'aria-label': 'Valoración ' + r.valoracion + ' de 5' }, icono('estrella', 12), r.valoracion)
    : null;
  return h('a', { class: 'tarjeta', href: '#/receta/' + r.id },
    foto(r, 'tarjeta-foto'),
    h('span', { class: 'tarjeta-titulo' }, r.titulo),
    meta ? h('span', { class: 'tarjeta-meta' }, meta) : null,
    valoracion,
  );
}
