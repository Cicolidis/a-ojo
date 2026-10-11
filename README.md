# A ojo

App personal de recetas para dos personas. Captura links de YouTube e Instagram, los convierte en recetas estructuradas y los muestra en una PWA. La spec completa está en [`SPEC_v1.md`](SPEC_v1.md).

**Estado: Fase 2 (procesamiento).** Sheet + API de Apps Script + extensión de Chrome + atajo de Android + el comando `/recetas`, que convierte los links de la bandeja en recetas.

```
apps-script/src/            API (doGet/doPost), setup(), normalización de links y fotos en Drive
extension/                  extensión de Chrome MV3 (botón, menú contextual, ⌥⇧R)
procesamiento/              scripts de Python que usa /recetas (descargas, Whisper, fotogramas, API)
.claude/commands/recetas.md el comando /recetas: flujo y reglas para armar cada receta
docs/                       guías de HTTP Shortcuts (Android) y del perfil de Instagram
scripts/                    deploy y prueba de humo
tests/                      tests en Node (sin dependencias; Apps Script simulado en memoria)
```

## Requisitos

- Node 20 o más nuevo.
- Una cuenta de Gmail personal: las cuentas de Workspace suelen bloquear los web apps anónimos.
- Chrome.

```bash
npm install
```

```bash
npm test
```

```bash
npm run test:py
```

