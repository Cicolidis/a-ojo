// Modo cocina (#/cocina/:id): un paso por pantalla, con la pantalla siempre
// encendida, los ingredientes del paso y timers que siguen corriendo entre pasos.
// El paso actual y los timers se guardan por receta en localStorage.

import { h, icono } from '../dom.js';
import { ingredientesDelPaso } from '../cocina.js';
import { capitalizar, formatearCantidad, formatearReloj, formatearTimer } from '../formato.js';

const clave = id => 'a-ojo:cocina:' + id;
const SONAR_MS = 2 * 60 * 1000; // Un timer vencido suena hasta 2 minutos; después queda marcado.

function leerProgreso(id) {
  try {
    const p = JSON.parse(localStorage.getItem(clave(id)) || 'null');
    return p && typeof p === 'object' ? { paso: Number(p.paso) || 0, timers: p.timers || {} } : null;
  } catch {
    return null;
  }
}

/** Paso en el que quedó la receta (0 si no se empezó), para el botón de la ficha. */
export function progresoGuardado(id, totalPasos) {
  const p = leerProgreso(id);
  return p && p.paso > 0 && p.paso < totalPasos ? p.paso : 0;
}

export function montar(contenedor, { app, volver }, id) {
  const r = app.indice.porId.get(id);
  if (!r || !r.pasos.length) {
    contenedor.append(h('div', { class: 'bienvenida' },
      h('h1', { class: 'titulo-pantalla', tabindex: '-1' }, 'No encontramos esta receta'),
      h('a', { class: 'boton-secundario', href: '#/' }, 'Ir a las recetas')));
    return null;
  }

  const pasos = r.pasos;
  const guardado = leerProgreso(id) || { paso: 0, timers: {} };
  let actual = Math.min(Math.max(guardado.paso, 0), pasos.length - 1);
  const timers = guardado.timers; // { idDelPaso: fin en ms }
  let terminado = false;

  const raiz = h('div', { class: 'cocina' });
  contenedor.append(raiz);

  const guardar = () => localStorage.setItem(clave(id), JSON.stringify({ paso: actual, timers }));
  const salir = () => volver('#/receta/' + id);

  // Pantalla siempre encendida
  let lock = null;
  const indicador = h('span', { class: 'pantalla-encendida', hidden: true }, icono('sol', 14), 'Pantalla siempre encendida');
  async function pedirLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || lock) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
        indicador.hidden = true;
      });
      indicador.hidden = false;
    } catch {
      indicador.hidden = true;
    }
  }
  const alVolver = () => {
    if (document.visibilityState === 'visible') {
      pedirLock();
      pintarTimers();
    }
  };
  document.addEventListener('visibilitychange', alVolver);
  pedirLock();

  // Sonido: el AudioContext se crea en un toque (los navegadores no dejan sonar sin uno).
  let audio = null;
  function prepararAudio() {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!audio && Contexto) audio = new Contexto();
    if (audio && audio.state === 'suspended') audio.resume();
  }
  let ultimoPitido = 0;
  function pitar() {
    if (Date.now() - ultimoPitido < 2000) return;
    ultimoPitido = Date.now();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    if (!audio) return;
    if (audio.state === 'suspended') audio.resume();
    [0, 0.25, 0.5].forEach(t => {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.frequency.value = 880;
      vol.gain.setValueAtTime(0.0001, audio.currentTime + t);
      vol.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + t + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18);
      osc.connect(vol).connect(audio.destination);
      osc.start(audio.currentTime + t);
      osc.stop(audio.currentTime + t + 0.2);
    });
  }

  // Los chips de los timers se arman solo cuando cambia cuáles hay; cada segundo
  // se actualiza el texto en el lugar, así un toque nunca cae en un botón que se reemplazó.
  const zonaTimers = h('div', { class: 'timers' });
  const anuncio = h('p', { class: 'solo-lector', role: 'status' });
  let chips = new Map(); // id del paso → { chip, texto, vencido }
  let activosAntes = '';
  function pintarTimers() {
    const ahora = Date.now();
    const activos = pasos.filter(p => timers[p.id]);
    if (activos.map(p => p.id).join() !== activosAntes) {
      activosAntes = activos.map(p => p.id).join();
      chips = new Map(activos.map(p => {
        const n = pasos.indexOf(p) + 1;
        const texto = h('span');
        const chip = h('span', { class: 'timer-chip' },
          h('button', { type: 'button', 'aria-label': 'Ir al paso ' + n, onclick: () => irA(n - 1) }, icono('reloj', 16), texto),
          h('button', { type: 'button', class: 'parar', 'aria-label': 'Parar el timer del paso ' + n, onclick: () => {
            delete timers[p.id];
            guardar();
            pintarTimers();
            if (!terminado) pintar(false);
          } }, icono('cerrar', 16)));
        return [p.id, { chip, texto, n, vencido: false }];
      }));
      zonaTimers.replaceChildren(...[...chips.values()].map(c => c.chip));
    }
    let suena = false;
    chips.forEach((c, pid) => {
      const resta = (timers[pid] - ahora) / 1000;
      const vencido = resta <= 0;
      if (vencido && !c.vencido) anuncio.textContent = 'Terminó el timer del paso ' + c.n;
      c.vencido = vencido;
      if (vencido && ahora - timers[pid] < SONAR_MS) suena = true;
      c.chip.classList.toggle('sono', vencido);
      c.texto.textContent = 'Paso ' + c.n + ' · ' + (vencido ? '¡Tiempo!' : formatearReloj(resta));
    });
    if (suena) pitar();
  }
  const reloj = setInterval(pintarTimers, 1000);
  // Cualquier toque habilita el sonido (por si se volvió a abrir con un timer corriendo).
  raiz.addEventListener('pointerdown', prepararAudio);

  function irA(i) {
    actual = Math.min(Math.max(i, 0), pasos.length - 1);
    terminado = false;
    guardar();
    pintar(true);
  }

  function terminar() {
    terminado = true;
    localStorage.removeItem(clave(id));
    Object.keys(timers).forEach(k => delete timers[k]);
    raiz.replaceChildren(
      h('div', { class: 'cocina-arriba' },
        h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Salir del modo cocina', onclick: salir }, icono('cerrar'))),
      h('div', { class: 'cocina-fin' },
        h('h1', { tabindex: '-1' }, '¡Listo! Que lo disfruten.'),
        h('p', { class: 'secundario' }, r.titulo),
        h('button', { type: 'button', class: 'boton-principal', onclick: salir }, 'Volver a la receta'),
        h('button', { type: 'button', class: 'boton-secundario', onclick: () => irA(0) }, 'Cocinarla de nuevo')),
    );
    raiz.querySelector('h1').focus();
  }

  function pintar(enfocar) {
    const p = pasos[actual];
    const ultimo = actual === pasos.length - 1;
    const ingredientes = ingredientesDelPaso(p.texto, r.ingredientes);
    const texto = h('p', { class: 'paso-texto' + (p.texto.length > 180 ? ' largo' : ''), tabindex: '-1' }, p.texto);

    raiz.replaceChildren(
      h('div', { class: 'cocina-arriba' },
        h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Salir del modo cocina', onclick: salir }, icono('cerrar')),
        indicador),
      h('div', {
        class: 'progreso',
        role: 'progressbar',
        'aria-label': 'Progreso de la receta',
        'aria-valuemin': '1',
        'aria-valuemax': String(pasos.length),
        'aria-valuenow': String(actual + 1),
      }, pasos.map((_, i) => h('span', { class: i <= actual ? 'hecho' : '' }))),
      zonaTimers,
      anuncio,
      h('div', { class: 'cocina-paso' },
        h('p', { class: 'paso-n' }, 'PASO ' + (actual + 1) + ' DE ' + pasos.length),
        texto,
        ingredientes.length ? h('div', { class: 'chips-ingredientes', 'aria-label': 'Ingredientes de este paso' },
          ingredientes.map(i => h('span', null, capitalizar(i.nombre) + ' · ' + formatearCantidad(i.cantidad, i.unidad)))) : null,
        Number(p.timer_min) > 0 && !timers[p.id] ? h('button', {
          type: 'button',
          class: 'boton-secundario boton-timer',
          onclick: () => {
            prepararAudio();
            timers[p.id] = Date.now() + Number(p.timer_min) * 60 * 1000;
            guardar();
            pintar(false);
          },
        }, icono('reloj'), 'Timer de ' + formatearTimer(p.timer_min)) : null,
        p.tip ? h('p', { class: 'tip' }, h('b', null, 'Tip del video: '), p.tip) : null,
      ),
      h('div', { class: 'cocina-anteriores' },
        pasos.slice(Math.max(0, actual - 2), actual).map((ant, j, lista) => {
          const n = actual - lista.length + j;
          return h('button', { type: 'button', 'aria-label': 'Volver al paso ' + (n + 1), onclick: () => irA(n) },
            icono('check', 18), h('span', null, (n + 1) + ' · ' + ant.texto));
        })),
      h('div', { class: 'cocina-botones' },
        h('button', { type: 'button', class: 'boton-secundario', disabled: actual === 0, onclick: () => irA(actual - 1) }, 'Anterior'),
        h('button', { type: 'button', class: 'boton-principal', onclick: () => {
          prepararAudio();
          if (ultimo) terminar();
          else irA(actual + 1);
        } }, ultimo ? 'Terminé' : 'Listo, siguiente')),
    );
    pintarTimers();
    if (enfocar) {
      window.scrollTo(0, 0);
      texto.focus({ preventScroll: true });
    }
  }

  pintar(false);
  return {
    enCocina: true,
    desmontar() {
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
      if (lock) lock.release();
      if (audio) audio.close();
    },
  };
}
