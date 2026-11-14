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

test('los scripts de shell tienen sintaxis válida y finales de línea LF', () => {
  const { spawnSync } = require('node:child_process');
  const scripts = ['setup.sh', 'procesamiento/aojo',
    ...fs.readdirSync(path.join(RAIZ, 'scripts')).filter(f => f.endsWith('.sh')).map(f => 'scripts/' + f)];
  for (const s of scripts) {
    assert.doesNotMatch(leer(s), /\r\n/, s + ' sin CRLF');
    const r = spawnSync('sh', ['-n', path.join(RAIZ, s)], { encoding: 'utf8' });
    assert.equal(r.status, 0, s + ': ' + r.stderr);
  }
  assert.match(leer('.gitattributes'), /eol=lf/);
});

test('setup.sh acepta macOS y Linux con apt (WSL 2), y frena en el disco de Windows', () => {
  const setup = leer('setup.sh');
  assert.match(setup, /Darwin\) SISTEMA=mac/);
  assert.match(setup, /Linux\) SISTEMA=linux/);
  assert.match(setup, /apt-get install -y -qq ffmpeg/);
  assert.match(setup, /\/mnt\/\*\)/, 'clonar en /mnt/c es lento: lo avisa');
});
