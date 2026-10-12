// Ficha de receta (#/receta/:id). En esta fase es de lectura: el estado, la
// valoración, las notas nuevas y las porciones se editan desde la Fase 4.

import { h, icono, foto, urlSegura } from '../dom.js';
import { capitalizar, fechaCorta, formatearCantidad, formatearMinutos, formatearTimer, textoTraduccion } from '../formato.js';
import { progresoGuardado } from './cocina.js';

export function montar(contenedor, { app, volver }, id) {
  const r = app.indice.porId.get(id);
  if (!r) {
    contenedor.append(h('div', { class: 'bienvenida' },
      h('h1', { class: 'titulo-pantalla', tabindex: '-1' },
        !app.datos && app.sync.estado === 'sincronizando' ? 'Bajando las recetas…' : 'No encontramos esta receta'),
      h('a', { class: 'boton-secundario', href: '#/' }, 'Ir a las recetas'),
    ));
    return null;
  }

  const fuente = urlSegura(r.fuente_url);
  const progreso = progresoGuardado(r.id, r.pasos.length);

  const portada = foto(r, 'ficha-foto');
  portada.prepend(h('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Volver', onclick: () => volver('#/') },
    icono('volver')));

  contenedor.append(h('article', { class: 'ficha' },
    portada,
    h('div', { class: 'ficha-cuerpo' },
      h('h1', { class: 'titulo-receta', tabindex: '-1' }, r.titulo),
      h('div', { class: 'ficha-meta' },
        fuente ? h('a', { href: fuente, target: '_blank', rel: 'noopener noreferrer' }, r.autor || 'Ver el video', icono('externo', 14)) : r.autor,
        r.tiempo_min ? h('span', null, formatearMinutos(r.tiempo_min)) : null,
        r.molde ? h('span', null, 'Molde ' + r.molde) : null,
        textoTraduccion(r.idioma_original) ? h('span', null, textoTraduccion(r.idioma_original)) : null,
      ),
      r.confianza === 'baja' ? h('p', { class: 'alerta' }, icono('aviso', 18),
        'Puede que falten cantidades o pasos. Mirá el video antes de empezar.') : null,
      seccionIngredientes(r),
      seccionPasos(r),
      r.notas.length ? h('section', { class: 'seccion' },
        h('h2', null, r.notas.length === 1 ? 'Nuestra nota' : 'Nuestras notas'),
        r.notas.map(n => h('div', { class: 'nota' },
          h('strong', null, 'Nuestra nota · ' + fechaCorta(n.fecha)),
          h('p', null, n.texto))),
      ) : null,
    ),
    h('div', { class: 'barra-acciones' },
      h('a', { class: 'boton-principal', href: '#/cocina/' + r.id }, icono('cocinar', 22),
        progreso ? 'Seguir cocinando (paso ' + (progreso + 1) + ')' : 'Empezar a cocinar'),
    ),
  ));
  return null;
}

function seccionIngredientes(r) {
  return h('section', { class: 'seccion' },
    h('div', { class: 'seccion-cabeza' },
      h('h2', null, 'Ingredientes'),
      r.porciones ? h('span', { class: 'secundario' }, 'Para ' + r.porciones + (Number(r.porciones) === 1 ? ' porción' : ' porciones')) : null),
    h('ul', { class: 'lista-ingredientes' }, r.ingredientes.map(i => h('li', null,
      h('span', null, capitalizar(i.nombre), i.nota ? h('span', { class: 'ingrediente-nota' }, i.nota) : null),
      h('span', { class: 'cantidad' }, formatearCantidad(i.cantidad, i.unidad)),
    ))),
  );
}

function seccionPasos(r) {
  return h('section', { class: 'seccion' },
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
