// Ediciones de la app y su cola offline (§7.1). Cada edición se aplica al
// instante en los datos locales y se manda a la API cuando hay conexión. Hasta
// entonces queda en la cola (IndexedDB) y se vuelve a aplicar sobre lo que baje
// `todo`. Las acciones de la API son idempotentes: reintentar no duplica nada.
// Puro, sin DOM ni IndexedDB.

import { rolUsuario, seccionUsuario, nuevasVistas } from './ingredientes.js';
import { claveIngrediente } from './compras.js';

const ALFABETO = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Id al azar con prefijo: n_k3x9a0zq. Las notas lo llevan desde el celular, así un reintento no las duplica. */
export function idAzar(prefijo, largo = 8, azar = Math.random) {
  let s = '';
  for (let i = 0; i < largo; i++) s += ALFABETO.charAt(Math.floor(azar() * ALFABETO.length));
  return prefijo + '_' + s;
}

/** Una edición para la cola: { id, accion, datos, creada }. `accion` es la de la API y `datos`, lo que se le manda. */
export function nuevaEdicion(accion, datos, ahora = new Date()) {
  return { id: idAzar('e'), accion, datos, creada: ahora.toISOString() };
}

/** Edición para sumar una nota, con su id y la fecha del celular. */
export function nuevaNota(recetaId, quien, texto, ahora = new Date()) {
  return nuevaEdicion('nota.agregar', {
    id: idAzar('n'),
    receta_id: recetaId,
    quien,
    texto: String(texto).trim(),
    fecha: ahora.toISOString(),
  }, ahora);
}

/** Aplica una edición a los datos locales, como lo haría la API. Devuelve datos nuevos; aplicarla dos veces da lo mismo. */
export function aplicarEdicion(datos, { accion, datos: d }) {
  if (!datos) return datos;
  const enReceta = cambios => Object.assign({}, datos, {
    recetas: datos.recetas.map(r => (r.id === d.id ? Object.assign({}, r, cambios(r)) : r)),
  });
  const compras = datos.compras || [];
  const enCompras = cambios => Object.assign({}, datos, {
    compras: compras.map(c => (d.ids.includes(c.id) ? Object.assign({}, c, cambios) : c)),
  });
  switch (accion) {
    case 'receta.estado':
      return enReceta(() => {
        const c = {};
        if (d.estado) c.estado = d.estado;
        if (d.valoracion !== undefined && d.valoracion !== null) c.valoracion = d.valoracion;
        return c;
      });
    case 'receta.porciones':
      return enReceta(r => ({ porciones_vistas: nuevasVistas(r.porciones_vistas, d.porciones, d.quitar) }));
    case 'receta.ingredientes': {
      const elegidos = new Map(d.ingredientes.map(i => [i.id, i]));
      return Object.assign({}, datos, {
        ingredientes: datos.ingredientes.map(i => {
          const e = i.receta_id === d.id && elegidos.get(i.id);
          if (!e) return i;
          return Object.assign({}, i, { rol_usuario: rolUsuario(e.rol, i.rol), seccion_usuario: seccionUsuario(e.seccion, i.seccion) });
        }),
      });
    }
    case 'compras.agregar': {
      // Como la API: suma lo que no está (por id) y, con receta_id, saca lo de esa receta que no vino.
      const ids = new Set(d.items.map(i => i.id));
      const existentes = new Set(compras.map(c => c.id));
      const quedan = compras.filter(c => !(d.receta_id && c.receta_id === d.receta_id && !ids.has(c.id)));
      const nuevos = d.items.filter(i => !existentes.has(i.id)).map(i => ({
        id: i.id,
        receta_id: d.receta_id || '',
        nombre: i.nombre,
        cantidad: i.cantidad ?? null,
        unidad: i.unidad || 'a ojo',
        gondola: i.gondola || '',
        hecho: false,
        rol: i.rol || 'principal',
        lugar: i.lugar || '',
        porciones: d.porciones ?? null,
      }));
      return Object.assign({}, datos, { compras: quedan.concat(nuevos) });
    }
    case 'compras.marcar':
      return enCompras({ hecho: d.hecho === true || d.hecho === 'true' });
    case 'compras.mover':
      return enCompras({ lugar: d.lugar || '' });
    case 'compras.quitar':
      return Object.assign({}, datos, { compras: compras.filter(c => !d.ids.includes(c.id)) });
    case 'lugares.asignar': {
      const lugares = datos.lugares || [];
      const clave = d.por === 'ingrediente' ? String(d.clave).replace(/\s+/g, ' ').trim() : d.clave;
      const misma = l => l.por === d.por && (d.por === 'tipo' ? l.clave === clave : claveIngrediente(l.clave) === claveIngrediente(clave));
      if (!d.lugar) return Object.assign({}, datos, { lugares: lugares.filter(l => !misma(l)) });
      if (!lugares.some(misma)) return Object.assign({}, datos, { lugares: lugares.concat({ id: '', por: d.por, clave, lugar: d.lugar }) });
      return Object.assign({}, datos, { lugares: lugares.map(l => (misma(l) ? Object.assign({}, l, { lugar: d.lugar }) : l)) });
    }
    case 'bandeja.actualizar':
      return Object.assign({}, datos, {
        bandeja: datos.bandeja.map(b => {
          if (b.id !== d.id) return b;
          const reinicia = d.estado === 'pendiente' && (b.estado === 'ayuda' || b.estado === 'descartada');
          return Object.assign({}, b, {
            estado: d.estado,
            motivo: d.estado === 'ayuda' ? d.motivo || '' : '',
            intentos: reinicia ? 0 : b.intentos,
          });
        }),
      });
    case 'nota.agregar':
      if (datos.notas.some(n => n.id === d.id)) return datos;
      return Object.assign({}, datos, {
        notas: datos.notas.concat({ id: d.id, receta_id: d.receta_id, fecha: d.fecha, quien: d.quien, texto: d.texto }),
      });
    default:
      return datos;
  }
}

