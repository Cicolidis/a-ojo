# A ojo — notas para Claude Code

La spec es `SPEC_v1.md`; el desarrollo avanza por las fases de su §9. Cada fase termina con una demo y un commit.

## Convenciones

- Todo el texto visible va en **castellano rioplatense** con voseo ("Guardá", "Probá de nuevo"). El código también usa nombres en castellano.
- **Nunca emojis en la interfaz**: íconos SVG de trazo. Los caracteres "✓" y "…" están permitidos, como indica la spec.
- **Ningún secreto en el repo**: probablemente sea público cuando se sume GitHub Pages. El token vive en Script Properties, `.env`, `chrome.storage.local` y el celular.
- Colores y tipografía: §8 de la spec (variante A). **Todo color va como token** en `:root` de `estilos.css` y también en el bloque del modo oscuro; si se usa un par nuevo de texto y fondo, sumarlo al test de contraste (`tests/app.test.js`).
- **Movimiento:** toda animación o transición va dentro de `@media (prefers-reduced-motion: no-preference)`; del lado de JS, se mira `menosMovimiento` (`app.js`).

## Apps Script (`apps-script/src`)

- Los archivos se evalúan por separado, en orden alfabético, en un mismo scope global. En el nivel superior, solo constantes literales; si una tabla referencia funciones de otros archivos, se arma dentro de una función (ver `rutas_()`).
- **No existe la clase `URL`**: por eso `Url.js` parsea con regex. `Url.js` también se exporta a Node para los tests.
- Las hojas se leen y escriben **por nombre de columna** (`Hojas.js`). Para sumar una columna: editar `Esquema.js` y volver a correr `setup()` en el editor.
- Las escrituras van dentro de `conLock_()`. Las fechas se guardan como texto ISO, en columnas con formato `@`.
- Acciones nuevas: una función en `Acciones.js`, registrada en `rutas_()` (`Api.js`), con su test en `tests/api.test.js`. Las que usa la app tienen que ser **idempotentes** (la cola offline reintenta) y, si editan una receta, actualizar su `actualizado` para que el delta llegue al otro celular.
- Una acción que escribe una columna nueva llama a `exigirColumnas_()`: si no, mientras nadie corra `setup()`, el dato se pierde en silencio.
- clasp siempre se corre con `npm run clasp -- …`, que usa la cuenta de `A_OJO_CLASP_USER` (Gmail personal; la sesión por defecto de clasp es otra cuenta).
- Deploy: `npm run deploy` (push + redeploy sobre `A_OJO_DEPLOYMENT_ID`). **Nunca crear un deployment nuevo**: cambiaría la URL `/exec`.
- Si un cambio usa un servicio de Google nuevo (Drive, Gmail…), después del push hay que correr `setup()` en el editor y aceptar el permiso **antes** del deploy. Si no, el web app deja de responder y se corta la captura.

## Procesamiento (`procesamiento/`, comando `/recetas`)

- Los scripts se corren con `procesamiento/aojo <fetch|transcribe|frames|api> …`, que usa el Python de `procesamiento/.venv` (lo crea `./setup.sh`). Solo biblioteca estándar más yt-dlp y faster-whisper.
- Cada script imprime **una línea de JSON** (`{"ok": false, "error", "motivo"}` si falla) y escribe en `~/.a-ojo/trabajo/<bandeja_id>/` y `~/.a-ojo/log/`. Ninguna ruta fija al usuario: todo sale de `Path.home()` o del `.env`.
- Los errores de yt-dlp se clasifican en `comun.py` (`login`, `privado`, `no_disponible`, `limite`, `red`, `cookies`) con un motivo en rioplatense que llega tal cual a la app.
- El audio se decodifica con ffmpeg, no con PyAV: las versiones nuevas de PyAV rompen la de faster-whisper.
- macOS no deja que Claude Code lea la carpeta de Chrome. Las cookies de Instagram se exportan desde la Terminal (`procesamiento/aojo fetch cookies`) a `~/.a-ojo/cookies-instagram.txt`, y `comun.args_cookies()` prefiere ese archivo.
- Las reglas para armar cada receta viven en `.claude/commands/recetas.md`; la validación definitiva la hace `receta.upsert` en la API.

