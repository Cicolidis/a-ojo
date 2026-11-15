#!/bin/sh
# Prueba de punta a punta contra la API desplegada.
# Lee A_OJO_API_URL y A_OJO_TOKEN del .env. El token nunca se imprime.
# Deja una fila de prueba (example.com) en estado "descartada".
set -u
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${A_OJO_API_URL:?Falta A_OJO_API_URL en .env}"
: "${A_OJO_TOKEN:?Falta A_OJO_TOKEN en .env}"

FALLAS=0
SELLO=$(date +%s)
URL_PRUEBA="https://example.com/a-ojo-prueba/$SELLO"

# El POST a /exec responde 302; curl -L sigue la redirección con GET, como corresponde.
api_get() { curl -sSL --max-time 60 "$A_OJO_API_URL?$1"; }
api_post() { curl -sSL --max-time 60 -H 'Content-Type: text/plain;charset=utf-8' --data "$1" "$A_OJO_API_URL"; }

# campo <ruta.al.valor>: lee JSON de stdin e imprime ese valor ("" si no existe).
campo() {
  node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      let v;
      try { v = process.argv[1].split(".").reduce((a, k) => (a == null ? a : a[k]), JSON.parse(s)); }
      catch (e) { v = "NO_JSON: " + s.slice(0, 80).replace(/\s+/g, " "); }
      console.log(v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : v);
    });' "$1"
}

revisar() { # revisar <descripción> <obtenido> <esperado>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 (esperaba «$3», vino «$2»)"; FALLAS=$((FALLAS + 1)); fi
}

echo "Prueba de humo contra la API"

R=$(api_get "action=ping")
revisar "ping sin token → 401" "$(echo "$R" | campo status)" "401"

R=$(api_get "action=ping&t=$A_OJO_TOKEN")
revisar "ping con token" "$(echo "$R" | campo ok)" "true"
revisar "no faltan hojas" "$(echo "$R" | campo data.hojas_faltantes)" "[]"
VERSION=$(sed -n "s/^const VERSION_API = '\(.*\)';/\1/p" apps-script/src/Api.js)
revisar "versión de la API (la de Api.js)" "$(echo "$R" | campo data.version)" "$VERSION"

R=$(api_post "{\"action\":\"capturar\",\"t\":\"$A_OJO_TOKEN\",\"url\":\"$URL_PRUEBA?utm_source=prueba\",\"quien\":\"camilo\"}")
ID=$(echo "$R" | campo data.id)
revisar "capturar crea una fila" "$(echo "$R" | campo data.estado)" "pendiente"

R=$(api_post "{\"action\":\"capturar\",\"t\":\"$A_OJO_TOKEN\",\"url\":\"https://www.example.com/a-ojo-prueba/$SELLO/?utm_medium=otra\",\"quien\":\"camilo\"}")
revisar "la misma URL con otro tracking es duplicada" "$(echo "$R" | campo data.duplicada)" "true"
revisar "…y devuelve el mismo id" "$(echo "$R" | campo data.id)" "$ID"

R=$(api_get "action=bandeja.pendientes&t=$A_OJO_TOKEN")
revisar "aparece en bandeja.pendientes" "$(echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.data.filas.some(f=>f.id===process.argv[1]))})' "$ID")" "true"

R=$(api_get "action=todo&t=$A_OJO_TOKEN")
AHORA=$(echo "$R" | campo data.ahora)
revisar "todo responde completo" "$(echo "$R" | campo data.completo)" "true"
LUGARES=$(echo "$R" | campo data.lugares.length)
revisar "todo trae los lugares (corré setup() si no)" "$([ "${LUGARES:-0}" -gt 0 ] 2>/dev/null && echo si || echo no)" "si"

R=$(api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"procesando\"}")
revisar "bandeja.actualizar suma un intento" "$(echo "$R" | campo data.intentos)" "1"

R=$(api_get "action=todo&t=$A_OJO_TOKEN&since=$AHORA")
revisar "todo?since trae solo lo cambiado" "$(echo "$R" | campo data.bandeja.length)" "1"

