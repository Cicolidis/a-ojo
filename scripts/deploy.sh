#!/bin/sh
# Sube el código de Apps Script y redeploya el web app sobre el MISMO deployment,
# así la URL /exec no cambia (la extensión y el celular dependen de ella).
# Uso: npm run deploy -- "descripción opcional"
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${A_OJO_DEPLOYMENT_ID:-}" ]; then
  echo "Falta A_OJO_DEPLOYMENT_ID en .env. El primer deploy se hace a mano (ver README)." >&2
  exit 1
fi

sh scripts/clasp.sh push --force
sh scripts/clasp.sh update-deployment "$A_OJO_DEPLOYMENT_ID" --description "${1:-deploy $(date '+%Y-%m-%d %H:%M')}"
