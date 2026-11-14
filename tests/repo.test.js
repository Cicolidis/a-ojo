// Lo que el repo necesita para correr igual en cualquier computadora (la Mac y la de Laura).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = archivo => fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

test('.claude/settings.json: los permisos de /recetas, sin rutas de un usuario', () => {
  const texto = leer('.claude/settings.json');
  const permisos = JSON.parse(texto).permissions.allow;
  assert.ok(permisos.includes('Read(~/.a-ojo/**)'), 'lee la carpeta de trabajo, en el home de quien sea');
  assert.ok(permisos.includes('Bash(procesamiento/aojo api *)'));
  assert.doesNotMatch(texto, /\/(Users|home)\//, 'nada de rutas fijas');
  assert.match(leer('.gitignore'), /^\.claude\/settings\.local\.json$/m, 'los permisos personales no se suben');
});