/** Los datos con todas las ediciones pendientes aplicadas, en orden. */
export function aplicarCola(datos, cola) {
  return (cola || []).reduce(aplicarEdicion, datos);
}

/**
 * ¿Conviene reintentar una edición que falló? Sí si no llegó (sin conexión), si la
 * API tuvo un problema (5xx, ocupada, sin columnas), si todavía no conoce la acción
 * (la app se publicó antes que la API) o si el token no es válido (se arregla con
 * un link nuevo). No si la API la rechazó por los datos: reintentarla daría lo mismo.
 */
export function esReintentable(err) {
  if (['red', 'respuesta', 'accion_desconocida', 'token_invalido'].includes(err.codigo)) return true;
  return !(err.status >= 400 && err.status < 500);
}

/**
 * Manda las ediciones de `cola`, en orden, con `enviar(edicion)` (una promesa).
 * Saca de `cola` (la misma lista, así entran las que se sumen mientras tanto) cada
 * una que llega y llama a `alCambiar()` para guardarla. Si una falla y conviene
 * reintentarla, corta ahí; si no, la descarta y sigue.
 * Devuelve { enviadas, descartadas: [{ edicion, mensaje }], error }.
 */
export async function procesarCola(cola, enviar, alCambiar = () => {}) {
  let enviadas = 0;
  const descartadas = [];
  while (cola.length) {
    const edicion = cola[0];
    try {
      await enviar(edicion);
      enviadas++;
    } catch (err) {
      if (esReintentable(err)) return { enviadas, descartadas, error: err };
      descartadas.push({ edicion, mensaje: err.message });
    }
    const i = cola.indexOf(edicion);
    if (i !== -1) cola.splice(i, 1);
    await alCambiar();
  }
  return { enviadas, descartadas, error: null };
}
