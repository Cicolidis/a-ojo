// Bandeja (#/bandeja): los links que necesitan ayuda (Subir capturas, Descartar,
// Probar de nuevo), los que esperan a la Mac y las recetas recién llegadas.
// Descartar y Probar de nuevo van por la cola; las capturas, que pesan, se mandan
// directo y piden conexión.

import { h, icono, foto, rellenar, urlSegura } from '../dom.js';
import { fechaHora } from '../formato.js';
import { agruparBandeja, cuantasCapturas, descripcionLink } from '../bandeja.js';
import { idAzar, nuevaEdicion } from '../ediciones.js';
import { llamarApi } from '../api.js';
import { achicarImagen } from '../imagenes.js';
import { cargando, navegacion, vacio } from './controles.js';

const MAX_CAPTURAS = 6;
const CONFIANZA = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Faltan datos' };

export function montar(contenedor, { app, editar, avisar, sincronizar }) {
  const ultima = h('p', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const zona = h('div', { class: 'bandeja-secciones' });
  const nav = navegacion('bandeja', app);
  // Capturas elegidas por fila mientras la pantalla está abierta: id → { archivos, urls, lote, estado }.
  // estado: elegidas · mandando · mandadas. Así una sincronización no las pierde.
  const subidas = new Map();

  const titulo = h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'Bandeja');

  contenedor.append(h('div', { class: 'bandeja con-navegacion' },
    titulo,
    ultima,
    sync,
    zona,
  ), nav);

  const liberar = id => {
    const s = subidas.get(id);
    if (s && s.urls) s.urls.forEach(u => URL.revokeObjectURL(u));
    subidas.delete(id);
  };

  function elegir(fila, archivos) {
    if (!archivos.length) return;
    if (archivos.length > MAX_CAPTURAS) avisar('Van hasta ' + MAX_CAPTURAS + ' capturas: tomé las primeras ' + MAX_CAPTURAS + '.');
    liberar(fila.id);
    const elegidas = archivos.slice(0, MAX_CAPTURAS);
    // El lote se elige acá: si el envío se reintenta, la API no duplica las imágenes.
    subidas.set(fila.id, { archivos: elegidas, urls: elegidas.map(a => URL.createObjectURL(a)), lote: idAzar('x', 10).slice(2), estado: 'elegidas' });
    pintar('mandar:' + fila.id);
  }

  async function mandar(fila) {
    const s = subidas.get(fila.id);
    if (s.estado === 'mandando') return;
    s.estado = 'mandando';
    pintar('mandar:' + fila.id);
    try {
      const imagenes = [];
      for (const archivo of s.archivos) imagenes.push(await achicarImagen(archivo));
      await llamarApi(app.config, 'capturas.subir', { bandeja_id: fila.id, lote: s.lote, imagenes },
        { metodo: 'POST', timeoutMs: 120000 });
      s.urls.forEach(u => URL.revokeObjectURL(u));
      subidas.set(fila.id, { estado: 'mandadas' });
      pintar('ok:' + fila.id);
      avisar('✓ Capturas mandadas. Quedó esperando a la Mac.');
      sincronizar();
    } catch (err) {
      s.estado = 'elegidas';
      pintar('mandar:' + fila.id);
      avisar(err.codigo === 'red' ? 'Sin conexión. Probá de nuevo cuando vuelva.' : 'No se pudieron mandar: ' + err.message);
    }
  }

  function cambiarEstado(fila, estado, aviso) {
    liberar(fila.id);
    editar(nuevaEdicion('bandeja.actualizar', { id: fila.id, estado }));
    pintar();
    // La tarjeta cambió de lugar o ya no está: el foco vuelve al título.
    titulo.focus();
    avisar(aviso);
  }

  function cabeza(fila) {
    const url = urlSegura(fila.url);
    return h('div', { class: 'link-cabeza' },
      h('div', null,
        h('strong', null, descripcionLink(fila)),
        h('span', { class: 'secundario' }, 'Guardado ' + fechaHora(fila.creado))),
      url ? h('a', { class: 'boton-redondo', href: url, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': 'Abrir el original: ' + descripcionLink(fila) }, icono('externo', 18)) : null);
  }

  function tarjetaAyuda(fila) {
    const s = subidas.get(fila.id);
    let acciones;
    const desc = descripcionLink(fila);
    if (s && s.estado === 'mandadas') {
      acciones = h('p', { class: 'ok-texto', tabindex: '-1', 'data-foco': 'ok:' + fila.id },
        icono('check', 18), 'Capturas mandadas. Esperando a la Mac…');
    } else if (s) {
      // Mientras se mandan, los botones quedan con aria-disabled: el foco no se pierde.
      const mandando = s.estado === 'mandando';
      acciones = [
        h('div', { class: 'miniaturas' }, s.urls.map((u, i) => h('img', { src: u, alt: 'Captura ' + (i + 1) }))),
        h('div', { class: 'form-botones' },
          h('button', { type: 'button', class: 'boton-secundario', 'aria-disabled': String(mandando), onclick: () => {
            if (mandando) return;
            liberar(fila.id);
            pintar('subir:' + fila.id);
          } }, 'Cancelar'),
          h('button', { type: 'button', class: 'boton-principal', 'aria-disabled': String(mandando), 'data-foco': 'mandar:' + fila.id,
            onclick: () => mandar(fila) },
          mandando ? 'Mandando…' : s.archivos.length === 1 ? 'Mandar 1 captura' : 'Mandar ' + s.archivos.length + ' capturas')),
      ];
    } else {
      const entrada = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'solo-lector', 'data-foco': 'subir:' + fila.id,
        onchange: e => elegir(fila, [...e.target.files]) });
      acciones = [
        h('div', { class: 'form-botones' },
          h('button', { type: 'button', class: 'boton-secundario', 'aria-label': 'Descartar ' + desc,
            onclick: () => cambiarEstado(fila, 'descartada', 'Descartado. Si lo volvés a guardar, vuelve a la bandeja.') }, 'Descartar'),
          h('label', { class: 'boton-principal' }, entrada, icono('imagen', 20), 'Subir capturas')),
        h('button', { type: 'button', class: 'boton-texto', 'aria-label': 'Probar de nuevo sin capturas: ' + desc,
          onclick: () => cambiarEstado(fila, 'pendiente', 'Lo vuelve a intentar la próxima vez que corra la Mac.') }, 'Probar de nuevo sin capturas'),
      ];
    }
    return h('li', { class: 'tarjeta-link' },
      cabeza(fila),
      fila.motivo ? h('p', { class: 'motivo' }, icono('aviso', 18), fila.motivo) : null,
      acciones);
  }

  function tarjetaEsperando(fila) {
    const n = cuantasCapturas(fila);
    const estado = fila.estado === 'procesando' ? 'Procesando…'
      : (n ? (n === 1 ? 'Con 1 captura · ' : 'Con ' + n + ' capturas · ') : '') + 'Esperando a la Mac';
    return h('li', { class: 'tarjeta-link' },
      cabeza(fila),
      h('div', { class: 'link-pie' },
        h('span', { class: 'secundario' }, estado),
        fila.estado === 'pendiente' ? h('button', { type: 'button', class: 'boton-texto alerta-texto',
          'aria-label': 'Descartar ' + descripcionLink(fila),
          onclick: () => cambiarEstado(fila, 'descartada', 'Descartado. Si lo volvés a guardar, vuelve a la bandeja.') }, 'Descartar') : null));
  }

  function tarjetaReciente({ fila, receta }) {
    return h('li', null, h('a', { class: 'tarjeta-reciente', href: '#/receta/' + receta.id },
      foto(receta, 'mini-foto'),
      h('span', { class: 'reciente-texto' },
        h('strong', null, receta.titulo),
        h('span', { class: 'secundario' }, 'Llegó ' + fechaHora(fila.actualizado))),
      receta.confianza ? h('span', { class: 'confianza ' + receta.confianza }, CONFIANZA[receta.confianza] || receta.confianza) : null));
  }

  const seccion = (titulo, items) => h('section', { class: 'bloque' },
    h('h2', { class: 'etiqueta-seccion' }, titulo),
    h('ul', { class: 'lista-links' }, items));

  /** Repinta y devuelve el foco al control equivalente (data-foco): el indicado o el que lo tenía. */
  function pintar(foco) {
    foco = foco || (document.activeElement && document.activeElement.getAttribute('data-foco'));
    const g = agruparBandeja(app.datos?.bandeja, app.indice.porId);
    ultima.textContent = !app.datos ? '' : g.ultimaCorrida
      ? 'La Mac procesó por última vez ' + fechaHora(g.ultimaCorrida) + '.'
      : 'La Mac todavía no procesó nada.';
    const vacia = !g.ayuda.length && !g.esperando.length && !g.recientes.length;
    rellenar(zona,
      g.ayuda.length ? seccion('Necesita ayuda', g.ayuda.map(tarjetaAyuda)) : null,
      g.esperando.length ? seccion('Esperando a la Mac…', g.esperando.map(tarjetaEsperando)) : null,
      g.recientes.length ? seccion('Recién llegadas', g.recientes.map(tarjetaReciente)) : null,
      !vacia ? null : !app.datos
        ? (app.sync.estado === 'sincronizando' ? cargando('Bajando la bandeja…')
          : vacio({ figura: 'aviso', titulo: 'Todavía no se bajó la bandeja', texto: 'Cuando haya conexión, aparece sola.' }))
        : vacio({ figura: 'bandeja', titulo: 'La bandeja está vacía',
          texto: 'Compartí un video con «Guardar receta» o guardalo desde la extensión.' }),
    );
    const el = foco && zona.querySelector('[data-foco="' + foco + '"]');
    if (el) el.focus({ preventScroll: true });
  }

  function actualizar() {
    const pendientes = app.cola.length;
    sync.textContent = [
      app.sync.estado === 'sin_conexion' || app.sync.estado === 'error' ? app.sync.mensaje : '',
      pendientes === 1 ? '1 cambio sin mandar' : pendientes ? pendientes + ' cambios sin mandar' : '',
    ].filter(Boolean).join(' · ');
    sync.classList.toggle('error', app.sync.estado === 'error');
    nav.actualizar();
    // Las que ya se mandaron y la Mac tomó dejan de estar en ayuda: se olvidan.
    for (const id of subidas.keys()) {
      const fila = (app.datos?.bandeja || []).find(b => b.id === id);
      if (!fila || fila.estado !== 'ayuda') liberar(id);
    }
    pintar();
  }

  actualizar();
  return {
    actualizar,
    desmontar() {
      [...subidas.keys()].forEach(liberar);
    },
  };
}
