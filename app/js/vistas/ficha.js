// Ficha de receta (#/receta/:id): estado y valoración, ingredientes por sección
// y rol con sus vistas de porciones, pasos y notas. Las ediciones van por la
// cola (ediciones.js): se ven al instante y se mandan cuando hay conexión.
// Al sincronizar se repinta en el lugar: la nota que se está escribiendo no se pierde.

import { h, icono, foto, rellenar, urlSegura } from '../dom.js';
import { capitalizar, fechaCorta, formatearMinutos, porcionesTexto, formatearTimer, nombreDe, textoOrigen, textoTraduccion } from '../formato.js';
import { agrupar, avisoCoccion, avisoMolde, chipsPorciones, enUnaLinea, hayQueGuardarVista, porcionesBase, porcionesIniciales, textoCantidad, textoReceta, vistasDe } from '../ingredientes.js';
import { esPropia, normalizar } from '../datos.js';
import { recetasEnLista } from '../compras.js';
import { nuevaCorreccion, nuevaEdicion, nuevaNota, nuevoTexto } from '../ediciones.js';
import { estadoPropia, pedidoDe } from '../bandeja.js';
import { progresoGuardado } from './cocina.js';
import { compartirTexto, confirmar, estrellas, navegacion, segmentado, sinReceta } from './controles.js';

const ESTADOS = [
  { valor: 'para_probar', nombre: 'Para probar' },
  { valor: 'probada', nombre: 'Probada' },
  { valor: 'favorita', nombre: 'Favorita' },
];
const MAX_PORCIONES = 99;