## App (`app/`)

- PWA sin build: módulos ES servidos tal cual por GitHub Pages (`.github/workflows/pages.yml`). Nada de dependencias ni frameworks.
- El texto de las recetas viene de terceros: el DOM se arma con `h()` de `js/dom.js`, que usa `textContent`. **Nunca `innerHTML` con datos**, y solo links `http(s)` (`urlSegura`).
- Estados vacíos y de carga: `vacio()`, `cargando()` y `sinReceta()` de `vistas/controles.js`. Un botón que se saca o se deshabilita a sí mismo deja el foco en otro lado (o usa `aria-disabled`, como los −/+).
- La lógica pura va en `js/datos.js`, `js/formato.js`, `js/cocina.js`, `js/ingredientes.js`, `js/compras.js`, `js/bandeja.js`, `js/ediciones.js`, `js/config.js` y `js/rutas.js`, con sus tests en `tests/app.test.js`. Las vistas (`js/vistas/`) solo arman DOM; `rellenar()` de `dom.js` reemplaza contenido con las mismas reglas que `h()`.
- **Archivo nuevo en `app/` → sumarlo a `ARCHIVOS` en `sw.js`**: si no, no funciona sin conexión. El test de precache lo exige.
- El service worker no intercepta la API. `__VERSION__` en `sw.js` lo reemplaza el workflow por el commit; con el literal (desarrollo) la interfaz va primero a la red.
- Para probar: `npm run app` (API falsa con `tests/fixtures/todo.json`, token `prueba`). Con `--vacia` arranca sin datos (estados vacíos) y `/api-falsa/demorar?segundos=N` demora cada respuesta (primera carga); en `.claude/launch.json` están `app` y `app-vacia`. **No usar el token real en el navegador**: el link real lo genera Camilo con `npm run link-config`. La API falsa guarda las ediciones en memoria, y `/api-falsa/cortar?segundos=N` simula que no hay conexión.
- **Ediciones:** se arman con `ediciones.js` y pasan por `editar()` de `app.js`, que las aplica al instante y las deja en la cola (IndexedDB). `sincronizar` primero manda la cola y después pide `todo`. Una acción nueva necesita su caso en `aplicarEdicion()`, igual al de la API.
- Si la app empieza a usar columnas nuevas, subir `VERSION_DATOS` en `datos.js`: los snapshots viejos se piden enteros de nuevo.
- Los ingredientes se muestran por sección y rol con `rolDe()` / `seccionDe()` (`ingredientes.js`): lo editado por ellos gana sobre lo de `/recetas`.
- **Compras:** el lugar de cada ítem lo calcula `lugarDe()` (`compras.js`) con las reglas de la hoja `Lugares`; en la Sheet solo se guarda adonde lo movieron. Los ids de los ítems (`c_…`) los genera la app.
- **Capturas:** no van por la cola (pesan megas): se achican con `imagenes.js` y se mandan directo con un `lote` fijo por selección, así un reintento no las duplica. En Drive quedan privadas («A ojo/capturas»); `/recetas` las baja con `procesamiento/aojo api capturas <id>`.

## Tests

- `npm test`: tests de Node, sin dependencias. `tests/fakes/apps-script.js` simula SpreadsheetApp, DriveApp y los demás servicios, incluida la conversión de fechas ISO que hace Sheets cuando una celda no tiene formato de texto.
- `npm run test:py`: tests de `procesamiento/` (unittest, sin red: yt-dlp y el reloj se simulan).
- `npm run smoke`: prueba contra la API desplegada (necesita el `.env`).