R=$(api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"descartada\"}")
revisar "se descarta la fila de prueba" "$(echo "$R" | campo data.estado)" "descartada"

# Fase 6: todo sobre la fila de prueba, sin tocar las de verdad.
R=$(api_get "action=bandeja.fila&t=$A_OJO_TOKEN&id=$ID")
revisar "bandeja.fila la lee sola" "$(echo "$R" | campo data.fila.estado)" "descartada"
R=$(api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"pendiente\",\"desde\":\"ayuda\"}")
revisar "con desde viejo: 409 y no la toca" "$(echo "$R" | campo error)" "estado_cambio"
R=$(api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"descartada\",\"desde\":\"ayuda\"}")
revisar "con desde, si ya está así: ok (reintento)" "$(echo "$R" | campo ok)" "true"
R=$(api_post "{\"action\":\"bandeja.tomar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\"}")
revisar "bandeja.tomar con id la reserva" "$(echo "$R" | campo data.filas.0.estado)" "procesando"
R=$(api_post "{\"action\":\"bandeja.tomar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\"}")
revisar "…y otra corrida no la puede tomar" "$(echo "$R" | campo error)" "procesando"
R=$(api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"descartada\"}")
revisar "la fila de prueba vuelve a descartada" "$(echo "$R" | campo data.estado)" "descartada"

# Como HTTP Shortcuts: form-urlencoded y respuesta en texto plano.
R=$(curl -sSL --max-time 60 --data-urlencode "url=Mirá esto $URL_PRUEBA" --data-urlencode "quien=pareja" \
  --data-urlencode "t=$A_OJO_TOKEN" "$A_OJO_API_URL?action=capturar&formato=texto")
revisar "form-urlencoded + formato=texto" "$R" "Ya estaba guardada"

api_post "{\"action\":\"bandeja.actualizar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"$ID\",\"estado\":\"descartada\"}" > /dev/null

# receta.upsert con validar: true no escribe nada en la Sheet.
RECETA="{\"titulo\":\"Prueba\",\"tipo\":\"dulce\",\"confianza\":\"alta\",\"origen_datos\":\"descripcion\",\
\"idioma_original\":\"es\",\"fuente_url\":\"$URL_PRUEBA\",\"ingredientes\":[{\"cantidad\":100,\"unidad\":\"g\",\
\"nombre\":\"harina 0000\",\"gondola\":\"almacén\",\"rol\":\"principal\"}],\"pasos\":[{\"texto\":\"Mezclá.\"}]}"
R=$(api_post "{\"action\":\"receta.upsert\",\"t\":\"$A_OJO_TOKEN\",\"validar\":true,\"bandeja_id\":\"$ID\",\"receta\":$RECETA}")
revisar "receta.upsert valida sin escribir" "$(echo "$R" | campo data.validar)" "true"
R=$(api_post "{\"action\":\"receta.upsert\",\"t\":\"$A_OJO_TOKEN\",\"validar\":true,\"receta\":{\"titulo\":\"\"}}")
revisar "receta.upsert rechaza una receta inválida" "$(echo "$R" | campo error)" "receta_invalida"

# Las acciones de la app existen y validan, sin escribir nada: la receta no existe.
for CUERPO in '"action":"receta.estado","estado":"probada"' '"action":"receta.porciones","porciones":4' \
  '"action":"receta.ingredientes","ingredientes":[{"id":"i_nada0","rol":"principal"}]' \
  '"action":"receta.clasificar","ingredientes":[{"id":"i_nada0","rol":"principal"}]'; do
  R=$(api_post "{$CUERPO,\"t\":\"$A_OJO_TOKEN\",\"id\":\"r_nada0\"}")
  revisar "$(echo "$CUERPO" | cut -d'"' -f4) responde no_encontrada" "$(echo "$R" | campo error)" "no_encontrada"