export function montar(contenedor, { app, volver, editar, avisar }, id) {
  let r = app.indice.porId.get(id);
  if (!r) {
    contenedor.append(sinReceta(app, id));
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
    icono('volver')),
  // Compartir la receta (por WhatsApp), con las porciones que se están viendo.
  h('button', { type: 'button', class: 'boton-redondo compartir', 'aria-label': 'Compartir la receta',
    onclick: () => compartirTexto(textoReceta(r, app.porciones.get(id))) }, icono('compartir')));
  const titulo = h('h1', { class: 'titulo-receta', tabindex: '-1' });
  const zonaMeta = h('div');

  // Estado y valoración
  const selector = segmentado('Estado de la receta', ESTADOS, r.estado, cambiarEstado);
  const valoracion = estrellas(Number(r.valoracion) || 0,
    v => editar(nuevaEdicion('receta.estado', { id, valoracion: v })), 'Valoración de la receta');
  const valorar = h('div', { class: 'valorar' }, h('span', { class: 'etiqueta-seccion' }, 'Valoración'), valoracion);
  const recuperar = h('button', { type: 'button', class: 'boton-secundario',
    onclick: () => {
      cambiarEstado(Number(r.valoracion) > 0 ? 'probada' : 'para_probar');
      selector.querySelector('[aria-pressed="true"]').focus();
    } }, 'Recuperarla');
  const descartada = h('div', { class: 'aviso-descartada' },
    h('p', null, h('strong', null, 'Descartada.'), ' No aparece en las recetas.'), recuperar);

  const zonaIngredientes = h('section', { class: 'seccion', 'aria-labelledby': 'titulo-ingredientes' });
  const zonaPasos = h('section', { class: 'seccion' });
  // «Cómo se armó»: lo que anotó /recetas (de dónde salió cada dato, qué estimó o corrigió), plegado.
  // El <details> no se repinta: así una sincronización no lo cierra.
  const cuerpoArmado = h('div', { class: 'como-se-armo-cuerpo' });
  const comoSeArmo = h('details', { class: 'como-se-armo' }, h('summary', null, 'Cómo se armó', icono('derecha', 18)), cuerpoArmado);
  // Lo que cambia sin mover el foco (las porciones), para el lector de pantalla.
  const anuncio = h('p', { class: 'solo-lector', role: 'status' });

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
    h('button', { type: 'button', class: 'boton-secundario', onclick: () => {
      cerrarNota();
      abrirNota.focus();
    } }, 'Cancelar'),
    h('button', { type: 'submit', class: 'boton-principal' }, 'Guardar nota')));

  // «Algo está mal en esta receta»: un pedido para que /recetas la corrija (va a la bandeja).
  // Como las notas, el formulario no se repinta. El recuadro de arriba muestra el pedido en curso.
  const zonaPedido = h('div');
  const textoPedido = h('textarea', {
    rows: '3', maxlength: '1000', 'aria-label': '¿Qué está mal?',
    placeholder: 'Ej.: la harina son 300 g, no 200.',
  });
  const abrirPedido = h('button', { type: 'button', class: 'boton-texto',
    onclick: () => {
      abrirPedido.hidden = true;
      formPedido.hidden = false;
      textoPedido.focus();
    } });
  const cerrarPedido = () => {
    textoPedido.value = '';
    formPedido.hidden = true;
    abrirPedido.hidden = false;
  };
  const formPedido = h('form', {
    class: 'form-nota',
    hidden: true,
    onsubmit: e => {
      e.preventDefault();
      if (!textoPedido.value.trim()) return textoPedido.focus();
      editar(nuevaCorreccion(id, textoPedido.value, app.config.quien));
      cerrarPedido();
      pintar();
      abrirPedido.focus();
      avisar('✓ Pedido. Se corrige la próxima vez que corra la Mac.');
    },
  },
  h('p', { class: 'secundario' }, 'Contá qué está mal y la Mac la corrige la próxima vez que corra.'),
  textoPedido,
  h('div', { class: 'form-botones' },
    h('button', { type: 'button', class: 'boton-secundario', onclick: () => {
      cerrarPedido();
      abrirPedido.focus();
    } }, 'Cancelar'),
    h('button', { type: 'submit', class: 'boton-principal' }, 'Pedir la corrección')));
  const cancelarPedido = () => {
    editar(nuevaCorreccion(id, '', app.config.quien));
    pintar();
    // El recuadro (con este botón) desaparece: el foco va al botón de pedir.
    abrirPedido.focus();
    avisar('Pedido cancelado. La receta queda como estaba.');
  };

  const descartar = h('button', { type: 'button', class: 'boton-texto alerta-texto',
    onclick: () => {
      cambiarEstado('descartada');
      recuperar.focus();
    } }, 'Descartar receta');

  // Receta propia (SPEC_v2 §6.2): el texto que escriben para que la Mac la ordene. Como las notas, el
  // formulario no se repinta mientras está abierto; lo de arriba (el estado y el texto guardado), sí.
  const zonaPropia = h('section', { class: 'seccion', 'aria-labelledby': 'titulo-propia' });
  const estadoTexto = h('div', { class: 'propia-estado' });
  const campoTexto = h('textarea', { rows: '8', maxlength: '5000', 'aria-label': 'La receta',
    placeholder: '4 milanesas, 1 kg de papa, manteca y leche. Freí las milanesas…' });
  const abrirTexto = h('button', { type: 'button', class: 'boton-secundario boton-chico', onclick: () => abrirFormTexto() });
  const reescribir = h('button', { type: 'button', class: 'boton-texto', onclick: () => abrirFormTexto() }, 'Reescribir la receta');
  const cerrarTexto = () => {
    campoTexto.value = '';
    formTexto.hidden = true;
  };
  const formTexto = h('form', {
    class: 'form-nota',
    hidden: true,
    onsubmit: e => {
      e.preventDefault();
      if (!campoTexto.value.trim()) return campoTexto.focus();
      const { fila } = estadoPropia(r, app.datos?.bandeja);
      editar(nuevoTexto(id, campoTexto.value, fila && fila.id, app.config.quien));
      cerrarTexto();
      pintar();
      // El foco va al recuadro con el texto guardado.
      const guardado = estadoTexto.querySelector('[tabindex="-1"]');
      (guardado || titulo).focus();
      avisar('✓ Guardada. La Mac la ordena en la próxima corrida.');
    },
  },
  h('p', { class: 'secundario' }, 'Escribila como te salga: la Mac la ordena en ingredientes y pasos la próxima vez que corra.'),
  campoTexto,
  h('div', { class: 'form-botones' },
    h('button', { type: 'button', class: 'boton-secundario', onclick: () => {
      cerrarTexto();
      pintar();
      (abrirTexto.hidden ? reescribir : abrirTexto).focus();
    } }, 'Cancelar'),
    h('button', { type: 'submit', class: 'boton-principal' }, 'Guardar la receta')));
  zonaPropia.append(estadoTexto, abrirTexto, formTexto);

  /** Abre el campo con el texto que ya tenía (si tenía), en lugar del botón. */
  function abrirFormTexto() {
    campoTexto.value = estadoPropia(r, app.datos?.bandeja).texto;
    formTexto.hidden = false;
    abrirTexto.hidden = true;
    reescribir.hidden = true;
    zonaPropia.hidden = false;
    campoTexto.focus();
  }

  const botonCocinar = h('a', {
    class: 'boton-principal',
    href: '#/cocina/' + id,
    // Cocinarla con otra cantidad de porciones la guarda como vista.
    onclick: () => {
      const n = app.porciones.get(id);
      if (hayQueGuardarVista(r, n)) editar(nuevaEdicion('receta.porciones', { id, porciones: n }));
    },
  });

  const barraCocinar = h('div', { class: 'barra-acciones sobre-navegacion' }, botonCocinar);
  const nav = navegacion('biblioteca', app);
  contenedor.append(h('article', { class: 'ficha con-navegacion' },
    anuncio,
    portada,
    h('div', { class: 'ficha-cuerpo' },
      titulo,
      zonaMeta,
      zonaPedido,
      h('div', { class: 'ficha-estado' }, selector, valorar, descartada),
      zonaPropia,
      zonaIngredientes,
      zonaPasos,
      comoSeArmo,
      h('section', { class: 'seccion' }, tituloNotas, listaNotas, abrirNota, formNota),
      h('div', { class: 'ficha-pie' }, abrirPedido, formPedido, reescribir, descartar),
    ),
    barraCocinar,
  ), nav);

  function pintarMeta() {
    const fuente = urlSegura(r.fuente_url);
    const propia = esPropia(r);
    const datos = [
      // Una propia dice «Receta nuestra» en lugar del autor, y se edita (nombre, tipo y rinde).
      propia ? h('span', null, 'Receta nuestra') : null,
      propia ? h('a', { href: '#/editar/' + id }, icono('lapiz', 14), 'Editar') : null,
      propia ? null : fuente ? h('a', { href: fuente, target: '_blank', rel: 'noopener noreferrer' }, r.autor || 'Ver el video', icono('externo', 14))
        : r.autor ? h('span', null, r.autor) : null,
      r.tiempo_min ? h('span', null, formatearMinutos(r.tiempo_min)) : null,
      r.molde ? h('span', null, 'Molde ' + r.molde) : null,
      textoTraduccion(r.idioma_original) ? h('span', null, textoTraduccion(r.idioma_original)) : null,
    ].filter(Boolean);
    rellenar(zonaMeta,
      datos.length ? h('div', { class: 'ficha-meta' }, datos) : null,
      r.confianza === 'baja' ? h('p', { class: 'alerta' }, icono('aviso', 18), propia
        ? 'Puede que falten cantidades o pasos: revisá lo que escribieron antes de empezar.'
        : 'Puede que falten cantidades o pasos. Mirá el video antes de empezar.') : null,
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
    const molde = avisoMolde(r, n);
    const { secciones, utensilios } = agrupar(r.ingredientes);
    const enCompras = recetasEnLista(app.datos?.compras).find(x => x.receta_id === id);
    // Una propia sin ordenar no muestra ingredientes: lo dice su recuadro (pintarPropia).
    zonaIngredientes.hidden = esPropia(r) && !r.ingredientes.length;
    if (!r.ingredientes.length) {
      return rellenar(zonaIngredientes,
        h('h2', { id: 'titulo-ingredientes' }, 'Ingredientes'),
        h('p', { class: 'secundario' }, 'Esta receta no tiene ingredientes cargados. Mirá el video para saber qué lleva.'));
    }
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
      molde ? h('p', { class: 'alerta' }, icono('aviso', 18), molde) : null,
      !enCompras
        ? h('a', { class: 'boton-secundario boton-chico', href: '#/compras/agregar/' + id }, icono('compras', 18), 'Agregar a compras')
        : h('div', { class: 'en-compras' },
          h('span', null, icono('compras', 18), 'En compras' + (enCompras.porciones ? ' para ' + enCompras.porciones : '')),
          h('a', { class: 'boton-texto', href: '#/compras' }, 'Ver la lista'),
          h('a', { class: 'boton-texto', href: '#/compras/agregar/' + id }, 'Cambiar')),
      h('a', { class: 'boton-texto', href: '#/ingredientes/' + id }, icono('lapiz', 18), 'Editar ingredientes'),
    );
  }

  /** Porciones: −/+ para probar otro número y, si hay vistas guardadas, un chip por cada una. */
  function porciones(base, n) {
    const elegir = m => {
      if (m < 1 || m > MAX_PORCIONES || m === n) return;
      app.porciones.set(id, m);
      conFoco(zonaIngredientes, pintarIngredientes);
      pintarPasos();
      anuncio.textContent = porcionesTexto(m);
    };
    const chips = chipsPorciones(r);
    const esVista = vistasDe(r).includes(n);
    return h('div', { class: 'porciones' },
      h('div', { class: 'porciones-control' },
        h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Menos porciones', 'aria-disabled': String(n <= 1),
          onclick: () => elegir(n - 1) }, icono('menos', 18)),
        h('span', { class: 'porciones-n' }, porcionesTexto(n)),
        h('button', { type: 'button', class: 'boton-redondo chico', 'aria-label': 'Más porciones', 'aria-disabled': String(n >= MAX_PORCIONES),
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
          // El botón ya no está: el foco va al −/+, que sigue en el mismo lugar.
          zonaIngredientes.querySelector('.porciones-control button').focus();
        } }, 'Quitar la vista de ' + n) : null,
    );
  }

  function pintarPasos() {
    barraCocinar.hidden = !r.pasos.length;
    zonaPasos.hidden = esPropia(r) && !r.pasos.length;
    if (!r.pasos.length) {
      return rellenar(zonaPasos, h('h2', null, 'Pasos'),
        h('p', { class: 'secundario' }, 'Esta receta no tiene pasos. Mirá el video para cocinarla.'));
    }
    const base = porcionesBase(r);
    const coccion = base ? avisoCoccion(r, (app.porciones.get(id) || base) / base) : '';
    rellenar(zonaPasos,
      h('h2', null, 'Pasos'),
      coccion ? h('p', { class: 'alerta' }, icono('aviso', 18), coccion) : null,
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

  function pintarPedido() {
    const fila = pedidoDe(app.datos?.bandeja, id);
    abrirPedido.textContent = fila ? 'Sumar algo al pedido' : 'Algo está mal en esta receta';
    // Mientras la Mac la corrige, la API no acepta pedidos: el botón no se ofrece (si tenía el foco, pasa al título).
    const corrigiendo = !!fila && fila.estado === 'procesando';
    // Una propia sin ordenar, o con un texto esperando, se corrige cambiando el texto (la API no acepta pedidos).
    const propia = esPropia(r) ? estadoPropia(r, app.datos?.bandeja) : null;
    const conTexto = !!propia && (propia.estado !== 'ordenada' || !!propia.reescritura);
    if ((corrigiendo || conTexto) && document.activeElement === abrirPedido) titulo.focus({ preventScroll: true });
    abrirPedido.hidden = corrigiendo || conTexto || !formPedido.hidden;
    if (!fila) return rellenar(zonaPedido);
    const cancelar = h('button', { type: 'button', class: 'boton-secundario', onclick: cancelarPedido }, 'Cancelar el pedido');
    const texto = h('p', { class: 'pedido-texto' }, fila.pedido);
    if (fila.estado === 'procesando') {
      return rellenar(zonaPedido, h('div', { class: 'aviso-pedido' },
        h('p', null, h('strong', null, 'Corrigiéndose…'), ' La Mac la está procesando ahora.'), texto));
    }
    if (fila.estado === 'ayuda') {
      return rellenar(zonaPedido, h('div', { class: 'aviso-pedido' },
        h('p', { class: 'motivo' }, icono('aviso', 18), fila.motivo || 'No se pudo corregir.'), texto,
        h('div', { class: 'form-botones' }, cancelar, h('a', { class: 'boton-secundario', href: '#/bandeja' }, 'Ver en la Bandeja'))));
    }
    rellenar(zonaPedido, h('div', { class: 'aviso-pedido' },
      h('p', null, h('strong', null, 'Hay una corrección pedida.'), ' Se hace la próxima vez que corra la Mac.'), texto, cancelar));
  }

  const CONFIANZA = {
    alta: 'Los datos están completos: salieron del texto, los subtítulos o un audio claro.',
    media: 'Hubo que estimar algunos pasos o completar algo por contexto.',
    baja: 'Faltan cantidades importantes: mirá el video antes de empezar.',
  };
  // Una propia salió de lo que escribieron ellos: no hay video para mirar.
  const CONFIANZA_PROPIA = {
    alta: 'Los datos están completos: salieron de lo que escribieron.',
    media: 'Hubo que completar algo por contexto: lo que no estaba quedó «a ojo».',
    baja: 'Faltan cantidades importantes: revisá lo que escribieron antes de empezar.',
  };

  /** El recuadro de una receta propia: si falta escribirla, si la Mac la va a ordenar o si no pudo. */
  function pintarPropia() {
    if (!esPropia(r)) {
      zonaPropia.hidden = true;
      reescribir.hidden = true;
      return;
    }
    const p = estadoPropia(r, app.datos?.bandeja);
    const abierto = !formTexto.hidden;
    const ordenada = p.estado === 'ordenada';
    // Ya ordenada, sin un texto nuevo esperando: la ficha de siempre y «Reescribir la receta» al pie.
    zonaPropia.hidden = ordenada && !p.reescritura && !abierto;
    if (document.activeElement === reescribir && (p.reescritura || !ordenada)) titulo.focus({ preventScroll: true });
    reescribir.hidden = !ordenada || !!p.reescritura || abierto;
    abrirTexto.hidden = abierto || (ordenada && !p.reescritura);
    abrirTexto.textContent = p.estado === 'sin_texto' ? 'Escribir la receta' : 'Cambiar el texto';
    const texto = p.texto.trim() ? h('p', { class: 'texto-propio' }, p.texto) : null;
    const recuadro = (...hijos) => h('div', { class: 'aviso-pedido', tabindex: '-1' }, ...hijos);
    const cual = ordenada ? p.reescritura : p.estado;
    let contenido;
    if (cual === 'sin_texto') {
      contenido = [h('p', null, h('strong', null, 'Todavía no escribieron esta receta.')),
        h('p', { class: 'secundario' }, 'Escribila como salga y la Mac la ordena en ingredientes y pasos.')];
    } else if (cual === 'esperando') {
      contenido = [recuadro(h('p', null, h('strong', null, ordenada ? 'La Mac la va a reordenar con el texto nuevo' : 'La Mac la va a ordenar'),
        ' en la próxima corrida. Mientras tanto, la receta tal como la escribieron:'), texto)];
    } else if (cual === 'ordenando') {
      contenido = [recuadro(h('p', null, h('strong', null, ordenada ? 'La Mac la está reordenando ahora.' : 'La Mac la está ordenando ahora.')), texto)];
    } else if (cual === 'ayuda') {
      contenido = [recuadro(h('p', { class: 'motivo' }, icono('aviso', 18), p.fila.motivo || 'La Mac no pudo ordenarla.'), texto)];
    } else {
      contenido = [];
    }
    // Si el foco estaba en el recuadro (recién guardado el texto), vuelve al nuevo.
    const teniaFoco = estadoTexto.contains(document.activeElement);
    rellenar(estadoTexto, ordenada ? null : h('h2', { id: 'titulo-propia' }, 'La receta'), contenido);
    const nuevo = teniaFoco && estadoTexto.querySelector('[tabindex="-1"]');
    if (nuevo) nuevo.focus({ preventScroll: true });
    if (ordenada) zonaPropia.removeAttribute('aria-labelledby');
    else zonaPropia.setAttribute('aria-labelledby', 'titulo-propia');
  }

  function pintarArmado() {
    const origen = textoOrigen(r.origen_datos);
    const notas = String(r.notas_proceso || '').trim();
    const confianza = (esPropia(r) ? CONFIANZA_PROPIA : CONFIANZA)[r.confianza];
    comoSeArmo.hidden = !origen && !notas;
    rellenar(cuerpoArmado,
      origen ? h('p', null, 'Salió de ' + origen + '.') : null,
      confianza ? h('p', null, confianza) : null,
      notas ? h('p', { class: 'notas-proceso' }, notas) : null);
  }

  // Editar una nota: el formulario abierto no se toca al repintar (no pierde lo escrito, el foco ni el
  // teclado del celular); las demás notas sí se repintan. Se edita una por vez.
  let editando = null; // { id, form, campo }
  const cabezaNota = n => (nombreDe(n.quien) || 'Nuestra nota') + ' · ' + fechaCorta(n.fecha) + (n.actualizado ? ' · editada' : '');
  // Para el lector de pantalla: «la nota de Laura del 12/10» o «nuestra nota del 12/10».
  const cualNota = n => (nombreDe(n.quien) ? 'la nota de ' + nombreDe(n.quien) : 'nuestra nota') + ' del ' + fechaCorta(n.fecha);
  // Si «Sumar una nota» está oculto (su formulario está abierto), el foco va a ese formulario.
  const focoNotas = () => (abrirNota.hidden ? textoNota : abrirNota).focus();

  function terminarEdicion(foco) {
    editando = null;
    pintar();
    const el = foco && listaNotas.querySelector('[data-foco="' + foco + '"]');
    if (el) el.focus();
    else focoNotas();
  }

  async function borrarNota(n) {
    const texto = n.texto.length > 140 ? n.texto.slice(0, 140) + '…' : n.texto;
    const si = await confirmar({ titulo: '¿Borrar esta nota?', texto: cabezaNota(n) + ': «' + texto + '»', si: 'Borrar' });
    if (!si) return;
    editar(nuevaEdicion('nota.borrar', { id: n.id }));
    pintar();
    // La nota (y su botón) ya no están.
    focoNotas();
    avisar('Nota borrada.');
  }

  function empezarEdicion(n) {
    if (editando) {
      editando.campo.focus();
      return avisar('Primero guardá o cancelá la nota que estás editando.');
    }
    const campo = h('textarea', { rows: String(Math.min(10, Math.max(3, Math.ceil(n.texto.length / 40)))),
      maxlength: '2000', 'aria-label': 'Editar ' + cualNota(n) });
    campo.value = n.texto;
    const form = h('form', { class: 'nota form-nota', onsubmit: e => {
      e.preventDefault();
      const texto = campo.value.trim();
      if (!texto) return campo.focus();
      if (texto !== n.texto) editar(nuevaEdicion('nota.editar', { id: n.id, texto }));
      terminarEdicion('editar:' + n.id);
    } },
    h('strong', null, cabezaNota(n)),
    campo,
    h('div', { class: 'form-botones' },
      h('button', { type: 'button', class: 'boton-secundario', onclick: () => terminarEdicion('editar:' + n.id) }, 'Cancelar'),
      h('button', { type: 'submit', class: 'boton-principal' }, 'Guardar')));
    listaNotas.querySelector('[data-nota="' + n.id + '"]').replaceWith(form);
    editando = { id: n.id, form, campo };
    campo.focus();
  }

  function tarjetaNota(n) {
    return h('div', { class: 'nota', 'data-nota': n.id },
      // Quién la escribió («Laura · 12/10»); una nota sin `quien` queda como «Nuestra nota».
      h('strong', null, cabezaNota(n)),
      h('p', null, n.texto),
      h('div', { class: 'nota-acciones' },
        h('button', { type: 'button', class: 'boton-texto', 'data-foco': 'editar:' + n.id,
          'aria-label': 'Editar ' + cualNota(n), onclick: () => empezarEdicion(n) }, 'Editar'),
        h('button', { type: 'button', class: 'boton-texto alerta-texto', 'data-foco': 'borrar:' + n.id,
          'aria-label': 'Borrar ' + cualNota(n), onclick: () => borrarNota(n) }, 'Borrar')));
  }

  function pintarNotas() {
    tituloNotas.textContent = r.notas.length > 1 ? 'Nuestras notas' : r.notas.length ? 'Nuestra nota' : 'Notas';
    const form = editando && editando.form.isConnected ? editando.form : null;
    if (!form) {
      editando = null;
      // Si el foco estaba en un botón de una nota (una sincronización repinta), vuelve al mismo.
      const enfocado = listaNotas.contains(document.activeElement) && document.activeElement.getAttribute('data-foco');
      rellenar(listaNotas, r.notas.length ? r.notas.map(tarjetaNota)
        : h('p', { class: 'secundario' }, 'Todavía no hay notas. Cuando la cocinen, cuenten cómo salió.'));
      const el = enfocado && listaNotas.querySelector('[data-foco="' + enfocado + '"]');
      if (el) el.focus({ preventScroll: true });
      return;
    }
    // El formulario queda quieto: se repinta lo de alrededor. Si la borraron en el otro celular,
    // queda arriba hasta guardar (la API avisa) o cancelar.
    const i = r.notas.findIndex(n => n.id === editando.id);
    [...listaNotas.children].forEach(c => { if (c !== form) c.remove(); });
    form.before(...r.notas.slice(0, Math.max(i, 0)).map(tarjetaNota));
    form.after(...r.notas.slice(i + 1).map(tarjetaNota));
  }

  function pintar() {
    r = app.indice.porId.get(id) || r;
    titulo.textContent = r.titulo;
    const progreso = progresoGuardado(r.id, r.pasos.length);
    rellenar(botonCocinar, icono('cocinar', 22),
      progreso ? 'Seguir cocinando (paso ' + (progreso + 1) + ')' : 'Empezar a cocinar');
    pintarMeta();
    pintarEstado();
    pintarPropia();
    conFoco(zonaIngredientes, pintarIngredientes);
    pintarPasos();
    pintarArmado();
    pintarNotas();
    pintarPedido();
    nav.actualizar();
  }

  pintar();
  return {
    actualizar: pintar,
    // Una nota a medio escribir: una versión nueva de la app espera para recargar.
    ocupada: () => (!formNota.hidden && textoNota.value.trim() !== '') || (!formPedido.hidden && textoPedido.value.trim() !== '')
      || (!formTexto.hidden && campoTexto.value.trim() !== '') || !!editando,
  };
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
    h('span', { class: 'cantidad' }, textoCantidad(i.cantidad, i.unidad, factor)),
  );
}
