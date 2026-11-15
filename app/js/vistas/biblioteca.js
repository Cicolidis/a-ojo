// Biblioteca (#/): buscador, filtros, aviso de la bandeja y grilla de recetas.

import { h, icono, foto } from '../dom.js';
import { FILTROS, FILTRO_DESCARTADAS, FILTRO_NUESTRAS, buscar, cuantasFilas, esPropia, etiquetasFrecuentes, filtroEtiqueta, motivoVacio, queCocino, resumenBandeja, tengoConDespensa } from '../datos.js';
import { formatearMinutos } from '../formato.js';
import { unirConY } from '../ingredientes.js';
import { cargando, navegacion, segmentado, sumarALaSemana, vacio } from './controles.js';
import { porcionesIniciales } from '../ingredientes.js';

const PISTAS = {
  buscar: { placeholder: 'Nombre o ingrediente… (ej: garbanzos)', etiqueta: 'Buscar recetas' },
  tengo: { placeholder: '¿Qué tenés? (ej: zapallo, huevos, crema)', etiqueta: 'Ingredientes que tenés' },
};

export function montar(contenedor, ctx) {
  const { app, sincronizar } = ctx;
  const estado = app.biblioteca;
  const cuenta = h('span', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar recetas' });
  const aviso = h('div');
  const grilla = h('div');
  const nav = navegacion('biblioteca', app);
  // Dos modos con el mismo campo: buscar por nombre o «Con lo que tengo» (¿Qué cocino hoy?).
  // Cada uno recuerda lo que se escribió.
  const buscador = h('input', {
    type: 'search',
    autocomplete: 'off',
    enterkeyhint: 'search',
    oninput: e => {
      if (estado.modo === 'tengo') estado.tengo = e.target.value;
      else estado.texto = e.target.value;
      pintarGrilla();
    },
  });
  const pintarCampo = () => {
    const p = PISTAS[estado.modo] || PISTAS.buscar;
    buscador.placeholder = p.placeholder;
    buscador.setAttribute('aria-label', p.etiqueta);
    buscador.value = estado.modo === 'tengo' ? estado.tengo : estado.texto;
  };
  const modo = segmentado('Cómo buscar', [{ valor: 'buscar', nombre: 'Buscar' }, { valor: 'tengo', nombre: 'Con lo que tengo' }],
    estado.modo, valor => {
      estado.modo = valor;
      pintarCampo();
      pintarTengo();
      pintarGrilla();
      buscador.focus();
    }, 'modo-biblioteca');
  pintarCampo();

  // «Nueva receta» (SPEC_v2 §6.1): una receta propia, al lado del buscador.
  const campoBuscar = h('div', { class: 'buscar-fila' },
    h('label', { class: 'buscador' }, icono('buscar', 18), buscador),
    // En pantallas angostas dice «Nueva» (el nombre accesible sigue siendo «Nueva receta»).
    h('a', { class: 'boton-secundario boton-nueva', href: '#/nueva', 'aria-label': 'Nueva receta' },
      icono('mas', 18), h('span', null, 'Nueva'), h('span', { class: 'nueva-largo' }, '\u00a0receta')));

  // «Con lo que tengo» arranca con la despensa (SPEC_v2 §5.3): un chip para usarla o no.
  const chipDespensa = h('button', { type: 'button', class: 'chip', onclick: () => {
    estado.usarDespensa = !estado.usarDespensa;
    pintarTengo();
    pintarGrilla();
  } }, 'Usar lo de la despensa');
  const tengo = h('div', { class: 'tengo-despensa' }, chipDespensa,
    h('a', { class: 'boton-texto', href: '#/despensa' }, icono('casa', 18), 'Lo que hay en casa'));
  const despensa = () => app.datos?.despensa || [];
  function pintarTengo() {
    tengo.hidden = estado.modo !== 'tengo' || !app.indice.lista.length;
    chipDespensa.hidden = !despensa().length;
    chipDespensa.setAttribute('aria-pressed', String(estado.usarDespensa));
  }

  contenedor.append(h('div', { class: 'biblioteca con-navegacion' },
    h('div', { class: 'encabezado' }, h('span', { class: 'marca' }, 'A ojo'), cuenta),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, '¿Qué cocinamos hoy?'),
    sync,
    modo,
    campoBuscar,
    tengo,
    chips,
    aviso,
    grilla,
  ), nav);

  function pintarChips() {
    const hayNuestras = app.indice.lista.some(r => esPropia(r) && r.estado !== 'descartada');
    const filtros = FILTROS.concat(hayNuestras ? [FILTRO_NUESTRAS] : [], etiquetasFrecuentes(app.indice.lista).map(filtroEtiqueta),
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
    if (estado.modo === 'tengo') estado.tengo = '';
    else estado.texto = '';
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
        h('strong', null, cuantasFilas(b.total, b.propias) + ' en la bandeja'),
        h('span', { class: 'secundario' }, partes.join(' · '))),
      icono('derecha', 20),
    ));
  }

  function pintarGrilla() {
    // «Con lo que tengo»: de la receta más cercana a la más lejana, con lo que falta.
    const tengoTexto = estado.modo === 'tengo' ? tengoConDespensa(estado.tengo, despensa(), estado.usarDespensa) : '';
    if (tengoTexto) {
      const cercanas = queCocino(app.indice.lista, Object.assign({}, estado, { tengo: tengoTexto }));
      if (cercanas.length) {
        grilla.replaceChildren(h('div', { class: 'grilla' }, cercanas.map(x => tarjeta(x.receta, x.faltan, ctx))));
        return;
      }
      // Si no escribieron nada (solo cuenta la despensa), no hay nada para borrar.
      grilla.replaceChildren(vacio({ figura: 'buscar', titulo: 'Con eso no encontramos ninguna receta',
        texto: 'Probá con otros ingredientes, separados por comas.',
        acciones: estado.tengo.trim() ? [{ texto: 'Borrar', onclick: borrarBusqueda }] : [] }));
      return;
    }
    const recetas = buscar(app.indice.lista, estado.modo === 'tengo' ? Object.assign({}, estado, { texto: '' }) : estado);
    if (recetas.length) {
      // Sin el índice de map(): tarjeta() lo tomaría por la lista de lo que falta.
      grilla.replaceChildren(h('div', { class: 'grilla' }, recetas.map(r => tarjeta(r, undefined, ctx))));
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
      texto: 'Guardá un link desde el celular o la extensión y corré /recetas en la Mac. O sumá una de las que ya hacen.',
      acciones: [{ texto: 'Nueva receta', href: '#/nueva' }]
        .concat(resumenBandeja(app.datos?.bandeja).total ? [{ texto: 'Ver la bandeja', href: '#/bandeja' }] : []) });
  }

  function actualizar() {
    // Sin ninguna receta (ni descartada), la cuenta, el buscador y los filtros no sirven.
    const hayRecetas = app.indice.lista.length > 0;
    const n = app.indice.lista.filter(r => r.estado !== 'descartada').length;
    cuenta.textContent = hayRecetas ? (n === 1 ? '1 receta' : n + ' recetas') : '';
    campoBuscar.hidden = !hayRecetas;
    modo.hidden = !hayRecetas;
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
    pintarTengo();
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

/** Lo que falta para una receta en «Con lo que tengo»: «Tenés todo» o «Falta: crema, queso y 2 más». */
function textoFaltan(faltan) {
  if (!faltan.length) return 'Tenés todo lo principal';
  const muestra = faltan.length > 3 ? faltan.slice(0, 2).concat((faltan.length - 2) + ' más') : faltan;
  return (faltan.length === 1 ? 'Falta: ' : 'Faltan: ') + unirConY(muestra);
}

/**
 * Una tarjeta: el link a la ficha y, al lado (un botón no puede ir adentro de un link), «Sumar a la
 * semana» (SPEC_v2 §4.1), salvo en las descartadas.
 */
function tarjeta(r, faltan, ctx) {
  const meta = [esPropia(r) ? 'Receta nuestra' : r.autor, formatearMinutos(r.tiempo_min)].filter(Boolean).join(' · ');
  const valoracion = Number(r.valoracion) > 0
    ? h('span', { class: 'valoracion', role: 'img', 'aria-label': 'Valoración ' + r.valoracion + ' de 5' }, icono('estrella', 12), r.valoracion)
    : null;
  const link = h('a', { class: 'tarjeta', href: '#/receta/' + r.id },
    foto(r, 'tarjeta-foto'),
    h('span', { class: 'tarjeta-titulo' }, r.titulo),
    faltan ? h('span', { class: 'tarjeta-faltan' + (faltan.length ? '' : ' completa') }, textoFaltan(faltan))
      : meta ? h('span', { class: 'tarjeta-meta' }, meta) : null,
    valoracion,
  );
  const semana = r.estado === 'descartada' ? null : h('button', { type: 'button', class: 'boton-redondo boton-semana',
    'aria-label': 'Sumar ' + r.titulo + ' a la semana',
    onclick: () => sumarALaSemana(ctx, r, { porciones: porcionesIniciales(r) }) }, icono('calendario-mas', 20));
  return h('div', { class: 'tarjeta-caja' }, link, semana);
}
