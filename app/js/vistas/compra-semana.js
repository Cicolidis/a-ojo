// La compra de la semana (#/semana/AAAA-MM-DD/compra, SPEC_v2 §4.2): como «Agregar a compras», pero
// para todas las recetas de la semana que faltan cocinar (y las de «Sin día»), con las porciones
// sumadas. Una sección plegable por receta: los principales marcados, los opcionales no y lo que está
// en la despensa desmarcado con «En casa». Si la receta ya está en la lista, arranca con lo de la lista.
// Guardar manda un compras.agregar por receta (el mismo de siempre: conserva lo marcado) y va a Compras.

import { h, icono, rellenar } from '../dom.js';
import { capitalizar, porcionesTexto } from '../formato.js';
import { esPropia } from '../datos.js';
import { agrupar, enUnaLinea, porcionesBase } from '../ingredientes.js';
import { elegidosDeSemana, idsPara, itemsDeReceta, recetasEnLista, textoParaComprar } from '../compras.js';
import { idAzar, nuevaEdicion } from '../ediciones.js';
import { compraDeLaSemana, hoyIso, textoSemana } from '../plan.js';
import { contadorPorciones, vacio } from './controles.js';

export function montar(contenedor, { app, volver, reemplazar, editar, avisar }, semana) {
  const origen = '#/semana/' + semana;
  const { recetas, sinIngredientes } = app.datos ? compraDeLaSemana(app.datos.plan, semana, hoyIso(), app.indice.porId)
    : { recetas: [], sinIngredientes: [] };
  // Lo que eligen por receta, mientras la pantalla está abierta: la sincronización no lo pisa.
  const estado = new Map(recetas.map(x => {
    const ini = elegidosDeSemana(x.receta, app.datos.compras, app.datos.despensa);
    const enLista = recetasEnLista(app.datos.compras).find(c => c.receta_id === x.receta.id);
    return [x.receta.id, Object.assign({ receta: x.receta, porciones: x.porciones, lista: enLista }, ini)];
  }));
  let tocada = false;
  let guardada = false;

  const boton = h('button', { type: 'button', class: 'boton-principal', onclick: guardar }, icono('compras', 20), 'Agregar a compras');
  const lista = h('div', { class: 'compra-semana' });

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver a la semana', onclick: () => volver(origen) }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Compra de la semana'),
    h('p', { class: 'secundario' }, textoSemana(semana) + ': lo que falta cocinar y lo de «Sin día».'),
    lista,
    recetas.length ? h('div', { class: 'barra-acciones' }, boton) : null,
  ));

  /** Una casilla: tildada se compra; «En casa» si está en la despensa. */
  function casilla(x, i, factor, opcional) {
    return h('li', null,
      h('label', { class: 'casilla' + (opcional ? ' opcional' : '') },
        h('input', { type: 'checkbox', checked: x.elegidos.has(i.id), onchange: e => {
          if (e.target.checked) x.elegidos.add(i.id);
          else x.elegidos.delete(i.id);
          tocada = true;
        } }),
        h('span', { class: 'casilla-texto' }, capitalizar(i.nombre),
          opcional ? h('span', { class: 'marca-opcional' }, 'opcional') : null,
          x.enCasa.has(i.id) ? h('span', { class: 'marca-en-casa' }, 'En casa') : null),
        h('span', { class: 'cantidad' }, textoParaComprar(i, factor))));
  }

  /** La sección de una receta, plegable (abierta). Las porciones se cambian con −/+ y repintan solo sus cantidades. */
  function seccion(x) {
    const base = porcionesBase(x.receta);
    const zonaIngredientes = h('div');
    const resumen = h('span', { class: 'secundario' });
    // El −/+ queda fijo (no pierde el foco); se repintan las cantidades.
    const contador = base && x.porciones ? contadorPorciones(x.porciones, n => {
      x.porciones = n;
      tocada = true;
      pintarIngredientes();
    }) : null;
    function pintarIngredientes() {
      const factor = base && x.porciones ? x.porciones / base : 1;
      resumen.textContent = x.porciones ? porcionesTexto(x.porciones) : '';
      const { secciones, utensilios } = agrupar(x.receta.ingredientes);
      const condimentos = secciones.flatMap(s => s.condimentos);
      rellenar(zonaIngredientes,
        secciones.filter(s => s.principales.length || s.opcionales.length).map(s => h('div', { class: 'grupo-ingredientes' },
          s.nombre ? h('h3', { class: 'etiqueta-seccion' }, s.nombre) : null,
          h('ul', { class: 'lista-casillas' }, s.principales.map(i => casilla(x, i, factor, false)), s.opcionales.map(i => casilla(x, i, factor, true))))),
        condimentos.length || utensilios.length ? h('p', { class: 'secundario' }, 'Revisá si tenés: ',
          enUnaLinea(condimentos.concat(utensilios), factor)) : null);
    }
    pintarIngredientes();
    return h('details', { class: 'compra-semana-receta', open: true },
      h('summary', null, h('span', { class: 'compra-semana-titulo' }, h('strong', null, x.receta.titulo), resumen), icono('derecha', 18)),
      h('div', { class: 'compra-semana-cuerpo' },
        x.enLista ? h('p', { class: 'secundario' }, 'Ya está en la lista: arranca con lo que tiene ahí.') : null,
        contador,
        zonaIngredientes));
  }

  function pintar() {
    if (!app.datos) return rellenar(lista, vacio({ figura: 'aviso', titulo: 'Todavía no se bajó la semana' }));
    if (!recetas.length && !sinIngredientes.length) {
      return rellenar(lista, vacio({ figura: 'compras', titulo: 'No hay nada para comprar en esta semana',
        texto: 'Sumá recetas a los días que faltan o a «Sin día».', acciones: [{ texto: 'Volver a la semana', href: origen }] }));
    }
    rellenar(lista,
      [...estado.values()].map(seccion),
      sinIngredientes.length ? h('section', { class: 'aviso-pedido sin-ingredientes' },
        h('p', null, h('strong', null, 'Sin ingredientes: '), sinIngredientes.map(r => r.titulo).join(', ') + '.'),
        h('p', { class: 'secundario' }, 'No entran en la compra hasta que tengan ingredientes.'),
        h('ul', { class: 'lista-links' }, sinIngredientes.map(r => h('li', null,
          h('a', { class: 'boton-texto', href: '#/receta/' + r.id },
            esPropia(r) ? 'Escribir la receta: ' + r.titulo : 'Ver ' + r.titulo))))) : null);
  }

  function guardar() {
    if (guardada) return;
    guardada = true;
    for (const x of estado.values()) {
      // Lo que ya está en la lista conserva su id: así no se pierde si está marcado ni adónde lo movieron.
      const items = itemsDeReceta(x.receta, x.porciones, x.elegidos, idsPara(x.receta, app.datos.compras, () => idAzar('c')));
      const base = porcionesBase(x.receta);
      if (items.length) {
        editar(nuevaEdicion('compras.agregar', { receta_id: x.receta.id, porciones: base && x.porciones ? x.porciones : null, items }));
      } else if (x.lista) {
        // No queda nada para comprar ni para revisar: si estaba en la lista, sale.
        editar(nuevaEdicion('compras.quitar', { ids: x.lista.ids }));
      }
    }
    reemplazar('#/compras', history.state && history.state.desde);
    avisar('✓ Compra de la semana armada');
  }

  pintar();
  return {
    // Lo que bajó la sincronización no pisa lo que están eligiendo.
    actualizar() {},
    ocupada: () => tocada && !guardada,
  };
}
