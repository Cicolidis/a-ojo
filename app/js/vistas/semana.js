// Plan semanal (#/semana y #/semana/AAAA-MM-DD, SPEC_v2 §4.1): «Sin día» arriba y cada día con
// almuerzo y cena apilados. La semana va en la dirección (su lunes): una versión nueva de la app,
// que recarga la página, no cambia de semana. Abre en la actual; hoy se destaca.
// «+» en cada comida lleva a elegir una receta; cada entrada tiene una hoja con sus porciones,
// «Mover», «Quitar» y, si es de hoy, «Empezar a cocinar». Todo va por la cola (ediciones.js).

import { h, icono, foto, rellenar } from '../dom.js';
import { nuevaEdicion } from '../ediciones.js';
import { hayQueGuardarVista } from '../ingredientes.js';
import { COMIDAS, armarSemana, diaCorto, diasDe, hayCompra, hoyIso, lunesDe, sumarDias, textoDia, textoSemana } from '../plan.js';
import { cargando, contadorPorciones, navegacion, segmentado, tocarAfueraCierra, vacio } from './controles.js';

/** «Lunes 16 · Cena» o «Sin día». */
export function textoLugar(fecha, comida) {
  return fecha ? textoDia(fecha) + ' · ' + (COMIDAS.find(c => c.valor === comida) || { nombre: '' }).nombre : 'Sin día';
}

/** La dirección del «+»: elegir una receta para esa comida (o para «Sin día»). */
export function direccionElegir(semana, fecha, comida) {
  return '#/semana/' + semana + '/elegir' + (fecha ? '?fecha=' + fecha + '&comida=' + comida : '');
}

