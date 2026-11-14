#!/bin/sh
# Sube el código de Apps Script y redeploya el web app sobre el MISMO deployment,
# así la URL /exec no cambia (la extensión y el celular dependen de ella).
# Uso: npm run deploy -- "descripción opcional"
#
# Antes corre los tests (si uno falla, no sube nada). Después prueba la API con
# un ping: si no responde, lo más probable es que la versión nueva use un permiso
# de Google que todavía no se aceptó (setup() en el editor).
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${A_OJO_DEPLOYMENT_ID:-}" ]; then
  echo "Falta A_OJO_DEPLOYMENT_ID en .env. El primer deploy se hace a mano (ver README)." >&2
  exit 1
fi

echo "→ Tests"
SALIDA_TESTS=$(mktemp)
if ! npm test >"$SALIDA_TESTS" 2>&1; then
  grep -E '^not ok|^# (pass|fail)' "$SALIDA_TESTS" >&2 || cat "$SALIDA_TESTS" >&2
  rm -f "$SALIDA_TESTS"
  echo "Hay tests que fallan: no subí nada." >&2
  exit 1
fi
grep -E '^# pass' "$SALIDA_TESTS" | sed 's/^# /  ✓ /'
rm -f "$SALIDA_TESTS"

echo "→ Push y deploy"
sh scripts/clasp.sh push --force
sh scripts/clasp.sh update-deployment "$A_OJO_DEPLOYMENT_ID" --description "${1:-deploy $(date '+%Y-%m-%d %H:%M')}"

echo "→ Ping a la API desplegada"
VERSION=$(sed -n "s/^const VERSION_API = '\(.*\)';/\1/p" apps-script/src/Api.js)
for intento in 1 2 3; do
  if RESPUESTA=$(procesamiento/aojo api ping 2>&1); then
    case "$RESPUESTA" in
      *"\"version\": \"$VERSION\""*)
        echo "  ✓ La API responde, versión $VERSION."
        exit 0 ;;
    esac
  fi
  [ "$intento" -lt 3 ] && sleep 5
done
echo "  La API desplegada no respondió bien al ping (se esperaba la versión $VERSION):" >&2
echo "  $RESPUESTA" >&2
echo "  Puede faltar aceptar un permiso nuevo: abrí el editor de Apps Script (npm run clasp -- open-script)," >&2
echo "  corré setup() y aceptá el permiso. Mientras tanto, la captura y la app no funcionan." >&2
exit 1
