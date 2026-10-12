// Ficha de receta (#/receta/:id): estado y valoración, ingredientes por sección
// y rol con sus vistas de porciones, pasos y notas. Las ediciones van por la
// cola (ediciones.js): se ven al instante y se mandan cuando hay conexión.
// Al sincronizar se repinta en el lugar: la nota que se está escribiendo no se pierde.

import { h, icono, foto, rellenar, urlSegura } from '../dom.js';
import { capitalizar, fechaCorta, formatearCantidad, formatearMinutos, formatearTimer, textoTraduccion } from '../formato.js';
import { agrupar, chipsPorciones, enUnaLinea, escalar, hayQueGuardarVista, porcionesBase, porcionesIniciales, vistasDe } from '../ingredientes.js';
import { normalizar } from '../datos.js';
import { recetasEnLista } from '../compras.js';
import { nuevaEdicion, nuevaNota } from '../ediciones.js';
import { progresoGuardado } from './cocina.js';
import { estrellas, segmentado } from './controles.js';

const ESTADOS = [
  { valor: 'para_probar', nombre: 'Para probar' },
  { valor: 'probada', nombre: 'Probada' },
  { valor: 'favorita', nombre: 'Favorita' },
];
const MAX_PORCIONES = 99;

export function montar(contenedor, { app, volver, editar }, id) {
  let r = app.indice.porId.get(id);
  if (!r) {
    contenedor.append(h('div', { class: 'bienvenida' },
      h('h1', { class: 'titulo-pantalla', tabindex: '-1' },
        !app.datos && app.sync.estado === 'sincronizando' ? 'Bajando las recetas…' : 'No encontramos esta receta'),
      h('a', { class: 'boton-secundario', href: '#/' }, 'Ir a las recetas'),
    ));
    return null;
  }
  // Abre con la última vista de porciones que usaron; lo que elijan se recuerda mientras la app esté abierta.
  if (!app.porciones.has(id)) app.porciones.set(id, porcionesIniciales(r));

  const cambiarEstado = estado => {
    editar(nuevaEdicion('receta.estado', { id, estado }));
    pintar();
  };

  const portada = foto(r, 'ficha-foto');
  portada.prepend(h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver', onclick: () => volver('#/') },
    icono('volver')));
  const titulo = h('h1', { class: 'titulo-receta', tabindex: '-1' });
  const zonaMeta = h('div');

  // Estado y valoración
  const selector = segmentado('Estado de la receta', ESTADOS, r.estado, cambiarEstado);
  const valoracion = estrellas(Number(r.valoracion) || 0,
    v => editar(nuevaEdicion('receta.estado', { id, valoracion: v })), 'Valoración de la receta');
  const valorar = h('div', { class: 'valorar' }, h('span', { class: 'etiqueta-seccion' }, 'Valoración'), valoracion);
  const recuperar = h('button', { type: 'button', class: 'boton-secundario',
    onclick: () => cambiarEstado(Number(r.valoracion) > 0 ? 'probada' : 'para_probar') }, 'Recuperarla');
  const descartada = h('div', { class: 'aviso-descartada' },
    h('p', null, h('strong', null, 'Descartada.'), ' No aparece en las recetas.'), recuperar);

  const zonaIngredientes = h('section', { class: 'seccion', 'aria-labelledby': 'titulo-ingredientes' });
  const zonaPasos = h('section', { class: 'seccion' });

  // Notas: el formulario no se repinta nunca, así no pierde el foco ni lo escrito.
  const tituloNotas = h('h2');
  const listaNotas = h('div', { class: 'notas' });
  const textoNota = h('textarea', {
    rows: '3', maxlength: '2000', 'aria-label': 'Nota nueva',
    placeholder: 'Cómo salió, qué cambiarían la próxima…',
  });
  const abrirNota = h('button', { type: 'button', class: 'boton-secundario boton-chico',
    onclick: () => {
      abrirNota.hidden = true;
      formNota.hidden = false;
      textoNota.focus();
    } }, icono('mas', 18), 'Sumar una nota');
  const cerrarNota = () => {
    textoNota.value = '';
    formNota.hidden = true;
    abrirNota.hidden = false;
  };
  const formNota = h('form', {
    class: 'form-nota',
    hidden: true,
    onsubmit: e => {
      e.preventDefault();
      if (!textoNota.value.trim()) return textoNota.focus();
      editar(nuevaNota(id, app.config.quien, textoNota.value));
      cerrarNota();
      pintar();
      abrirNota.focus();
    },
  },
  textoNota,
  h('div', { class: 'form-botones' },
    h('button', { type: 'button', class: 'boton-secundario', onclick: cerrarNota }, 'Cancelar'),
    h('button', { type: 'submit', class: 'boton-principal' }, 'Guardar nota')));

  const descartar = h('button', { type: 'button', class: 'boton-texto alerta-texto',
    onclick: () => {
      cambiarEstado('descartada');
      recuperar.focus();
    } }, 'Descartar receta');

  const botonCocinar = h('a', {
    class: 'boton-principal',
    href: '#/cocina/' + id,
    // Cocinarla con otra cantidad de porciones la guarda como vista.
    onclick: () => {
      const n = app.porciones.get(id);
      if (hayQueGuardarVista(r, n)) editar(nuevaEdicion('receta.porciones', { id, porciones: n }));
    },
  });

  contenedor.append(h('article', { class: 'ficha' },
    portada,
    h('div', { class: 'ficha-cuerpo' },
      titulo,
      zonaMeta,
      h('div', { class: 'ficha-estado' }, selector, valorar, descartada),
      zonaIngredientes,
      zonaPasos,
      h('section', { class: 'seccion' }, tituloNotas, listaNotas, abrirNota, formNota),
      descartar,
    ),
    h('div', { class: 'barra-acciones' }, botonCocinar),
  ));

  function pintarMeta() {
    const fuente = urlSegura(r.fuente_url);
    rellenar(zonaMeta,
      h('div', { class: 'ficha-meta' },
        fuente ? h('a', { href: fuente, target: '_blank', rel: 'noopener noreferrer' }, r.autor || 'Ver el video', icono('externo', 14)) : r.autor,
        r.tiempo_min ? h('span', null, formatearMinutos(r.tiempo_min)) : null,
        r.molde ? h('span', null, 'Molde ' + r.molde) : null,
        textoTraduccion(r.idioma_original) ? h('span', null, textoTraduccion(r.idioma_original)) : null,
      ),
      r.confianza === 'baja' ? h('p', { class: 'alerta' }, icono('aviso', 18),
        'Puede que falten cantidades o pasos. Mirá el video antes de empezar.') : null,
    );
  }

  function pintarEstado() {
    const esDescartada = r.estado === 'descartada';
    selector.hidden = esDescartada;
    selector.actualizar(r.estado);
    valorar.hidden = r.estado !== 'probada' && r.estado !== 'favorita';
    valoracion.actualizar(Number(r.valoracion) || 0);
    descartada.hidden = !esDescartada;
    descartar.hidden = esDescartada;
  }

  function pintarIngredientes() {
    const base = porcionesBase(r);
    const n = app.porciones.get(id) || base;
    const factor = base ? n / base : 1;
    const { secciones, utensilios } = agrupar(r.ingredientes);
    const enCompras = recetasEnLista(app.datos?.compras).find(x => x.receta_id === id);
    rellenar(zonaIngredientes,
      h('h2', { id: 'titulo-ingredientes' }, 'Ingredientes'),
      base ? porciones(base, n) : null,
      secciones.map(s => h('div', { class: 'grupo-ingredientes' },
        s.nombre ? h('h3', { class: 'etiqueta-seccion' }, s.nombre) : null,
        h('ul', { class: 'lista-ingredientes' },
          s.principales.map(i => fila(i, factor)),
          s.condimentos.length ? h('li', { class: 'condimentos' },
            h('span', null, h('span', { class: 'rotulo' }, 'Condimentos '), enUnaLinea(s.condimentos, factor))) : null,
          s.opcionales.map(i => fila(i, factor, true)),
        ))),
      utensilios.length ? h('p', { class: 'utensilios' },
        h('span', { class: 'etiqueta-seccion' }, 'También vas a necesitar'), enUnaLinea(utensilios, factor)) : null,
      factor !== 1 ? h('p', { class: 'secundario' }, 'Ojo: los pasos dicen las cantidades para ' + base + '.') : null,
      h('a', { class: 'boton-secundario boton-chico', href: '#/compras/agregar/' + id }, icono('compras', 18),
        !enCompras ? 'Agregar a compras'
          : 'En compras' + (enCompras.porciones ? ' para ' + enCompras.porciones : '') + ' · Cambiar'),
      h('a', { class: 'boton-texto', href: '#/ingredientes/' + id }, icono('lapiz', 18), 'Editar ingredientes'),
    );
  }

  /** Porciones: −/+ para probar otro número y, si hay vistas guardadas, un chip por cada una. */
  function porciones(base, n) {
    const elegir = m => {
      app.porciones.set(id, m);
      conFoco(zonaIngredientes, pintarIngredientes);
    };
    const chips = chipsPorciones(r);
    const esVista = vistasDe(r).includes(n);
    return h('div', { class: 'porciones' },
      h('div', { class: 'porciones-control' },
        h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Menos porciones', disabled: n <= 1,
          onclick: () => elegir(n - 1) }, icono('menos', 18)),
        h('span', { class: 'porciones-n' }, n === 1 ? '1 porción' : n + ' porciones'),
        h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Más porciones', disabled: n >= MAX_PORCIONES,
          onclick: () => elegir(n + 1) }, icono('mas', 18))),
      chips.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Porciones guardadas' },
        chips.map(c => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.n === n), onclick: () => elegir(c.n) },
          c.original ? c.n + ' · original' : String(c.n)))) : null,
      n !== base && !esVista ? h('p', { class: 'secundario' }, 'Si la cocinan para ' + n + ', queda guardada como vista.') : null,
      n !== base && esVista ? h('button', { type: 'button', class: 'boton-texto',
        onclick: () => {
          editar(nuevaEdicion('receta.porciones', { id, porciones: n, quitar: true }));
          app.porciones.set(id, base);
          pintar();
        } }, 'Quitar la vista de ' + n) : null,
    );
  }

  function pintarPasos() {
    rellenar(zonaPasos,
      h('h2', null, 'Pasos'),
      h('ol', { class: 'lista-pasos' }, r.pasos.map((p, i) => h('li', null,
        h('span', { class: 'paso-numero', 'aria-hidden': 'true' }, i + 1),
        h('div', { class: 'paso-cuerpo' },
          h('p', null, p.texto),
          p.tip ? h('p', { class: 'paso-tip' }, h('b', null, 'Tip: '), p.tip) : null,
          Number(p.timer_min) > 0 ? h('span', { class: 'insignia-timer' }, icono('reloj', 14), formatearTimer(p.timer_min)) : null,
        ),
      ))),
    );
  }

  function pintarNotas() {
    tituloNotas.textContent = r.notas.length > 1 ? 'Nuestras notas' : r.notas.length ? 'Nuestra nota' : 'Notas';
    rellenar(listaNotas, r.notas.map(n => h('div', { class: 'nota' },
      h('strong', null, 'Nuestra nota · ' + fechaCorta(n.fecha)),
      h('p', null, n.texto))));
  }

  function pintar() {
    r = app.indice.porId.get(id) || r;
    titulo.textContent = r.titulo;
    const progreso = progresoGuardado(r.id, r.pasos.length);
    rellenar(botonCocinar, icono('cocinar', 22),
      progreso ? 'Seguir cocinando (paso ' + (progreso + 1) + ')' : 'Empezar a cocinar');
    pintarMeta();
    pintarEstado();
    conFoco(zonaIngredientes, pintarIngredientes);
    pintarPasos();
    pintarNotas();
  }

  pintar();
  return { actualizar: pintar };
}

/** Repinta `zona` y, si el foco estaba en un botón de ahí, lo devuelve al equivalente (misma etiqueta o texto). */
function conFoco(zona, repintar) {
  const activo = document.activeElement;
  const clave = activo && activo !== zona && zona.contains(activo) ? activo.getAttribute('aria-label') || activo.textContent : null;
  repintar();
  if (!clave) return;
  const igual = [...zona.querySelectorAll('button, a')].find(b => (b.getAttribute('aria-label') || b.textContent) === clave);
  if (igual && !igual.disabled) igual.focus({ preventScroll: true });
}

/** Un ingrediente en su renglón. Los opcionales, tenues y con la marca. */
function fila(i, factor, opcional = false) {
  // La nota «opcional» ya la dice la marca.
  const nota = opcional && normalizar(i.nota).trim() === 'opcional' ? '' : i.nota;
  return h('li', { class: opcional ? 'opcional' : null },
    h('span', null, capitalizar(i.nombre),
      opcional ? h('span', { class: 'marca-opcional' }, 'opcional') : null,
      nota ? h('span', { class: 'ingrediente-nota' }, nota) : null),
    h('span', { class: 'cantidad' }, formatearCantidad(escalar(i.cantidad, i.unidad, factor), i.unidad)),
  );
}
