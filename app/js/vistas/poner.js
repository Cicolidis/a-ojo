// Sumar una receta a la semana con sus porciones (SPEC_v2 §4.1). Dos entradas:
// - #/semana/AAAA-MM-DD/poner/:id?fecha=…&comida=…: después de elegirla con el «+» de una comida (o
//   de «Sin día»); solo pide las porciones y vuelve a la semana.
// - #/semana/poner/:id: «Elegir día y comida» desde la ficha; pide la semana (esta o la que viene),
//   el día (o «Sin día»), la comida y las porciones, y vuelve a la ficha.
// Va por la cola (plan.poner); una receta sin porciones se suma sin número.

import { h, icono } from '../dom.js';
import { nuevaEdicion } from '../ediciones.js';
import { porcionesBase, porcionesIniciales } from '../ingredientes.js';
import { hoyIso, lunesDe, nuevaEntrada, sumarDias, textoSemana } from '../plan.js';
import { textoLugar } from './semana.js';
import { contadorPorciones, elegirDia, segmentado, sinReceta } from './controles.js';

export function montar(contenedor, { app, volver, editar, avisar }, ruta) {
  const r = app.indice.porId.get(ruta.id);
  if (!r) {
    contenedor.append(sinReceta(app, ruta.id));
    return null;
  }
  const elegirTodo = !ruta.semana;
  const actual = lunesDe(hoyIso());
  let semana = ruta.semana || actual;
  // Las que se están viendo en la ficha o las de su última vista; una receta sin porciones, ninguna.
  let porciones = porcionesBase(r) ? app.porciones.get(r.id) || porcionesIniciales(r) : null;
  const salida = elegirTodo ? '#/receta/' + r.id : '#/semana/' + semana;
  let guardada = false;

  // «Elegir día y comida»: la semana (esta o la que viene) y, con elegirDia, el día y la comida.
  const elegir = elegirTodo ? elegirDia(semana, '', 'cena') : null;
  const semanas = elegirTodo ? segmentado('Semana', [
    { valor: actual, nombre: 'Esta semana' },
    { valor: sumarDias(actual, 7), nombre: 'La que viene' },
  ], semana, v => {
    semana = v;
    elegir.cambiarSemana(v);
  }) : null;

  const guardar = () => {
    if (guardada) return;
    guardada = true;
    const { fecha, comida } = elegir ? elegir.valor() : ruta.destino;
    const entrada = nuevaEntrada({ semana, fecha, comida: fecha ? comida : '', receta_id: r.id, porciones });
    editar(nuevaEdicion('plan.poner', { items: [entrada], quien: app.config.quien }));
    volver(salida);
    avisar('✓ ' + r.titulo + ' en ' + textoLugar(fecha, comida) + (semana === actual ? '' : ' (' + textoSemana(semana).toLowerCase() + ')'),
      elegirTodo ? { texto: 'Ver', href: '#/semana/' + semana } : undefined);
  };

  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': elegirTodo ? 'Volver a la receta' : 'Volver a la semana',
        onclick: () => volver(salida) }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Sumar a la semana'),
    h('p', { class: 'secundario' }, r.titulo + (elegirTodo ? '' : ' · ' + textoLugar(ruta.destino.fecha, ruta.destino.comida))),
    elegirTodo ? h('div', { class: 'campo' }, h('span', { class: 'campo-rotulo', 'aria-hidden': 'true' }, 'Semana'), semanas) : null,
    elegirTodo ? h('div', { class: 'campo' }, h('span', { class: 'campo-rotulo', 'aria-hidden': 'true' }, 'Día'), elegir.el) : null,
    porciones ? h('div', { class: 'campo', role: 'group', 'aria-labelledby': 'rotulo-porciones' },
      h('span', { class: 'campo-rotulo', id: 'rotulo-porciones' }, 'Porciones'),
      contadorPorciones(porciones, n => { porciones = n; })) : h('p', { class: 'secundario' }, 'La receta no dice para cuántas porciones es: se suma así.'),
    h('div', { class: 'barra-acciones' }, h('button', { type: 'button', class: 'boton-principal', onclick: guardar }, icono('calendario', 20), 'Sumar a la semana')),
  ));

  return { actualizar() {} };
}
