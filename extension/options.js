import { leerConfig, llamarApi } from './api.js';

const $ = id => document.getElementById(id);

function leerFormulario() {
  return {
    apiUrl: $('apiUrl').value.trim(),
    token: $('token').value.trim(),
    quien: $('quien').value,
  };
}

function validar({ apiUrl, token }) {
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(apiUrl)) {
    return 'La URL tiene que ser la del web app: empieza con https://script.google.com/ y termina en /exec.';
  }
  if (!token) return 'Falta el token.';
  return null;
}

function mostrarEstado(texto, tipo = '') {
  $('estado').textContent = texto;
  $('estado').className = tipo;
}

async function guardar(evento) {
  evento.preventDefault();
  const config = leerFormulario();
  const error = validar(config);
  if (error) return mostrarEstado(error, 'error');
  await chrome.storage.local.set(config);
  mostrarEstado('Guardado.', 'ok');
}

async function probar() {
  const config = leerFormulario();
  const error = validar(config);
  if (error) return mostrarEstado(error, 'error');
  $('probar').disabled = true;
  mostrarEstado('Probando…');
  try {
    const data = await llamarApi(config, { action: 'ping' });
    const faltan = data.hojas_faltantes || [];
    if (faltan.length) mostrarEstado(`Conecta, pero faltan hojas: ${faltan.join(', ')}. Corré setup().`, 'error');
    else mostrarEstado(`Conectado. API ${data.version}.`, 'ok');
  } catch (err) {
    mostrarEstado(err.message, 'error');
  } finally {
    $('probar').disabled = false;
  }
}

const config = await leerConfig();
$('apiUrl').value = config.apiUrl;
$('token').value = config.token;
$('quien').value = config.quien;
$('form').addEventListener('submit', guardar);
$('probar').addEventListener('click', probar);
