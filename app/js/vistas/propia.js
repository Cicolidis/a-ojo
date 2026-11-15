// Una receta propia (SPEC_v2 §6.1): #/nueva la crea y #/editar/:id le cambia el nombre, el tipo y
// cuánto rinde. Crear lleva a su ficha (y «volver», de ahí, a la Biblioteca). Todo va por la cola
// (ediciones.js): la receta existe enseguida, también sin conexión.

import { h, icono } from '../dom.js';
import { esPropia } from '../datos.js';
import { nuevaEdicion, nuevaReceta } from '../ediciones.js';
import { nuevaEntrada } from '../plan.js';
import { textoLugar } from './semana.js';
import { cargando, contadorPorciones, segmentado, sinReceta } from './controles.js';

const TIPOS = [
  { valor: 'dulce', nombre: 'Dulce' },
  { valor: 'salado', nombre: 'Salado' },
  { valor: 'sopa', nombre: 'Sopa' },
  { valor: 'bebida', nombre: 'Bebida' },
  { valor: 'otro', nombre: 'Otro' },
];
// Decidido el 15/11: arrancan en 2 porciones y como saladas (los platos de siempre).
const PORCIONES_INICIALES = 2;
const TIPO_INICIAL = 'salado';
// Los mismos límites que la API: si no, la cola descartaría la receta entera.
const MAX_NOMBRE = 80;
const MAX_TEXTO = 5000;

