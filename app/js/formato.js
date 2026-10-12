// Cómo se muestran cantidades, tiempos y fechas. Puro, sin DOM.

const FRACCIONES = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
];

const PLURALES = {
  cda: 'cdas',
  cdita: 'cditas',
  taza: 'tazas',
  pizca: 'pizcas',
  lata: 'latas',
  paquete: 'paquetes',
  diente: 'dientes',
  ramo: 'ramos',
};

/** Con coma decimal y hasta 2 decimales: 2.5 → «2,5». */
function decimal(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** 1.5 → «1 ½», 0.25 → «¼». Si no es una fracción común, va con coma decimal. */
export function formatearNumero(n, { fracciones = true } = {}) {
  const entero = Math.floor(n);
  const resto = n - entero;
  if (resto < 0.01) return String(entero);
  if (fracciones) {
    const f = FRACCIONES.find(([valor]) => Math.abs(resto - valor) < 0.02);
    if (f) return entero ? entero + ' ' + f[1] : f[1];
  }
  return decimal(n);
}

/**
 * Cantidad lista para mostrar: «200 g», «2 cdas», «½ taza», «3» (unidades)
 * o «a ojo» cuando no hay cantidad.
 */
export function formatearCantidad(cantidad, unidad) {
  const n = cantidad === null || cantidad === undefined || cantidad === '' ? NaN : Number(cantidad);
  if (unidad === 'a ojo' || !isFinite(n) || n <= 0) return 'a ojo';
  const numero = formatearNumero(n, { fracciones: unidad !== 'g' && unidad !== 'ml' });
  if (unidad === 'u' || !unidad) return numero;
  return numero + ' ' + (n > 1 && PLURALES[unidad] ? PLURALES[unidad] : unidad);
}

/** 45 → «45 min», 60 → «1 h», 75 → «1 h 15 min». */
export function formatearMinutos(min) {
  const m = Math.round(Number(min));
  if (!isFinite(m) || m <= 0) return '';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}

/** Duración de un timer: 5 → «5 min», 2.5 → «2,5 min», 90 → «1 h 30 min». */
export function formatearTimer(min) {
  const m = Number(min);
  return Number.isInteger(m) ? formatearMinutos(m) : decimal(m) + ' min';
}

/** «12/9», o «12/9/25» si no es de este año. */
export function fechaCorta(iso, hoy = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const base = d.getDate() + '/' + (d.getMonth() + 1);
  return d.getFullYear() === hoy.getFullYear() ? base : base + '/' + String(d.getFullYear()).slice(-2);
}

/** «hoy 14:32», «ayer 9:05» o «12/10 14:32» (en la hora del celular). */
export function fechaHora(iso, ahora = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hora = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(ahora) - dia(d)) / (24 * 60 * 60 * 1000));
  if (dias === 0) return 'hoy ' + hora;
  if (dias === 1) return 'ayer ' + hora;
  return fechaCorta(iso, ahora) + ' ' + hora;
}

/** Primera letra en mayúscula: «chocolate semiamargo» → «Chocolate semiamargo». */
export function capitalizar(texto) {
  const s = String(texto ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Cuenta regresiva: 272 s → «4:32»; 3725 s → «1:02:05». */
export function formatearReloj(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

const IDIOMAS = { en: 'inglés', pt: 'portugués', it: 'italiano', fr: 'francés', de: 'alemán' };

/** «Traducida del inglés» si la receta no estaba en castellano; vacío si sí. */
export function textoTraduccion(idioma) {
  const i = String(idioma || 'es').toLowerCase();
  if (i === 'es') return '';
  return IDIOMAS[i] ? 'Traducida del ' + IDIOMAS[i] : 'Traducida (original: ' + i + ')';
}
