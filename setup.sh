#!/bin/sh
# Prepara esta computadora para correr /recetas (macOS).
# Instala ffmpeg, uv y Node si faltan, crea procesamiento/.venv con yt-dlp y
# faster-whisper, baja el modelo de Whisper y prueba la conexión con la API.
# Se puede correr de nuevo cuando quieras: actualiza lo que haya.
set -e
cd "$(dirname "$0")"

paso() { printf '\n→ %s\n' "$1"; }

if [ "$(uname)" != "Darwin" ]; then
  echo "setup.sh está pensado para macOS. En Windows, usá WSL e instalá a mano lo mismo que acá." >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Falta Homebrew: instalalo desde https://brew.sh y volvé a correr ./setup.sh" >&2
  exit 1
fi

paso "Herramientas del sistema (ffmpeg, uv, node)"
for programa in ffmpeg uv node; do
  if command -v "$programa" >/dev/null 2>&1; then
    echo "  ✓ $programa"
  else
    brew install "$programa"
  fi
done
NODE_MAYOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAYOR" -lt 20 ]; then
  echo "  Node $NODE_MAYOR es viejo: hace falta 20 o más nuevo (brew upgrade node)." >&2
  exit 1
fi

paso "Entorno de Python (procesamiento/.venv)"
[ -x procesamiento/.venv/bin/python ] || uv venv --python 3.12 procesamiento/.venv
uv pip install --quiet --python procesamiento/.venv/bin/python -U -r procesamiento/requirements.txt
echo "  ✓ yt-dlp $(procesamiento/.venv/bin/yt-dlp --version)"

paso "Modelo de Whisper (la primera vez baja unos 500 MB)"
procesamiento/.venv/bin/python -c "
import os
from faster_whisper import WhisperModel
WhisperModel(os.environ.get('A_OJO_WHISPER_MODELO', 'small'), device='cpu', compute_type='int8')
print('  ✓ listo')"

mkdir -p "$HOME/.a-ojo/log" "$HOME/.a-ojo/trabajo"

paso "Configuración (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  Creé .env a partir de .env.example: completá A_OJO_API_URL y A_OJO_TOKEN y volvé a correr ./setup.sh" >&2
  exit 1
fi
set -a; . ./.env; set +a
if [ -z "${A_OJO_COOKIES_PERFIL:-}" ]; then
  echo "  ! Falta A_OJO_COOKIES_PERFIL: sin eso, los Reels de Instagram se procesan sin cookies (ver docs/perfil-instagram.md)."
else
  echo "  ✓ cookies de Instagram: ${A_OJO_COOKIES_NAVEGADOR:-chrome}, perfil «$A_OJO_COOKIES_PERFIL»"
fi

paso "Conexión con la API"
procesamiento/aojo api ping

printf '\nListo. Para procesar la bandeja, abrí Claude Code en esta carpeta y corré /recetas.\n'