done
R=$(api_post "{\"action\":\"nota.agregar\",\"t\":\"$A_OJO_TOKEN\",\"receta_id\":\"r_nada0\",\"quien\":\"camilo\",\"texto\":\"x\"}")
revisar "nota.agregar responde no_encontrada" "$(echo "$R" | campo error)" "no_encontrada"

# Compras: un ítem de prueba que se agrega y se quita enseguida.
COMPRA="c_humo$(echo "$SELLO" | tail -c 7)"
R=$(api_post "{\"action\":\"compras.agregar\",\"t\":\"$A_OJO_TOKEN\",\"items\":[{\"id\":\"$COMPRA\",\"nombre\":\"Prueba de humo\"}]}")
revisar "compras.agregar suma un ítem" "$(echo "$R" | campo data.nuevos)" "1"
R=$(api_post "{\"action\":\"compras.quitar\",\"t\":\"$A_OJO_TOKEN\",\"ids\":[\"$COMPRA\"]}")
revisar "compras.quitar lo saca" "$(echo "$R" | campo data.quitados)" "1"
# Despensa (Fase 9): una fila de prueba que se suma y se quita enseguida.
DESPENSA="d_humo$(echo "$SELLO" | tail -c 7)"
R=$(api_post "{\"action\":\"despensa.sumar\",\"t\":\"$A_OJO_TOKEN\",\"quien\":\"camilo\",\"items\":[{\"id\":\"$DESPENSA\",\"nombre\":\"Prueba de humo $SELLO\"}]}")
revisar "despensa.sumar suma una fila (corré setup() si no)" "$(echo "$R" | campo data.nuevos)" "1"
R=$(api_post "{\"action\":\"despensa.quitar\",\"t\":\"$A_OJO_TOKEN\",\"ids\":[\"$DESPENSA\"]}")
revisar "despensa.quitar la saca" "$(echo "$R" | campo data.quitados)" "1"
# Recetas propias (Fase 10a): existen y validan, sin crear nada (no hay cómo borrar una receta).
R=$(api_post "{\"action\":\"receta.crear\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"r_nada0\",\"titulo\":\"\",\"tipo\":\"salado\"}")
revisar "receta.crear valida" "$(echo "$R" | campo error)" "receta_invalida"
R=$(api_post "{\"action\":\"receta.editar\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"r_nada0\",\"titulo\":\"x\"}")
revisar "receta.editar responde no_encontrada" "$(echo "$R" | campo error)" "no_encontrada"
# Mira la columna Bandeja.texto antes de buscar la receta: con falta_columna, falta correr setup().
R=$(api_post "{\"action\":\"receta.escribir\",\"t\":\"$A_OJO_TOKEN\",\"id\":\"r_nada0\",\"texto\":\"x\",\"bandeja_id\":\"b_nada0\"}")
revisar "receta.escribir responde no_encontrada (corré setup() si dice falta_columna)" "$(echo "$R" | campo error)" "no_encontrada"
R=$(api_post "{\"action\":\"lugares.asignar\",\"t\":\"$A_OJO_TOKEN\",\"por\":\"nada\",\"clave\":\"x\",\"lugar\":\"feria\"}")
revisar "lugares.asignar valida" "$(echo "$R" | campo error)" "por_invalido"

# Capturas: la fila de prueba no tiene; subir con un lote inválido no escribe nada.
R=$(api_get "action=capturas.bajar&t=$A_OJO_TOKEN&bandeja_id=$ID")
revisar "capturas.bajar sin capturas" "$(echo "$R" | campo data.imagenes.length)" "0"
R=$(api_post "{\"action\":\"capturas.subir\",\"t\":\"$A_OJO_TOKEN\",\"bandeja_id\":\"$ID\",\"lote\":\"x\",\"imagenes\":[]}")
revisar "capturas.subir valida" "$(echo "$R" | campo error)" "lote_invalido"

echo
if [ "$FALLAS" -eq 0 ]; then echo "Todo bien."; else echo "$FALLAS verificaciones fallaron."; exit 1; fi
