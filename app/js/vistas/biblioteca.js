// Biblioteca (#/): buscador, filtros, aviso de la bandeja y grilla de recetas.

import { h, icono, foto } from '../dom.js';
import { FILTROS, buscar, etiquetasFrecuentes, filtroEtiqueta, resumenBandeja } from '../datos.js';
import { formatearMinutos } from '../formato.js';

export function montar(contenedor, { app }) {
  const estado = app.biblioteca;
  const cuenta = h('span', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar recetas' });
  const aviso = h('div');
  const grilla = h('div');
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

  contenedor.append(h('div', { class: 'biblioteca' },
    h('div', { class: 'encabezado' }, h('span', { class: 'marca' }, 'A ojo'), cuenta),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, '¿Qué cocinamos hoy?'),
    sync,
    h('label', { class: 'buscador' }, icono('buscar', 18), buscador),
    chips,
    aviso,
    grilla,
  ));

  function pintarChips() {
    const filtros = FILTROS.concat(etiquetasFrecuentes(app.indice.lista).map(filtroEtiqueta));
    if (!filtros.some(f => f.id === estado.filtro)) estado.filtro = 'todas';
    chips.replaceChildren(...filtros.map(f => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(f.id === estado.filtro),
      onclick: e => {
        estado.filtro = f.id;
        chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        pintarGrilla();
      },
    }, f.nombre)));
  }

  function pintarAviso() {
    const b = resumenBandeja(app.datos?.bandeja);
    if (!b.total) return aviso.replaceChildren();
    const partes = [];
    if (b.esperando) partes.push(b.esperando + ' esperando a la Mac');
    if (b.ayuda) partes.push(b.ayuda + (b.ayuda === 1 ? ' necesita ayuda' : ' necesitan ayuda'));
    aviso.replaceChildren(h('div', { class: 'aviso-bandeja' },
      h('span', { class: 'numero', 'aria-hidden': 'true' }, b.total),
      h('div', null,
        h('strong', null, b.total === 1 ? '1 link en la bandeja' : b.total + ' links en la bandeja'),
        h('span', { class: 'secundario' }, partes.join(' · '))),
    ));
  }

  function pintarGrilla() {
    const recetas = buscar(app.indice.lista, estado);
    if (recetas.length) {
      grilla.replaceChildren(h('div', { class: 'grilla' }, recetas.map(tarjeta)));
      return;
    }
    let texto;
    if (!app.datos) texto = app.sync.estado === 'sincronizando' ? 'Bajando las recetas…' : 'Todavía no se bajaron las recetas.';
    else if (estado.texto.trim()) texto = 'No hay recetas con «' + estado.texto.trim() + '».';
    else if (estado.filtro !== 'todas') texto = 'No hay recetas en este filtro.';
    else texto = 'Todavía no hay recetas. Guardá un link y corré /recetas en la Mac.';
    grilla.replaceChildren(h('p', { class: 'vacio' }, texto));
  }

  function actualizar() {
    const n = app.indice.lista.filter(r => r.estado !== 'descartada').length;
    cuenta.textContent = app.datos ? (n === 1 ? '1 receta' : n + ' recetas') : '';
    sync.textContent = app.sync.estado === 'sin_conexion' || app.sync.estado === 'error' ? app.sync.mensaje : '';
    sync.classList.toggle('error', app.sync.estado === 'error');
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
    ? h('span', { class: 'valoracion', 'aria-label': 'Valoración ' + r.valoracion + ' de 5' }, icono('estrella', 12), r.valoracion)
    : null;
  return h('a', { class: 'tarjeta', href: '#/receta/' + r.id },
    foto(r, 'tarjeta-foto'),
    h('span', { class: 'tarjeta-titulo' }, r.titulo),
    meta ? h('span', { class: 'tarjeta-meta' }, meta) : null,
    valoracion,
  );
}