(`test:py` necesita el entorno de Python de `./setup.sh`; ver [Procesamiento](#procesamiento-recetas).)

## Puesta en marcha (una sola vez)

Todo lo de clasp pasa por `npm run clasp -- …`, que usa la cuenta indicada en `A_OJO_CLASP_USER` del `.env` (por defecto, `personal`). Así, la cuenta de A ojo convive con cualquier otra sesión de clasp que ya tengas.

### 1. Conectar clasp a tu Gmail personal

1. Copiá `.env.example` como `.env`.
2. Entrá con el Gmail personal y activá la API de Apps Script en <https://script.google.com/home/usersettings>.
3. Iniciá sesión con ese Gmail (se abre el navegador):

```bash
npx clasp login --user personal
```

### 2. Crear la Sheet y el script ligado

Este comando crea la planilla "A ojo — datos" en tu Drive, con el proyecto de Apps Script ligado, y deja `apps-script/.clasp.json`:

```bash
npm run clasp -- create-script --type sheets --title "A ojo — datos" --rootDir src
```

Si el comando pisó `src/appsscript.json`, recuperalo con `git checkout apps-script/src/appsscript.json`. Después subí el código:

```bash
npm run push
```

### 3. Correr `setup()`

1. Abrí el editor con `npm run clasp -- open-script`.
2. Elegí la función `setup` y tocá **Ejecutar**.
3. Google avisa que la app no está verificada: **Configuración avanzada → Ir a A ojo (no seguro) → Permitir**. Es tu propio script.
4. En el registro de ejecución aparece el **token**. Copialo al `.env` (partí de `.env.example`).

`setup()` se puede correr de nuevo cuando quieras: solo agrega lo que falte. `verToken()` muestra el token y `rotarToken()` genera uno nuevo.

### 4. Publicar el web app

El primer deploy crea el web app (ejecuta como vos, con acceso para cualquiera):

```bash
npm run clasp -- create-deployment --description "Fase 1"
```

Guardá el ID que devuelve en `.env` como `A_OJO_DEPLOYMENT_ID`. La URL es `https://script.google.com/macros/s/<ID>/exec` y va en `A_OJO_API_URL`.

**A partir de ahí, siempre:**

```bash
npm run deploy
```

Redeploya sobre el mismo ID, así la URL no cambia nunca. Si creás otro deployment, cambia la URL y hay que reconfigurar la extensión y el celular.

### 5. Probar la API

```bash
npm run smoke
```

Deja una fila de prueba de `example.com` en estado `descartada`; se puede borrar a mano.

**Si una versión nueva usa un servicio de Google que antes no usaba** (como Drive en la Fase 2), antes del deploy hay que correr `setup()` en el editor y aceptar el permiso nuevo. Si no, el web app deja de responder hasta que alguien lo acepte.

### 6. Extensión de Chrome

1. Abrí `chrome://extensions` y activá el **Modo de desarrollador**.
2. **Cargar descomprimida** → carpeta `extension/`.
3. Se abren las opciones: pegá la URL `/exec` y el token, elegí quién sos y tocá **Probar conexión**.

Para guardar: el botón de la barra, clic derecho sobre un link → **Guardar en A ojo**, o <kbd>⌥</kbd><kbd>⇧</kbd><kbd>R</kbd>. La insignia muestra "✓" verde si se guardó, "✓" ámbar si ya estaba y "!" roja si falló (el detalle aparece al pasar el mouse).

### 7. Android

Seguí [`docs/android-http-shortcuts.md`](docs/android-http-shortcuts.md).

## Procesamiento: `/recetas`

Corre a mano, en la Mac donde esté el repo (la Mac Mini o la computadora de ella). Los scripts de `procesamiento/` bajan y transcriben; Claude Code lee lo que haga falta y arma la receta.

### Preparar la computadora (una sola vez)

```bash
./setup.sh
```

Instala ffmpeg, uv y Node con Homebrew si faltan, crea `procesamiento/.venv` con yt-dlp y faster-whisper, baja el modelo `small` de Whisper (unos 500 MB) y prueba la conexión con la API. Se puede volver a correr para actualizar.

Para los Reels de Instagram hace falta un perfil de navegador con la cuenta secundaria y exportar sus cookies una vez desde la Terminal (`procesamiento/aojo fetch cookies`): seguí [`docs/perfil-instagram.md`](docs/perfil-instagram.md).

### Procesar

Abrí Claude Code en la carpeta del repo y corré:

| Comando | Qué hace |
|---|---|
| `/recetas` | procesa hasta 10 links pendientes, del más viejo al más nuevo |
| `/recetas 3` | procesa hasta 3 |
| `/recetas b_e3cgj` | procesa (o reprocesa) esa fila de la bandeja |
| `/recetas --dry-run` | hace todo menos escribir en la Sheet: la receta solo se valida |
| `/recetas <id> --dry-run --sin-cookies` | prueba un Reel sin la cuenta secundaria |

Por cada link va sumando capas solo mientras falten datos: metadatos y caption, subtítulos (YouTube), la receta de la web que nombre la descripción, el audio con Whisper y, por último, mosaicos de fotogramas para leer el texto sobreimpreso. La receta queda en `lista`, con su foto copiada a Drive (carpeta "A ojo/fotos"). Si no se puede, la fila pasa a `ayuda` con un motivo.

- Archivos de trabajo: `~/.a-ojo/trabajo/<id de la bandeja>/`. Se pueden borrar cuando quieras.
- Log: `~/.a-ojo/log/AAAA-MM-DD.log`.
- Entre pedidos a YouTube o Instagram hay una pausa de 2 a 5 segundos. Ante un HTTP 429 reintenta después de 30, 60 y 120 segundos; si sigue, corta la corrida.
- Reprocesar un link actualiza la misma receta: conserva su estado, la valoración y las notas.

Los scripts también se pueden correr a mano, por ejemplo `procesamiento/aojo fetch meta b_e3cgj https://www.youtube.com/shorts/a2qRJHVeJwk` o `procesamiento/aojo api pendientes`.

## API

Todas las llamadas llevan `action` y el token `t`, en la query o en el cuerpo. Los `POST` mandan JSON como `text/plain` (sin preflight de CORS) o form-urlencoded. Respuesta: `{ ok, data }` o `{ ok: false, error, mensaje, status }`. Apps Script no permite códigos HTTP propios, así que el 401 y los demás viajan en `status`.

| Método | `action` | Entrada | Salida (`data`) |
|---|---|---|---|
| GET/POST | `ping` | — | `{ version, ahora, hojas_faltantes }` |
| POST | `capturar` | `{ url, quien }`; `url` puede ser un texto con un link adentro | `{ id, estado }` o `{ duplicada: true, id, estado }`. Con `formato=texto`: solo el mensaje |
| GET | `todo` | `since?` (ISO) | `{ ahora, completo, recetas, ingredientes, pasos, notas, compras, bandeja }`. Usá `ahora` como próximo `since`; `compras` va siempre completa |
| GET | `bandeja.pendientes` | — | `{ filas }`, de la más vieja a la más nueva. Incluye las `procesando` sin cambios hace más de 30 minutos (una corrida que se cortó) |
| POST | `bandeja.actualizar` | `{ id, estado, motivo?, receta_id? }` | `{ id, estado, intentos }`. Pasar a `procesando` suma un intento |
| POST | `receta.upsert` | `{ receta, bandeja_id?, foto?, validar? }` | `{ id, nueva, foto_url, ingredientes, pasos }`. Ver abajo |

**`receta.upsert`:** `receta` trae los campos de la hoja Recetas más `ingredientes: [{ cantidad, unidad, nombre, nota, gondola }]` y `pasos: [{ texto, timer_min, tip }]` (el formato completo está en [`.claude/commands/recetas.md`](.claude/commands/recetas.md)). Busca la receta por `id`, después por el `receta_id` de la fila de la bandeja y por último por `fuente_url`, así que reprocesar no duplica: actualiza los campos, conserva `estado`, `valoracion`, `creado` y las notas, y **reemplaza todos** los ingredientes y pasos. Con `bandeja_id`, esa fila pasa a `lista`. `foto: { base64, mime }` (jpeg, png o webp, hasta 5 MB) se guarda en Drive, pública con link. Con `validar: true` solo valida. Si hay errores, responde `receta_invalida` con la lista en `detalles`.

**Para la PWA (Fase 3):** en un delta de `todo?since=…`, si una receta cambió vienen **todos** sus ingredientes y pasos; reemplazan a los que había guardados de esa receta.

**Deduplicación:** los links se normalizan (sin `?si=`, `igsh`, `utm_*`, etc.) y se comparan por ID de video o de post. Un Short, su `youtu.be` y su `watch?v=` son el mismo; también un `/reel/` y un `/p/` con el mismo código. Si se vuelve a guardar un link `descartado`, pasa otra vez a `pendiente`.
