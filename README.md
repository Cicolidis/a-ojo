# A ojo

App personal de recetas para dos personas. Captura links de YouTube e Instagram, los convierte en recetas estructuradas y los muestra en una PWA. La spec completa está en [`SPEC_v1.md`](SPEC_v1.md).

**Estado: Fase 1 (datos y captura).** Sheet + API de Apps Script + extensión de Chrome + atajo de Android.

```
apps-script/src/   API (doGet/doPost), setup() y normalización de links
extension/         extensión de Chrome MV3 (botón, menú contextual, ⌥⇧R)
docs/              guía de HTTP Shortcuts para Android
scripts/           deploy y prueba de humo
tests/             tests en Node (sin dependencias; Apps Script simulado en memoria)
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

### 6. Extensión de Chrome

1. Abrí `chrome://extensions` y activá el **Modo de desarrollador**.
2. **Cargar descomprimida** → carpeta `extension/`.
3. Se abren las opciones: pegá la URL `/exec` y el token, elegí quién sos y tocá **Probar conexión**.

Para guardar: el botón de la barra, clic derecho sobre un link → **Guardar en A ojo**, o <kbd>⌥</kbd><kbd>⇧</kbd><kbd>R</kbd>. La insignia muestra "✓" verde si se guardó, "✓" ámbar si ya estaba y "!" roja si falló (el detalle aparece al pasar el mouse).

### 7. Android

Seguí [`docs/android-http-shortcuts.md`](docs/android-http-shortcuts.md).

## API

Todas las llamadas llevan `action` y el token `t`, en la query o en el cuerpo. Los `POST` mandan JSON como `text/plain` (sin preflight de CORS) o form-urlencoded. Respuesta: `{ ok, data }` o `{ ok: false, error, mensaje, status }`. Apps Script no permite códigos HTTP propios, así que el 401 y los demás viajan en `status`.

| Método | `action` | Entrada | Salida (`data`) |
|---|---|---|---|
| GET/POST | `ping` | — | `{ version, ahora, hojas_faltantes }` |
| POST | `capturar` | `{ url, quien }`; `url` puede ser un texto con un link adentro | `{ id, estado }` o `{ duplicada: true, id, estado }`. Con `formato=texto`: solo el mensaje |
| GET | `todo` | `since?` (ISO) | `{ ahora, completo, recetas, ingredientes, pasos, notas, compras, bandeja }`. Usá `ahora` como próximo `since`; `compras` va siempre completa |
| GET | `bandeja.pendientes` | — | `{ filas }`, de la más vieja a la más nueva |
| POST | `bandeja.actualizar` | `{ id, estado, motivo?, receta_id? }` | `{ id, estado, intentos }`. Pasar a `procesando` suma un intento |

**Deduplicación:** los links se normalizan (sin `?si=`, `igsh`, `utm_*`, etc.) y se comparan por ID de video o de post. Un Short, su `youtu.be` y su `watch?v=` son el mismo; también un `/reel/` y un `/p/` con el mismo código. Si se vuelve a guardar un link `descartado`, pasa otra vez a `pendiente`.