export function montar(contenedor, { app, editar, avisar, reemplazar }, semanaPedida) {
  const hoy = hoyIso();
  const actual = lunesDe(hoy);
  const semana = semanaPedida || actual;
  // Sin semana en la dirección: se escribe la actual, así «volver» desde una ficha vuelve a esta misma.
  if (!semanaPedida) history.replaceState(history.state, '', '#/semana/' + semana);

  const titulo = h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, textoSemana(semana));
  const cual = h('p', { class: 'secundario' });
  const sync = h('p', { class: 'estado-sync', role: 'status' });
  const zona = h('div', { class: 'semana-dias' });
  // «Armar la compra de la semana» (SPEC_v2 §4.2), abajo: solo si queda algo por cocinar.
  const compra = h('a', { class: 'boton-principal armar-compra', href: '#/semana/' + semana + '/compra' }, icono('compras', 20), 'Armar la compra de la semana');
  const dialogo = tocarAfueraCierra(h('dialog', { class: 'hoja', 'aria-labelledby': 'titulo-entrada' }));
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
    compra,
    dialogo,
  ), nav);

  cual.textContent = semana === actual ? 'Esta semana' : semana === sumarDias(actual, 7) ? 'La que viene'
    : semana < actual ? 'Ya pasó' : '';

  const claveMas = (fecha, comida) => 'mas:' + (fecha ? fecha + ':' + comida : 'sin-dia');

  /** El «+» de una comida (o de «Sin día»). */
  const botonMas = (fecha, comida) => h('a', { class: 'boton-redondo chico', href: direccionElegir(semana, fecha, comida),
    'data-foco': claveMas(fecha, comida), 'aria-label': 'Sumar una receta: ' + textoLugar(fecha, comida) }, icono('mas', 18));

  /** Una entrada: foto chica, título y porciones (tocarla abre la ficha) y el botón de su hoja. */
  function entrada(e) {
    const donde = textoLugar(e.fecha, e.comida);
    const opciones = h('button', { type: 'button', class: 'boton-redondo chico', 'data-foco': 'e:' + e.id,
      'aria-label': 'Opciones: ' + (e.receta ? e.receta.titulo : 'receta que ya no está') + ', ' + donde,
      onclick: () => abrirEntrada(e) }, icono('puntos', 18));
    if (!e.receta) {
      return h('li', { class: 'entrada' }, h('span', { class: 'entrada-link sin-receta' },
        h('span', { class: 'reciente-texto' }, h('strong', null, 'Receta que ya no está'))), opciones);
    }
    const r = e.receta;
    return h('li', { class: 'entrada' },
      h('a', { class: 'entrada-link', href: '#/receta/' + r.id },
        foto(r, 'mini-foto'),
        h('span', { class: 'reciente-texto' },
          h('strong', null, r.titulo + (e.porciones ? ' · ' + e.porciones : '')),
          r.estado === 'descartada' ? h('span', { class: 'secundario' }, 'Descartada') : null)),
      opciones);
  }

  /** Un renglón de comida: el rótulo con su «+» y sus entradas. */
  function comida(fecha, valor, entradas) {
    const nombre = COMIDAS.find(c => c.valor === valor).nombre;
    return h('div', { class: 'semana-comida' },
      h('div', { class: 'semana-comida-cabeza' }, h('h3', { class: 'etiqueta-seccion' }, nombre), botonMas(fecha, valor)),
      entradas.length ? h('ul', { class: 'entradas' }, entradas.map(entrada)) : null);
  }

  /** Manda la entrada con otros datos (otro día, comida o porciones): plan.poner la reemplaza por id. */
  function poner(e, cambios) {
    const nueva = Object.assign({ id: e.id, semana: e.semana, fecha: e.fecha, comida: e.comida, receta_id: e.receta_id,
      porciones: e.porciones }, cambios);
    editar(nuevaEdicion('plan.poner', { items: [nueva], quien: app.config.quien }));
    return nueva;
  }

  /**
   * La hoja de una entrada: porciones (se mandan una vez, al cerrar), «Mover», «Quitar» y, si es de
   * hoy y tiene pasos, «Empezar a cocinar». Mientras está abierta, la semana no se repinta.
   */
  function abrirEntrada(e) {
    const r = e.receta;
    let porciones = Number(e.porciones) || null;
    let foco = 'e:' + e.id;
    const acciones = [];
    if (r && porciones) {
      acciones.push(h('div', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, 'Porciones'),
        contadorPorciones(porciones, n => { porciones = n; })));
    }
    if (r && e.fecha === hoy && r.pasos.length) {
      acciones.push(h('a', { class: 'boton-principal', href: '#/cocina/' + r.id, onclick: () => {
        // Cocina con las porciones de ese día (y, si hace falta, quedan como vista, como desde la ficha).
        if (porciones) {
          app.porciones.set(r.id, porciones);
          if (hayQueGuardarVista(r, porciones)) editar(nuevaEdicion('receta.porciones', { id: r.id, porciones }));
        }
        dialogo.close();
      } }, icono('cocinar', 22), 'Empezar a cocinar'));
    }
    if (r) acciones.push(h('button', { type: 'button', class: 'boton-secundario', onclick: () => elegirLugar(e) }, icono('mover', 20), 'Mover'));
    acciones.push(h('button', { type: 'button', class: 'boton-secundario alerta-texto', onclick: () => {
      editar(nuevaEdicion('plan.quitar', { ids: [e.id] }));
      foco = claveMas(e.fecha, e.comida);
      porciones = Number(e.porciones) || null;
      dialogo.close();
      avisar('Quitada de la semana.');
    } }, 'Quitar de la semana'));
    acciones.push(h('button', { type: 'button', class: 'boton-texto', onclick: () => dialogo.close() }, 'Cerrar'));

    rellenar(dialogo,
      h('h2', { id: 'titulo-entrada' }, r ? r.titulo : 'Receta que ya no está'),
      h('p', { class: 'secundario' }, textoLugar(e.fecha, e.comida)),
      h('div', { class: 'hoja-botones' }, acciones));
    dialogo.onclose = () => {
      dialogo.onclose = null;
      if (porciones && porciones !== Number(e.porciones) && (app.datos.plan || []).some(x => x.id === e.id)) poner(e, { porciones });
      pintar(foco);
    };
    dialogo.showModal();
  }

  /** «Mover»: primero el día (o «Sin día») y después la comida; «Mover» confirma. */
  function elegirLugar(e) {
    let fecha = e.fecha;
    let cual = e.comida || 'cena';
    const comidas = segmentado('Comida', COMIDAS, cual, v => { cual = v; }, 'chico');
    const dias = [''].concat(diasDe(semana));
    const botones = dias.map(f => h('button', { type: 'button', class: 'opcion-lugar opcion-dia', 'aria-pressed': String(f === fecha),
      'aria-label': f ? textoDia(f) : 'Sin día', onclick: () => {
        fecha = f;
        botones.forEach((b, i) => b.setAttribute('aria-pressed', String(dias[i] === fecha)));
        comidas.hidden = !fecha;
      } }, f ? diaCorto(f) : 'Sin día'));
    comidas.hidden = !fecha;
    rellenar(dialogo,
      h('h2', { id: 'titulo-entrada' }, '¿Cuándo hacemos ' + e.receta.titulo + '?'),
      h('div', { class: 'opciones-dias', role: 'group', 'aria-label': 'Día' }, botones),
      comidas,
      h('div', { class: 'form-botones' },
        h('button', { type: 'button', class: 'boton-secundario', onclick: () => dialogo.close() }, 'Cancelar'),
        h('button', { type: 'button', class: 'boton-principal', onclick: () => {
          const destino = { fecha, comida: fecha ? cual : '' };
          if (destino.fecha !== e.fecha || destino.comida !== e.comida) {
            poner(e, destino);
            avisar('Movida a ' + textoLugar(destino.fecha, destino.comida) + '.');
          }
          // Ya está mandada con su lugar nuevo: al cerrar no se vuelve a mandar.
          e = Object.assign({}, e, destino);
          dialogo.onclose = () => {
            dialogo.onclose = null;
            pintar(claveMas(destino.fecha, destino.comida));
          };
          dialogo.close();
        } }, 'Mover')));
    botones.find(b => b.getAttribute('aria-pressed') === 'true').focus();
  }

  /** Repinta y deja el foco en el control equivalente (data-foco): el pedido o el que lo tenía; si no está, el título. */
  function pintar(foco) {
    foco = foco || (document.activeElement && document.activeElement.getAttribute('data-foco'));
    compra.hidden = true;
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
    compra.hidden = !hayCompra(app.datos.plan, semana, hoy);
    rellenar(zona,
      !s.total ? vacio({ figura: 'calendario', titulo: 'Todavía no hay nada para esta semana',
        acciones: [{ texto: 'Elegir una receta', href: direccionElegir(semana) }] }) : null,
      s.sinDia.length ? h('section', { class: 'semana-dia sin-dia', 'aria-label': 'Sin día' },
        h('div', { class: 'semana-comida-cabeza' }, h('h2', null, 'Sin día'), botonMas('', '')),
        h('ul', { class: 'entradas' }, s.sinDia.map(entrada))) : null,
      s.dias.map(d => h('section', { class: 'semana-dia' + (d.fecha === hoy ? ' hoy' : ''), 'aria-label': textoDia(d.fecha) },
        h('h2', null, textoDia(d.fecha), d.fecha === hoy ? h('span', { class: 'marca-hoy' }, 'Hoy') : null),
        comida(d.fecha, 'almuerzo', d.almuerzo),
        comida(d.fecha, 'cena', d.cena))),
    );
    if (!foco) return;
    const el = zona.querySelector('[data-foco="' + foco + '"]');
    (el || titulo).focus({ preventScroll: !!el });
  }

  function actualizar() {
    const pendientes = app.cola.length;
    sync.textContent = [
      app.sync.estado === 'sin_conexion' || app.sync.estado === 'error' ? app.sync.mensaje : '',
      pendientes === 1 ? '1 cambio sin mandar' : pendientes ? pendientes + ' cambios sin mandar' : '',
    ].filter(Boolean).join(' · ');
    sync.classList.toggle('error', app.sync.estado === 'error');
    nav.actualizar();
    // Con la hoja abierta, lo que baja la sincronización espera a que se cierre (onclose repinta).
    if (!dialogo.open) pintar();
  }

  actualizar();
  return {
    actualizar,
    desmontar() {
      if (dialogo.open) dialogo.close();
    },
  };
}