export function montar(contenedor, { app, volver, reemplazar, editar, avisar }, id, ruta = {}) {
  const r = id ? app.indice.porId.get(id) : null;
  if (id && !esPropia(r)) {
    contenedor.append(sinReceta(app, id, r && {
      titulo: 'Esta receta no se edita acá', texto: 'Las que vienen de un video o de una web se corrigen con «Algo está mal».' }));
    return null;
  }
  const crear = !id;
  // Desde el «+» de la semana («Una receta nuestra»): al crearla, queda puesta ahí (SPEC_v2 §6.1).
  const enSemana = crear && ruta && ruta.semana ? { semana: ruta.semana, fecha: ruta.destino.fecha, comida: ruta.destino.comida } : null;
  const destino = enSemana ? '#/semana/' + enSemana.semana : crear ? '#/' : '#/receta/' + id;
  let tipo = (r && r.tipo) || TIPO_INICIAL;
  let porciones = (r && Number(r.porciones)) || PORCIONES_INICIALES;
  let tocoPorciones = false;
  let guardada = false;

  // Al crear, Enter en el nombre pasa a «La receta» (como dice la tecla) en lugar de guardar.
  const nombre = h('input', { type: 'text', id: 'nombre-receta', maxlength: String(MAX_NOMBRE), autocomplete: 'off',
    enterkeyhint: crear ? 'next' : 'done', placeholder: 'Ej.: Milanesas con puré', oninput: () => marcarError(false),
    onkeydown: e => {
      if (!crear || e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      texto.focus();
    } });
  if (r) nombre.value = r.titulo || '';
  const error = h('p', { class: 'error-campo', id: 'error-nombre', role: 'alert', hidden: true }, 'Poné un nombre para guardarla.');
  const marcarError = conError => {
    error.hidden = !conError;
    if (conError) {
      nombre.setAttribute('aria-invalid', 'true');
      nombre.setAttribute('aria-describedby', 'error-nombre');
    } else {
      nombre.removeAttribute('aria-invalid');
      nombre.removeAttribute('aria-describedby');
    }
  };

  const contador = contadorPorciones(porciones, n => {
    porciones = n;
    tocoPorciones = true;
  });
  const texto = crear ? h('textarea', { id: 'texto-receta', rows: '7', maxlength: String(MAX_TEXTO),
    placeholder: '4 milanesas, 1 kg de papa, manteca y leche. Freí las milanesas…' }) : null;

  const guardar = e => {
    e.preventDefault();
    // Un segundo toque mientras la pantalla cambia no crea otra receta.
    if (guardada) return;
    const titulo = nombre.value.replace(/\s+/g, ' ').trim();
    if (!titulo) {
      marcarError(true);
      return nombre.focus();
    }
    guardada = true;
    if (crear) {
      const edicion = nuevaReceta({ titulo, tipo, porciones, texto: texto.value }, app.config.quien);
      editar(edicion);
      if (enSemana) {
        editar(nuevaEdicion('plan.poner', { quien: app.config.quien,
          items: [nuevaEntrada(Object.assign({ receta_id: edicion.datos.id, porciones }, enSemana))] }));
        volver(destino);
        avisar('✓ Guardada y sumada a ' + textoLugar(enSemana.fecha, enSemana.comida) + '.');
        return;
      }
      // La ficha reemplaza a este formulario: «volver», desde ahí, va a la Biblioteca.
      reemplazar('#/receta/' + edicion.datos.id, '#/');
      avisar(edicion.datos.texto ? '✓ Guardada. La Mac la ordena en la próxima corrida.' : '✓ Guardada');
      return;
    }
    const cambios = {};
    if (titulo !== r.titulo) cambios.titulo = titulo;
    if (tipo !== r.tipo) cambios.tipo = tipo;
    if (tocoPorciones && porciones !== Number(r.porciones)) cambios.porciones = porciones;
    if (Object.keys(cambios).length) editar(nuevaEdicion('receta.editar', Object.assign({ id }, cambios)));
    // Con otro rinde, la ficha vuelve a abrir en él (no en las porciones que se estaban viendo).
    if ('porciones' in cambios) app.porciones.delete(id);
    volver(destino);
    if (Object.keys(cambios).length) avisar('✓ Cambios guardados');
  };

  const formulario = h('form', { class: 'form-propia', onsubmit: guardar, novalidate: true },
    h('div', { class: 'campo' }, h('label', { for: 'nombre-receta' }, 'Nombre'), nombre, error),
    h('div', { class: 'campo', role: 'group', 'aria-labelledby': 'rotulo-porciones' },
      h('span', { class: 'campo-rotulo', id: 'rotulo-porciones' }, crear ? 'Porciones' : 'Rinde'),
      contador,
      crear ? null : h('p', { class: 'editor-ayuda' },
        'Para cuántas porciones son las cantidades de la receta. Para cocinar para otras, usá el −/+ de la ficha.')),
    h('div', { class: 'campo' },
      h('span', { class: 'campo-rotulo', 'aria-hidden': 'true' }, 'Tipo'),
      segmentado('Tipo', TIPOS, tipo, v => { tipo = v; }, 'chico')),
    crear ? h('div', { class: 'campo' },
      h('label', { for: 'texto-receta' }, 'La receta (opcional)'),
      h('p', { class: 'editor-ayuda', id: 'ayuda-texto' },
        'Escribila como te salga: la Mac la ordena en ingredientes y pasos la próxima vez que corra. Se puede escribir después.'),
      texto) : null,
    h('button', { type: 'submit', class: 'boton-principal' }, crear ? 'Guardar la receta' : 'Guardar los cambios'));
  if (texto) texto.setAttribute('aria-describedby', 'ayuda-texto');

  // Sin datos todavía, lo guardado se perdería (editar() no encola sin datos): no se ofrece.
  const espera = h('div');
  contenedor.append(h('div', { class: 'editor' },
    h('div', { class: 'editor-arriba' },
      h('button', { type: 'button', class: 'boton-redondo', 'aria-label': enSemana ? 'Volver a la semana' : crear ? 'Volver a las recetas' : 'Volver a la receta',
        onclick: () => volver(destino) }, icono('volver'))),
    h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, crear ? 'Nueva receta' : 'Editar la receta'),
    crear ? h('p', { class: 'editor-ayuda' }, 'Una de las que ya hacen, sin video ni web. Va a decir «Receta nuestra».') : null,
    espera,
    formulario));

  function pintar() {
    formulario.hidden = !app.datos;
    espera.replaceChildren(...(app.datos ? [] : [app.sync.estado === 'sincronizando'
      ? cargando('Bajando las recetas…') : h('p', { class: 'secundario' }, 'Todavía no se bajaron las recetas. Probá cuando haya conexión.')]));
  }

  pintar();
  return {
    // Al sincronizar no se repinta el formulario: no pierde lo escrito ni el foco.
    actualizar: pintar,
    ocupada: () => !guardada && (nombre.value.trim() !== ((r && r.titulo) || '') || !!(texto && texto.value.trim())),
  };
}
