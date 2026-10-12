#!/bin/sh
# Imprime el link de configuración de la app para una persona:
#   npm run link-config -- pareja
# Lee A_OJO_APP_URL, A_OJO_API_URL y A_OJO_TOKEN del .env. El link lleva el
# token: mandalo solo por privado. Va en el fragmento (#), así no llega a GitHub.
set -eu
cd "$(dirname "$0")/.."

QUIEN="${1:-}"
case "$QUIEN" in
  camilo|pareja) ;;
  *) echo "Uso: npm run link-config -- <camilo|pareja>" >&2; exit 1 ;;
esac

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${A_OJO_APP_URL:?Falta A_OJO_APP_URL en .env (la URL de GitHub Pages)}"
: "${A_OJO_API_URL:?Falta A_OJO_API_URL en .env}"
: "${A_OJO_TOKEN:?Falta A_OJO_TOKEN en .env}"

LINK=$(node -e '
  const [app, api, t, quien] = process.argv.slice(1);
  const q = new URLSearchParams({ api, t, quien }).toString();
  console.log(app.replace(/#.*$/, "").replace(/\/?$/, "/") + "#/config?" + q);
' "$A_OJO_APP_URL" "$A_OJO_API_URL" "$A_OJO_TOKEN" "$QUIEN")

echo "Link de configuración para $QUIEN (incluye el token: mandalo solo por privado):"
echo
echo "$LINK"
