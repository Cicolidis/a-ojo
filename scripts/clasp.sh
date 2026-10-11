#!/bin/sh
# Corre clasp desde apps-script/ con la cuenta de Google de A ojo.
# Si .env define A_OJO_CLASP_USER, usa esas credenciales con nombre
# (clasp login --user <nombre>) y no toca la sesión por defecto de clasp.
# Uso: npm run clasp -- <comando de clasp> [opciones]
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
cd apps-script
if [ -n "${A_OJO_CLASP_USER:-}" ]; then
  exec npx clasp --user "$A_OJO_CLASP_USER" "$@"
else
  exec npx clasp "$@"
fi
