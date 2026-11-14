#!/bin/sh
# Prepara esta computadora para correr /recetas: macOS (la Mac) o Linux con apt
# (Ubuntu en WSL 2, la computadora de Laura; ver docs/procesar-en-windows.md).
# Instala ffmpeg y uv si faltan (y Node en la Mac), crea procesamiento/.venv con
# yt-dlp y faster-whisper, baja el modelo de Whisper y prueba la conexión con la API.
# Se puede correr de nuevo cuando quieras: actualiza lo que haya.
set -e
cd "$(dirname "$0")"

paso() { printf '\n→ %s\n' "$1"; }
tiene() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin) SISTEMA=mac ;;
  Linux) SISTEMA=linux ;;
  *)
    echo "setup.sh corre en macOS o en Linux. En Windows, usá WSL 2: ver docs/procesar-en-windows.md" >&2
    exit 1 ;;
esac

if [ "$SISTEMA" = mac ]; then
  if ! tiene brew; then
    echo "Falta Homebrew: instalalo desde https://brew.sh y volvé a correr ./setup.sh" >&2
    exit 1
  fi

  paso "Herramientas del sistema (ffmpeg, uv, node)"
  for programa in ffmpeg uv node; do
    if tiene "$programa"; then
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
else
  case "$(pwd)" in
    /mnt/*)
      echo "  ! El repo está en el disco de Windows ($(pwd)): ahí todo anda muy lento." >&2
      echo "    Clonalo en el disco de WSL (por ejemplo en ~/a-ojo) y corré ./setup.sh desde ahí." >&2
      exit 1 ;;
  esac
  if ! tiene apt-get; then
    echo "En Linux, setup.sh usa apt (Ubuntu o Debian). Instalá ffmpeg y uv a mano y volvé a correrlo." >&2
    exit 1
  fi

  paso "Herramientas del sistema (ffmpeg, uv)"
  # La primera vez, apt pide la contraseña de Ubuntu (la que elegiste al instalar WSL).
  if tiene ffmpeg; then
    echo "  ✓ ffmpeg"
  else
    sudo apt-get update -qq
    sudo apt-get install -y -qq ffmpeg curl ca-certificates
  fi
  if tiene uv; then
    echo "  ✓ uv"
  else
    # El instalador oficial de uv: lo deja en ~/.local/bin.
    curl -LsSf https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"
    export PATH
  fi
  # Node no hace falta para procesar: solo para los tests y el deploy, que se hacen en la Mac.
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
COOKIES="${A_OJO_COOKIES_ARCHIVO:-$HOME/.a-ojo/cookies-instagram.txt}"
if [ -f "$COOKIES" ]; then
  echo "  ✓ cookies de Instagram exportadas en $COOKIES"
elif [ -z "${A_OJO_COOKIES_PERFIL:-}" ]; then
  echo "  ! Falta A_OJO_COOKIES_PERFIL: sin eso, los Reels de Instagram se procesan sin cookies (ver docs/perfil-instagram.md)."
else
  echo "  ✓ cookies de Instagram: ${A_OJO_COOKIES_NAVEGADOR:-chrome}, perfil «$A_OJO_COOKIES_PERFIL»."
  echo "    Exportalas una vez con: procesamiento/aojo fetch cookies"
fi

paso "Conexión con la API"
procesamiento/aojo api ping

printf '\nListo. Para procesar la bandeja, abrí Claude Code en esta carpeta y corré /recetas.\n'
