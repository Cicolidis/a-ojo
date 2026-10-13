#!/bin/sh
# Genera los íconos de la PWA (app/iconos/) y los de la extensión (extension/icons/)
# a partir de scripts/iconos/icono.html, con Chrome headless. Necesita conexión: la «a»
# usa Fraunces itálica de Google Fonts.
set -eu
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "No encontré Chrome en «$CHROME». Pasá la ruta en la variable CHROME." >&2; exit 1; }

FUENTE="file://$(pwd)/scripts/iconos/icono.html"
PERFIL="$(mktemp -d)"
trap 'rm -rf "$PERFIL"' EXIT
mkdir -p app/iconos extension/icons

generar() { # generar <archivo> <tamaño> <tipo>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$PERFIL" --default-background-color=00000000 --virtual-time-budget=8000 \
    --window-size="$2,$2" --screenshot="$(pwd)/$1" "$FUENTE?tam=$2&tipo=$3" >/dev/null 2>&1
  echo "  ✓ $1"
}

echo "Generando íconos de la app"
generar app/iconos/icono-512.png 512 any
generar app/iconos/icono-192.png 192 any
generar app/iconos/maskable-512.png 512 maskable
generar app/iconos/favicon-32.png 32 favicon

echo "Generando íconos de la extensión"
generar extension/icons/128.png 128 any
generar extension/icons/48.png 48 chico
generar extension/icons/32.png 32 favicon
generar extension/icons/16.png 16 favicon
