#!/bin/sh
# Genera los íconos de la PWA (app/iconos/) a partir de scripts/iconos/icono.html,
# con Chrome headless. Necesita conexión: la «a» usa Fraunces itálica de Google Fonts.
set -eu
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "No encontré Chrome en «$CHROME». Pasá la ruta en la variable CHROME." >&2; exit 1; }

FUENTE="file://$(pwd)/scripts/iconos/icono.html"
SALIDA="$(pwd)/app/iconos"
PERFIL="$(mktemp -d)"
trap 'rm -rf "$PERFIL"' EXIT
mkdir -p "$SALIDA"

generar() { # generar <archivo> <tamaño> <tipo>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$PERFIL" --default-background-color=00000000 --virtual-time-budget=8000 \
    --window-size="$2,$2" --screenshot="$SALIDA/$1" "$FUENTE?tam=$2&tipo=$3" >/dev/null 2>&1
  echo "  ✓ app/iconos/$1"
}

echo "Generando íconos"
generar icono-512.png 512 any
generar icono-192.png 192 any
generar maskable-512.png 512 maskable
generar favicon-32.png 32 favicon
