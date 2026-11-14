# A ojo — Spec v1

> App personal de recetas para dos personas (Camilo y Laura). Captura links de YouTube e Instagram, los convierte en recetas estructuradas en rioplatense y los muestra en una app instalable, cálida y editorial.
> Documento para llevar a Claude Code. Versión 1 · 27/09/2026.

---

## 1. Objetivo y alcance

**Problema:** vemos recetas en videos, las guardamos y nunca las cocinamos. La fricción está en tres puntos: retener el link, pasar la receta a algo usable y encontrarla después.

**Objetivo del MVP:** que guardar sea de 1 a 3 toques, que la receta aparezca sola y completa, y que cocinarla o comprar los ingredientes sea fácil.

### Entra en el MVP
- Captura: extensión de Chrome (Mac) y HTTP Shortcuts (Android).
- Bandeja en Google Sheets.
- Procesamiento en la Mac con el comando `/recetas` de Claude Code.
- App PWA con 5 pantallas: Biblioteca, Ficha, Modo cocina, Lista de compras y Bandeja.
- Estados de receta (para probar / probada / favorita), valoración, notas con fecha.
- Lista de compras consolidada por lugar (supermercado, verdulería…), exportable a WhatsApp.

### Queda para después (v2+)
- Plan semanal.
- "¿Qué cocino hoy?" a partir de lo que hay en casa.
- Escalado inteligente de porciones con conversión de unidades (en v1 solo se multiplican las cantidades numéricas).
- Exportación de recetas a Obsidian.
- Procesamiento automático programado. **Decisión: en v1 el procesamiento se corre siempre a mano.**

### Restricciones
- **Costo: $0.** Solo servicios gratuitos, más la suscripción a Claude que ya existe.
- La Mac Mini **no** está siempre prendida. La captura y la lectura no pueden depender de ella; solo el procesamiento.
- Contenido mayormente en **castellano rioplatense**, oral y escrito.
- Dos usuarios, sin intención comercial por ahora.

---

## 2. Arquitectura

```
[Android: Instagram] --Compartir--> [HTTP Shortcuts] --POST--\
                                                              >--> [Apps Script API] --> [Google Sheet]
[Mac: Chrome] --botón--> [Extensión Chrome] -----------POST--/              ^
                                                                            |
[Mac: Claude Code /recetas] --lee bandeja / escribe recetas (API) ----------+
        |  yt-dlp · Whisper · ffmpeg · web fetch · Claude
        v
[Drive: carpeta "A ojo/fotos"]  (miniaturas)

[PWA en GitHub Pages] <--GET/POST JSON--> [Apps Script API]
   (cache local en IndexedDB, funciona offline)
```

| Componente | Tecnología | Dónde vive |
|---|---|---|
| Base de datos | Google Sheets | Drive de Camilo, compartida con Laura |
| API | Apps Script, web app (`doGet`/`doPost`) que devuelve JSON | Proyecto ligado a la Sheet |
| App | PWA: HTML, CSS y JS, sin framework pesado (vanilla o Preact) | GitHub Pages |
| Captura Mac | Extensión de Chrome MV3 (desempaquetada) | Chrome de Camilo |
| Captura Android | HTTP Shortcuts (Play Store / F-Droid) | Celular de Laura |
| Procesamiento | Python + `yt-dlp` + `faster-whisper` + `ffmpeg` + Claude Code | Mac Mini M4 |
| Fotos | Miniaturas copiadas a Drive (URL pública) o al repo | Drive |

**Principio clave:** la Sheet es la fuente de verdad. La PWA descarga todo al abrir, lo guarda localmente y sincroniza los cambios en segundo plano. Por eso la lentitud de Apps Script (1 a 3 segundos por llamada) no se nota en el uso.

---

## 3. Modelo de datos (Google Sheet "A ojo — datos")

Todas las hojas llevan `id` como primera columna: texto corto único (ej.: `r_7f3k2`).

### `Bandeja`
| Columna | Tipo | Notas |
|---|---|---|
| id | texto | |
| creado | fecha-hora ISO | |
| url | texto | URL normalizada, sin `?si=`, `?stkn=` ni otros parámetros de tracking |
| plataforma | `youtube` · `instagram` · `web` · `otro` | se detecta sola |
| quien | `camilo` · `pareja` | según el origen: extensión o HTTP Shortcuts. `pareja` es el valor interno de Laura: en la interfaz y en los textos siempre se la nombra «Laura» |
| estado | `pendiente` · `procesando` · `lista` · `ayuda` · `descartada` | |
| motivo | texto | solo si `estado = ayuda` (ej.: "Instagram pide login") |
| receta_id | texto | se completa cuando está `lista` |
| intentos | número | |
| actualizado | fecha-hora ISO | |
| capturas | texto | ids de Drive de las capturas que subieron desde la app (capa 6), separados por coma. Cuando la fila queda `lista`, van a la papelera de Drive (30 días) y la columna se vacía |
| pedido | texto | «Algo está mal en esta receta»: lo que pidieron corregir desde la ficha (`receta.corregir`), una línea por pedido. `/recetas` lo lee como instrucción; se vacía cuando la fila vuelve a quedar `lista`. Cada pedido es una línea (los saltos de línea del texto se juntan). Cancelarlo deja la fila en `lista` con `intentos` en 0: así la Bandeja sabe que no la procesó la Mac (no cuenta como «Recién llegada» ni como su última corrida) |

**Deduplicación:** si la URL normalizada ya existe, no se crea una fila nueva y la API responde `duplicada`.

### `Recetas`
| Columna | Tipo | Notas |
|---|---|---|
| id | texto | |
| titulo | texto | en rioplatense, corto y claro |
| tipo | `dulce` · `salado` · `sopa` · `bebida` · `otro` | |
| etiquetas | texto separado por comas | libres: `rápida`, `freezable`, `vegetariana`, `para invitados`… |
| estado | `para_probar` · `probada` · `favorita` · `descartada` | por defecto `para_probar` |
| valoracion | 0–5 | 0 = sin valorar |
| porciones | número | base para escalar |
| tiempo_min | número | estimado |
| molde | texto | opcional (ej.: "20×30 cm") |
| autor | texto | cuenta o persona |
| fuente_url | texto | |
| plataforma | texto | |
| foto_url | texto | copia propia, no el link original de Instagram (vence) |
| confianza | `alta` · `media` · `baja` | ver §5.4 |
| origen_datos | texto | capas usadas: `descripcion,subtitulos,audio,web,frames,capturas` |
| idioma_original | `es` · `en` · … | si no es `es`, la receta se tradujo |
| creado · actualizado | fecha-hora ISO | |
| notas_proceso | texto | nota de `/recetas` (§6.2): correcciones de transcripción, supuestos y de dónde salió cada dato dudoso. La ven en la ficha, plegada, en «Cómo se armó»; por eso va en rioplatense y sin jerga |
| porciones_vistas | texto | vistas de porciones: con cuántas la cocinaron (`12,3,6`), la última primero; hasta 6 |

### `Ingredientes`
| id | receta_id | orden | cantidad (número o vacío) | unidad | nombre | nota | gondola | seccion | rol | seccion_usuario | rol_usuario |
|---|---|---|---|---|---|---|---|---|---|---|---|

- `cantidad` vacía más `unidad = "a ojo"` para "a gusto", "una pizca", "un chorrito".
- Unidades normalizadas: `g`, `kg`, `ml`, `l`, `u`, `cda`, `cdita`, `taza`, `pizca`, `a ojo`, `lata`, `paquete`, `diente`, `ramo`.
- `gondola`: `verdulería` · `almacén` · `lácteos y huevos` · `carnicería` · `panadería` · `congelados` · `otros`. La asigna el pipeline.
- `seccion`: parte de la receta ("Masa", "Relleno", "Para servir"); vacía si tiene una sola parte. La asigna el pipeline.
- `rol`: `principal` (lo infaltable) · `condimento` · `opcional` · `utensilio` (lo que no se come). Lo asigna el pipeline; vacío en las recetas viejas, que cuentan como `principal`.
- `seccion_usuario` y `rol_usuario`: lo que cambiaron ellos en la app. Se guarda aparte para que reprocesar no lo pise: al reprocesar, la API lo pasa al ingrediente con la misma sección y el mismo nombre. Vacío = lo del pipeline; `seccion_usuario = "-"` = sin sección.

### `Pasos`
| id | receta_id | orden | texto | timer_min (opcional) | tip (opcional) | ingredientes |
|---|---|---|---|---|---|---|

- `ingredientes`: los que usa el paso, como posiciones (`orden`) en la receta, «1,3». Los guarda `/recetas` (en `receta.json`, `"ingredientes": [1, 3]`); no se usan ids porque cambian al reprocesar. Si algún paso de la receta los tiene, un paso vacío no usa ninguno; si ninguno los tiene (las recetas de antes), la app los busca por nombre en el texto.

### `Notas`
| id | receta_id | fecha | quien | texto | creado | actualizado | borrada |
|---|---|---|---|---|---|---|---|

Cada vez que cocinan algo, suman una nota: es el **historial de cocción**. `fecha` es la del celular (puede haberla escrito sin conexión) y `creado`, cuándo llegó a la Sheet: con eso se arma el delta de `todo`. Las notas se editan y se borran desde la ficha: `actualizado` dice cuándo, para que el cambio llegue en el delta, y una nota borrada queda en la Sheet con `borrada` (la app no la muestra). Si los dos editan la misma nota sin conexión, gana la que llega última a la Sheet. Una nota editada dice «· editada» al lado de la fecha.

### `Compras`
| id | receta_id (o vacío si se agregó a mano) | nombre | cantidad | unidad | gondola | hecho (bool) | creado | rol | lugar | porciones |
|---|---|---|---|---|---|---|---|---|---|---|

- El `id` lo genera el celular (`c_…`): así un reintento de la cola no duplica nada.
- `rol`: el del ingrediente. Los condimentos y utensilios van a «Revisá si tenés».
- `lugar`: vacío = el que da la regla de `Lugares`. Si no, adonde lo movieron: un lugar o `revisar`.
- `porciones`: para cuántas se agregó la receta.

### `Lugares`
| id | por | clave | lugar | actualizado |
|---|---|---|---|---|

Dónde se compra cada cosa, compartido por los dos:
- `por = tipo`: la `clave` es una góndola. `por = ingrediente`: la `clave` es un nombre («huevos», «nueces»), que se compara sin tildes ni mayúsculas, tolera el plural y vale para lo que empieza igual («yogur» → «yogur griego»).
- Lugares: `supermercado` (incluye al chino) · `verdulería` · `carnicería` · `panadería` · `almacenata` · `dietética` · `feria`.
- `setup()` la siembra si está vacía: verdulería, carnicería y panadería en su propio lugar; almacén, lácteos y huevos, congelados y otros en el supermercado; huevos y yogur en la almacenata.
- El lugar de un ítem de la lista sale, en este orden, de: adonde lo movieron, «Revisá si tenés» (condimentos y utensilios), la regla del ingrediente (gana la más larga), la de su tipo o, si no hay, el supermercado.

---

## 4. API (Apps Script web app)

- Se despliega como **"Ejecutar como: yo · Acceso: cualquiera"**.
- La seguridad se resuelve con un **token compartido** en cada llamada (parámetro `t`), guardado en `PropertiesService`. Sin token válido, la API responde `401`.
- Formato: JSON. Todas las respuestas llevan `{ ok: bool, data?, error? }`.

| Método | `action` | Entrada | Salida |
|---|---|---|---|
| GET o POST | `ping` | — | `{version, ahora, hojas_faltantes, mensaje}` (prueba la conexión y el token: lo usan `setup.sh` y `npm run smoke`) |
| POST | `capturar` | `{url, quien}` | `{id, estado}` o `{duplicada: true}` |
| GET | `todo` | `since?` (fecha ISO) | Recetas, ingredientes, pasos, notas, compras, lugares y bandeja (solo lo cambiado desde `since`; compras y lugares, siempre enteras) |
| POST | `receta.upsert` | receta completa (con ingredientes y pasos), `bandeja_id?`, `foto?`, `validar?` | `{id}` (con `bandeja_id`, deja la fila en `lista`, vacía su `pedido` y manda sus capturas a la papelera: `capturas_papelera`; si los pasos traen ingredientes, devuelve `ingredientes_por_paso` con sus nombres y `sin_paso` con los que no están en ninguno, para que `/recetas` revise las posiciones) |
| POST | `receta.estado` | `{id, estado?, valoracion?}` | `{id, estado, valoracion}` |
| POST | `receta.corregir` | `{id, texto, quien?}` | `{id, receta_id, estado, pedido}`: suma `texto` al `pedido` de la fila de la receta (la más nueva; si no tiene, la crea con su `fuente_url`) y la deja en `pendiente` con los intentos en 0. Sin `texto`, cancela: vacía el pedido y la fila vuelve a `lista`. `409 procesando` si la tiene una corrida |
| POST | `receta.porciones` | `{id, porciones, quitar?}` | `{id, porciones_vistas}` (pone la vista al frente, o la saca) |
| POST | `receta.ingredientes` | `{id, ingredientes: [{id, seccion, rol}]}` | `{id}` (ediciones de ellos: `*_usuario`) |
| POST | `receta.clasificar` | `{id, ingredientes: [{id, seccion, rol}]}` | `{id}` (`/recetas --clasificar`: todos los ingredientes) |
| POST | `nota.agregar` | `{id?, receta_id, quien, texto, fecha?}` | `{id}` (con el id de la app, un reintento no la duplica) |
| POST | `nota.editar` | `{id, texto}` | `{id, texto}` (con el mismo texto no escribe; una borrada da `409 nota_borrada`) |
| POST | `nota.borrar` | `{id}` | `{id, borrada}` (la marca como borrada; idempotente) |
| POST | `compras.agregar` | `{receta_id?, porciones?, items: [{id, nombre, cantidad, unidad, gondola, rol, lugar?}]}` | `{ids, nuevos, actualizados, quitados}` (suma lo que no está; lo de la receta que ya está, por id, se actualiza (cantidad, porciones, rol) sin tocar `lugar`, y sigue marcado salvo que ahora haga falta más de algo que se compra; con `receta_id`, lo de esa receta que no vino se borra) |
| POST | `compras.marcar` | `{ids, hecho}` | `{ids, hecho}` |
| POST | `compras.mover` | `{ids, lugar}` | `{ids, lugar}` (`lugar` vacío: el de la regla) |
| POST | `compras.quitar` | `{ids}` | `{quitados}` (limpiar los marcados, sacar una receta o un ítem) |
| POST | `lugares.asignar` | `{por, clave, lugar}` | `{por, clave, lugar}` (por ingrediente, `lugar` vacío borra la regla) |
| GET | `bandeja.pendientes` | — | filas `pendiente` (las usa `/recetas`) |
| GET | `bandeja.fila` | `{id}` | `{fila}`: una fila cualquiera (`/recetas <id>`, para reprocesar) |
| POST | `bandeja.tomar` | `{limite?, id?}` | `{filas, quedan}`: dentro del lock, pasa a `procesando` (y suma un intento) las próximas para procesar, o la del `id` (409 si otra corrida la tiene). `/recetas` la usa de a una: dos corridas a la vez nunca toman la misma fila |
| POST | `bandeja.actualizar` | `{id, estado, motivo?, receta_id?, desde?}` | `{id, estado, intentos}` (volver a `pendiente` desde `ayuda` o `descartada` reinicia los intentos). Con `desde` (la app): si la fila ya no está en ese estado, `409 estado_cambio` sin tocarla; si ya está en `estado`, ok sin escribir |
| POST | `capturas.subir` | `{bandeja_id, lote, imagenes: [{base64, mime}]}` (hasta 6) | `{id, estado, capturas}`: las guarda en Drive, privadas, y deja la fila en `pendiente` (el `lote` evita duplicarlas al reintentar) |
| GET | `capturas.bajar` | `{bandeja_id}` | `{imagenes: [{id, nombre, mime, base64}]}` (las usa `/recetas`) |

**Nota técnica:** HTTP Shortcuts, la extensión y la app mandan `POST` con `Content-Type: text/plain` para evitar el preflight de CORS, que Apps Script no maneja. El cuerpo es JSON como texto.

Las acciones que usa la app son **idempotentes**: la cola offline puede mandar dos veces la misma edición sin que se duplique nada. Las que editan una receta actualizan su `actualizado`, así el delta la lleva al otro celular.

---

## 5. Captura

### 5.1 Android: HTTP Shortcuts
- Atajo **"Guardar receta"**, configurado para **recibir texto compartido** (opción *Share → aceptar texto*).
- Acción: `POST` a la URL del web app, con cuerpo `{"url":"{share_text}","quien":"pareja"}` más el token.
- Respuesta: aviso breve ("✓ Guardada" o "Ya estaba guardada"). **Sin diálogos de confirmación.**
- Flujo final: Reel → Compartir → "Compartir en…" → **Guardar receta** (3 toques).
- Extraer la URL con una expresión regular del texto compartido: Instagram a veces suma texto alrededor.

### 5.2 Mac: extensión de Chrome (MV3)
- Botón en la barra de herramientas: manda la URL de la pestaña activa.
- Menú contextual sobre links: **"Guardar en A ojo"**.
- Atajo de teclado opcional: `⌥⇧R`.
- Feedback: insignia verde "✓" durante 2 segundos, o roja si hubo error.
- Configuración (URL del web app y token) en la página de opciones de la extensión, guardada en `chrome.storage.local`.

### 5.3 Desde la app
- **Compartir → A ojo:** el manifest declara un `share_target` (`GET` a `./?titulo=…&texto=…&link=…`). En Android, la app instalada aparece en el menú Compartir de Instagram y YouTube. Se abre en la Bandeja, con el aviso «✓ Guardada. Queda esperando a la Mac.» (sin conexión: «Se manda cuando vuelva la conexión.»).
- **«Pegar un link»** en la Bandeja: para un iPhone, un iPad o una computadora sin la extensión.
- Las dos van por la **cola offline** con `capturar` (`quien` sale de la configuración): sin conexión, el link espera como «Sin mandar todavía» y se manda cuando vuelve. `capturar` deduplica, así que un reintento no crea otra fila. Si el link ya estaba, el aviso lo dice («Ese link ya estaba en la bandeja», «Ese link ya es una receta» con «Verla», «Estaba descartado: vuelve a la bandeja»). La app compara los links con la misma clave que `normalizarUrl` (`claveLink`, `js/bandeja.js`; un test exige que coincidan); si no se dio cuenta, avisa cuando contesta la API.

---

## 6. Procesamiento: comando `/recetas` (Claude Code en la Mac)

Un comando de Claude Code (en `.claude/commands/recetas.md`) que usa scripts de Python del repo. Claude hace la **extracción y estructuración**; los scripts hacen la **descarga y la transcripción**.

### 6.1 Flujo por cada link pendiente
1. `bandeja.tomar`: la fila más vieja que queda pasa a `procesando`, reservada (de a una, así otra corrida a la vez no la toma).
2. **Capa 1: metadatos.** `yt-dlp --skip-download --write-info-json` → título, autor, descripción o caption, miniatura.
   - **Posts de fotos de Instagram** (`/p/…` sin video): `fetch meta` devuelve `sin_video: true`. No hay audio ni fotogramas: la receta sale del caption y, si no alcanza, se piden capturas.
   - **Comentarios del autor (YouTube):** si la descripción está vacía o remite al comentario fijado («receta en los comentarios»), `fetch comentarios` trae, entre los 30 más votados, los del autor o fijados. Se leen como parte de la descripción.
   - Instagram: siempre con las cookies de la **cuenta secundaria de Instagram dedicada al procesamiento**, nunca las de la cuenta principal de Laura. Esas cookies viven en un **perfil de Chrome separado** ("A ojo – procesamiento") en la computadora donde se corra `/recetas`: `--cookies-from-browser "chrome:A ojo – procesamiento"`. Como macOS no deja que Claude Code lea la carpeta de Chrome, las cookies se exportan desde la Terminal (`procesamiento/aojo fetch cookies`) a `~/.a-ojo/cookies-instagram.txt`, y ese archivo tiene prioridad. La cuenta secundaria tiene que estar configurada como **mayor de 18** para poder ver Reels con restricción de audiencia.
3. **Capa 2: subtítulos** (solo YouTube). `--write-auto-subs --sub-langs "es.*,en.*"`.
4. **Capa 3: link externo.** Si la descripción remite a una web con la receta (ej.: "RECIPE ⬇️ https://…"), se lee esa página.
5. **Capa 4: audio.** Si con lo anterior faltan cantidades o pasos, se baja el audio y se transcribe con `faster-whisper` (modelo `small`, idioma autodetectado).
6. **Capa 5: fotogramas.** Si todavía faltan datos, se extrae 1 cuadro cada 3 segundos con `ffmpeg`, se arman mosaicos y Claude lee el texto sobreimpreso.
7. **Capa 6: capturas.** Si la fila tiene capturas subidas desde la app, se bajan (`capturas.bajar`) y se leen primero. Si Instagram pide iniciar sesión pero las capturas alcanzan, la receta se arma con ellas.
8. Claude **estructura la receta** (§6.2), elige la foto, **copia la miniatura a Drive**, hace `receta.upsert` y deja la bandeja en `lista`.
   - **Pedidos de corrección** (la fila trae `pedido`): se parte de la receta guardada (`api receta <id>` la deja como `receta.json`) y se cambia solo lo que pide el pedido, verificándolo contra la fuente. Si la contradice, gana el pedido y un `tip` del paso dice qué decía el original («El video dice 200 g»). Se anota en `notas_proceso` y se guarda con `api upsert --sin-foto` (no cambia la foto). Si no se entiende, `ayuda` con «No entendí el pedido…».
9. Si nada alcanza, la fila pasa a `ayuda` con un motivo legible (ej.: "Instagram pide iniciar sesión. Mandá 2 o 3 capturas").

### 6.2 Reglas de estructuración
- Todo en **castellano rioplatense**, con voseo en los pasos ("Batí", "Sumá").
- **Traducir** si el original está en otro idioma y guardar `idioma_original`.
- **Convertir** unidades estadounidenses: °F → °C, cups → g o ml cuando sea razonable, oz → g.
- **Nombres locales:** manteca (no mantequilla), crema de leche, harina 0000, zapallito, choclo, porotos, frutillas, palta.
- **Corregir errores de transcripción por contexto** ("harina 4" → "harina 0000"; "polo para hornear" → "polvo de hornear") y **registrarlo** en una nota interna.
- Ignorar el relleno del video: saludos, pedidos de suscripción, publicidad, menciones de marca innecesarias.
- Si una cantidad no aparece: `cantidad` vacía y `unidad = "a ojo"`. **Nunca inventar cantidades.**
- Pasos: frases cortas, un verbo principal por paso; temperatura y tiempo explícitos; `timer_min` cuando corresponda. Cada paso lleva sus `ingredientes`: todos los que se usan ahí, también los que el texto no nombra uno por uno («Sumá los secos»).
- Asignar `tipo`, `etiquetas`, `gondola` y `tiempo_min` (estimado).
- Asignar a cada ingrediente su `seccion` y su `rol` (§3). Los ingredientes van agrupados por sección y, dentro de cada una, en orden de uso.

### 6.3 Confianza
- **Alta:** ingredientes con cantidades y pasos completos a partir de texto o subtítulos, o de audio claro.
- **Media:** hubo que estimar pasos o completar por contexto.
- **Baja:** faltan cantidades importantes. Se muestra con una advertencia visible en la ficha.

### 6.3 bis Dónde corre y con qué cuenta
- **Se corre a mano**, cuando alguno de los dos decide procesar la bandeja.
- **Computadora:** la Mac Mini de Camilo o la computadora de Laura (Windows; ver Fase 6.2). El repo tiene que ser **portable**: un `setup.sh` instala las dependencias (`yt-dlp`, `ffmpeg`, `faster-whisper`), la configuración va en `.env` (URL de la API, token, nombre del perfil de Chrome) y no hay rutas fijas a la carpeta de un usuario.
- **Cuentas de Instagram:**
  - La **captura** se hace desde la cuenta principal de Laura: solo se comparte el link, sin cookies ni scraping.
  - El **procesamiento** usa solo la **cuenta secundaria**, en su perfil de Chrome separado.
- Como las cookies son de la cuenta secundaria, **no hace falta procesar en la computadora de Laura**: alcanza con que el perfil "A ojo – procesamiento" exista en la computadora donde se corra.

### 6.4 Robustez
- **Pausa de 2 a 5 segundos** entre links y **reintento con espera exponencial** ante `HTTP 429`: YouTube limitó las pruebas.
- `yt-dlp` se actualiza al inicio de cada corrida con `procesamiento/aojo fetch actualizar`. Como está instalado con pip dentro de `procesamiento/.venv`, `yt-dlp -U` no sirve: se actualiza el paquete en el venv (`uv pip install -U`, o pip si no hay uv). Sin conexión, sigue con la versión que hay.
- Máximo 3 intentos por link; después pasa a `ayuda`.
- Log local en `~/.a-ojo/log/AAAA-MM-DD.log`.
- Modo `--dry-run` para probar sin escribir en la Sheet.

### 6.5 Casos de prueba (lote real del 27/09)
| Link | Resultado esperado |
|---|---|
| youtube.com/shorts/cyTOswdJ4TY (torta vasca) | Completa desde subtítulos |
| youtube.com/shorts/a2qRJHVeJwk (brownie) | Completa desde subtítulos |
| youtube.com/shorts/gAyX-DCnlwI (tortilla de banana, inglés) | Completa desde audio, traducida |
| youtube.com/shorts/Y1QJJrXkqgw (banana bread) | Completa desde web externa, convertida a °C y g |
| instagram.com/reel/Ddthx0exm4L (galletitas de garbanzos) | Completa desde caption |
| instagram.com/reel/DdpNR_7N6hm (croquetas) | Ingredientes del caption y pasos del audio |
| instagram.com/reel/DUyzCo6ETRP (pollo marroquí) | Ingredientes del caption y pasos del audio |
| instagram.com/reel/Dai7vRBSXvl (restringido) | Con cookies: completa. Sin cookies: `ayuda` |

---

## 7. App (PWA)

### 7.1 Técnica
- Una sola página con rutas por hash (`#/`, `#/receta/:id`, `#/cocina/:id`, `#/ingredientes/:id`, `#/compras`, `#/compras/recetas`, `#/compras/agregar/:id`, `#/lugares`, `#/bandeja`).
- `manifest.json` (nombre "A ojo", íconos, `display: standalone`, `theme_color #A6461F`, `background_color #F5EEE3`). Sin orientación fija: se puede girar el celular, por ejemplo apoyado de costado mientras cocinan.
- **Modo oscuro** según el sistema, sin selector (§8).
- Al cambiar de pantalla, un fundido corto (View Transitions). Todas las animaciones se apagan si el sistema pide reducir el movimiento.
- Service worker: guarda la interfaz en caché y funciona offline.
- Datos: IndexedDB. Al abrir la app se piden solo los cambios (`todo?since=…`). Las ediciones se ven al instante, se encolan y se reintentan si no hay conexión.
- Búsqueda local, sin tildes y sin distinguir mayúsculas, sobre título, ingredientes y etiquetas.
- «¿Qué cocino hoy?»: el mismo campo, en el modo «Con lo que tengo», lee lo que hay en casa («zapallo, huevos y crema») y ordena las recetas por cuántos ingredientes principales faltan (`queCocino()`, `datos.js`); los condimentos y lo opcional no cuentan.
- **Wake Lock API** en el modo cocina: la pantalla no se apaga.
- **Web Share API** para la lista de compras y para compartir una receta (`compartirTexto()`, `vistas/controles.js`). Si no está disponible, se abre `https://wa.me/?text=…`.
- Las capturas se achican en el celular (JPEG de hasta 1600 px) y se mandan directo, sin pasar por la cola: piden conexión.
- Configuración inicial (URL de la API, token, quién soy) mediante un **link de configuración** único con parámetros, para no tipear nada en el celular.
- **`share_target`** (§5.3): la app abierta desde Compartir lee los parámetros, limpia la dirección y guarda el link por la cola. Mientras no llega a la API, la Bandeja muestra una fila provisoria (`local`), que se reemplaza por la de verdad cuando baja `todo`. Sin configuración, lo compartido se pierde: se ve la bienvenida, con el aviso «Primero abrí el link de configuración; después volvé a compartirlo».

### 7.2 Pantallas (referencia: lienzo "A ojo — maquetas", **variante A**)
1. **Biblioteca:** saludo "¿Qué cocinamos hoy?", un selector "Buscar" / "Con lo que tengo", buscador (en el segundo modo, las tarjetas dicen "Tenés todo lo principal" o "Faltan: crema y queso"), chips de filtro (Todas / Para probar / Favoritas / Dulce / Salado / etiquetas), aviso de la bandeja con contador y grilla de 2 columnas, en orden alfabético, con foto, título, autor y estado o valoración.
2. **Ficha:** foto grande (con Volver y, del otro lado, Compartir: manda la receta por WhatsApp con las porciones que se están viendo, los ingredientes por sección, los pasos con sus tips y el link al video), título, autor con link a la fuente, tiempo y molde; selector de estado (Para probar / Probada / Favorita) y, si está probada o es favorita, las estrellas; pasos; notas con quién la escribió y la fecha ("Laura · 12/10"; sin `quien`, "Nuestra nota"), cada una con "Editar" y "Borrar" (pide confirmación; los dos pueden editar o borrar cualquiera) y "Sumar una nota"; advertencia si la confianza es baja; "Descartar receta" (se recupera desde la ficha o el filtro "Descartadas" de la Biblioteca); "Agregar a compras" (en los ingredientes; si ya está, "En compras para N" con "Ver la lista" y "Cambiar") y "Empezar a cocinar", justo encima de la navegación inferior.
   - **Ingredientes** agrupados por sección y, dentro de cada una, por rol, en orden de uso: los principales con renglón propio, los condimentos en una línea, lo opcional tenue y los utensilios al final ("También vas a necesitar").
   - **Porciones:** −/+ para escalar y un chip por cada vista guardada ("6 · original", "12"). Empezar a cocinar con otro número lo guarda como vista; la ficha abre en la última usada.
   - **"Editar ingredientes":** cambia el rol y la sección de cada ingrediente (no los nombres ni las cantidades).
   - **"Cómo se armó"** (plegado, después de los pasos): de qué capas salió ("Salió de la descripción del video y los subtítulos"), qué quiere decir su confianza y `notas_proceso`. No aparece si la receta no tiene ni capas ni notas.
   - **"Algo está mal en esta receta"** (abajo, antes de "Descartar receta"): un texto para que `/recetas` la corrija ("Ej.: la harina son 300 g, no 200"); va por la cola. Mientras espera, un recuadro arriba muestra el pedido ("Pediste una corrección", "Corrigiéndose…" o el motivo si necesita ayuda) con "Cancelar el pedido", y el botón pasa a "Sumar algo al pedido".
   - **"Agregar a compras":** un paso para elegir, con las porciones de la ficha (−/+). En "Para comprar", los principales marcados y los opcionales sin marcar; los condimentos y utensilios van aparte, a "Revisá si tenés". Se agrega solo lo marcado. Si la receta ya está en la lista, el paso arranca con lo que está en la lista y sus porciones, y guardar la actualiza: cada ingrediente conserva su ítem (el mismo id; se empareja por nombre, rol y cantidad), así lo movido sigue en su lugar y lo marcado sigue marcado, salvo lo que ahora lleva más (misma unidad, más cantidad) y no está en «Revisá si tenés». Si la receta cambió desde que se agregó, arrancan elegidos también sus principales nuevos, con un aviso ("Quitar de la lista" también está ahí). Desde la ficha, guardar vuelve a la receta con el aviso "✓ Agregada a compras" y su botón "Ver la lista"; desde Compras, vuelve a la lista.
3. **Modo cocina:** barra de progreso, "PASO N DE M", texto grande en serif, los ingredientes de ese paso (los que guardó `/recetas`; en las recetas de antes, los que nombra el texto), con las cantidades de la vista de porciones, el tip del video, los pasos anteriores tachados y botones grandes Anterior / "Listo, siguiente"; timer cuando el paso tiene `timer_min`. Al terminar ofrece "¿Cómo salió?": estrellas y nota, opcionales. "Guardar" pasa la receta a `probada` (una favorita sigue siendo favorita); "Guardar y editar ingredientes" lleva al editor; "Ahora no" no cambia nada.
4. **Lista de compras:** las recetas que están (con sus porciones y "Quitar"), "Agregar una receta" (un buscador de recetas, en orden alfabético, que marca las que ya están y lleva al paso para elegir), "Sumar algo" a mano y la lista agrupada por lugar, con "Revisá si tenés" al final y, dentro de cada lugar, en orden alfabético. Cantidades sumadas entre recetas (con el desglose "(3 + 1)"), checkboxes grandes y lo marcado tachado en su lugar.
   - Cada ítem se puede mover a otro lugar; la hoja de mover ofrece "Comprar siempre ahí", que guarda la regla del ingrediente. En "Revisá si tenés", la casilla es "lo tengo" y "Comprar" lo pasa al lugar de su regla.
   - "Mandar por WhatsApp": un título por lugar con lo que falta y, al final, "Revisá si tenés". "Limpiar marcados".
   - "Dónde compramos cada cosa" (`#/lugares`): el lugar de cada tipo de producto y los ingredientes con lugar fijo ("Olvidar").
5. **Bandeja:** la hora del último procesamiento (cada tarjeta dice quién guardó el link: "Guardado por Laura · hoy 16:23"), «Pegar un link» (un campo y «Guardar»; si el texto no tiene link, lo dice abajo del campo) y tarjetas por link: "Necesita ayuda" (el motivo, Subir capturas / Descartar y "Probar de nuevo sin capturas"), "Esperando a la Mac…" ("Procesando…" o "Con N capturas"; Descartar) y "Recién llegadas" (la última semana, con la foto y la marca de confianza). Un pedido de corrección se ve como "Corregir: <título>", con el pedido y "Cancelar el pedido" en lugar de "Descartar".

**Estados vacíos y primera carga.**
- Cada pantalla sin datos lleva un ícono, un título corto, una explicación y, si sirve, una acción: «Borrar la búsqueda», «Ver todas», «Ver las descartadas», «Probá de nuevo», «Volver a la receta».
- La primera vez, mientras bajan las recetas, se ve el logo con «Bajando las recetas…». Sin conexión y sin nada guardado, un solo aviso con «Probá de nuevo».
- La Biblioteca sin ninguna receta no muestra el buscador, los filtros ni la cuenta.
- La ficha sin pasos no ofrece «Empezar a cocinar», y sin ingredientes no ofrece «Agregar a compras» ni «Editar ingredientes». Una receta que no está dice «No encontramos esta receta».
- Las fotos que faltan muestran una olla tenue sobre el color de relleno.

Navegación inferior: **Recetas · Compras · Bandeja**, en la Biblioteca, la Ficha, Compras y Bandeja, con cuántas cosas faltan comprar y cuántos links necesitan ayuda.

---

## 8. Guía visual (variante A: cálida y editorial)

### Colores
| Token | Hex | Uso |
|---|---|---|
| `--fondo` | `#F5EEE3` | fondo general (crema) |
| `--superficie` | `#FFFBF5` | tarjetas, listas, barra de navegación |
| `--superficie-2` | `#EFE2CF` | avisos, notas, selector segmentado |
| `--borde` | `#E4D7C5` · `#D8C8B2` | bordes suaves y de controles |
| `--tinta` | `#2A211B` | texto principal, botón oscuro |
| `--tinta-2` | `#6B5D52` | texto secundario |
| `--acento` | `#A6461F` | terracota: botón principal, activos, marca |
| `--acento-hover` | `#7E3313` | |
| `--ok` | `#4F6B2E` | confianza alta |
| `--atencion` | `#8A5A10` | confianza media o "revisar" |
| `--alerta` | `#8A3A1A` | necesita ayuda |
| `--borde-campo` | `#907C6A` | borde de casillas, campos de texto, selects y del elegido en el segmentado (3:1 o más) |

Todos los pares de texto y fondo tienen que cumplir un contraste de al menos 4,5:1 (WCAG AA), y los bordes que identifican un control, 3:1. Los revisa un test (`tests/app.test.js`) en los dos modos.

**Modo oscuro** (sigue al sistema): los mismos tonos cálidos, redefinidos en `@media (prefers-color-scheme: dark)`.

| Token | Hex |
|---|---|
| `--fondo` | `#1C1612` |
| `--superficie` | `#28201B` |
| `--superficie-2` | `#362B23` |
| `--borde` · `--borde-control` · `--borde-campo` | `#43362C` · `#5A4A3D` · `#8A7867` |
| `--tinta` · `--tinta-2` · `--tinta-nota` | `#F2E9DC` · `#BCAC9B` · `#DACDBD` |
| `--acento` · `--acento-hover` | `#E58A60` · `#F0A27E` |
| `--ok` · `--atencion` · `--alerta` | `#A9C27F` · `#E0B060` · `#F08A6A` |

El texto sobre el acento, la tinta o la alerta usa `--superficie`: en oscuro es oscura, así el botón principal y los avisos se invierten solos. La barra del sistema y el splash siguen en terracota y crema (el manifest no admite colores por modo).

### Tipografía
- **Títulos:** Fraunces (Google Fonts), pesos 500 y 700. Títulos de pantalla de 32 px, de receta de 28 px, de tarjeta de 17 px. En el modo cocina, el paso va en Fraunces de 30 px.
- **Texto:** Work Sans, pesos 400, 500 y 600. Cuerpo de 15 px; texto secundario de 13–14 px; etiquetas de sección en MAYÚSCULAS de 12 px con espaciado de 0.06em.

### Forma y espacio
- Márgenes laterales de 20 px. Radios: tarjetas de foto 16 px, contenedores 14–16 px, chips 18 px (píldora), botones principales 16–18 px.
- Área tocable de al menos 44 px. Botones principales de 52 px de alto; en el modo cocina, de 60 px.
- Íconos: SVG de trazo de 2 px con puntas redondeadas. **Nunca emojis en la interfaz.**
- El elegido de un selector y la pestaña activa se distinguen también por la forma (un borde, una pastilla), no solo por el color.

### Movimiento
- Sutil y corto: 150–220 ms con una curva suave. Fundido entre pantallas, avisos que entran y salen, el tilde de compras, el rebote de la estrella elegida, el paso de cocina que entra desde el costado, la hoja de mover que sube.
- Mientras baja la primera sincronización, el logo «respira».
- Todo va dentro de `@media (prefers-reduced-motion: no-preference)`: con «quitar animaciones» del sistema, nada se mueve.

### Tono de los textos
Rioplatense, cercano y breve: "¿Qué cocinamos hoy?", "Empezar a cocinar", "Listo, siguiente", "Esperando a la Mac…", "Mandá 2 o 3 capturas y lo resolvemos".

### Logo
**Elegido: 2 · Monograma «a» con pizca, versión 2B** (fondo terracota `#A6461F`, «a» itálica en Fraunces 700 y granos en crema). Regla: **solo dos colores**, crema y terracota. La variante clara 2A invierte los colores: fondo crema, «a» y granos en terracota. En tamaños chicos, los granos pasan de 3 a 2 (48 px) y desaparecen en 32 px. Referencia en el lienzo, fila "Logo · finalistas". Tiene que funcionar como ícono de la app (512 × 512, con zona segura para la versión adaptable de Android) y en tamaño chico (32 px).

Los íconos de la app y de la extensión salen del mismo origen (`scripts/iconos/icono.html`, con `npm run iconos`). Dentro de la app, el logo aparece en la bienvenida y en la primera carga.

---

## 9. Fases de desarrollo (para Claude Code)

Cada fase termina con una demo funcionando y un commit.

### Fase 1: datos y captura
- Crear la Sheet con las hojas y encabezados de §3 (con un script de Apps Script `setup()`).
- API con `capturar`, `todo`, `bandeja.*` y el token.
- Extensión de Chrome.
- Guía paso a paso para configurar HTTP Shortcuts en Android.
- **Listo cuando:** un Reel compartido desde el celular y un Short guardado desde Chrome aparecen como filas `pendiente`, sin duplicados.

### Fase 2: procesamiento
- Scripts de Python (`fetch.py`, `transcribe.py`, `frames.py`) y el comando `/recetas`.
- `receta.upsert`, copia de miniaturas a Drive.
- **Listo cuando:** los 8 casos de §6.5 dan el resultado esperado.

### Fase 3: app (lectura y cocina)
- PWA con Biblioteca, Ficha y Modo cocina, cache offline e instalación.
- Configuración con un link.
- **Listo cuando:** Laura la instala en Android, la abre sin conexión y cocina una receta de punta a punta.

### Fase 4a: ficha
- Secciones y roles de los ingredientes: los asigna `/recetas`; las recetas ya guardadas se completan con `/recetas --clasificar`.
- Editor de ingredientes (rol y sección), estados, valoración, notas, vistas de porciones y "¿Cómo salió?".
- Cola offline de las ediciones.
- **Listo cuando:** las recetas muestran los ingredientes por sección y rol; sin conexión, en un celular se cambia un rol, se cocina una receta para otra cantidad de porciones y se guarda "¿Cómo salió?"; al volver la conexión, el otro celular ve el estado, la valoración, la nota, la vista y el rol nuevos.

### Fase 4b: compras y bandeja
- Lista de compras por lugar (con el paso para elegir, mover y las reglas de `Lugares`) y exportación a WhatsApp.
- Navegación inferior y pantalla Bandeja con la subida de capturas; la capa 6 de `/recetas`.
- **Listo cuando:** arman la compra de 3 recetas (con un opcional elegido y un ítem movido de lugar) y la mandan por WhatsApp; y una fila en "Necesita ayuda" se resuelve subiendo capturas desde el celular y corriendo `/recetas`.

### Fase 5: pulido
- Logo e íconos (también los de la extensión), pantallas vacías y primera carga, microanimaciones, revisión de accesibilidad (AA) y modo oscuro.
- **Listo cuando:** instalada de cero en Android, muestra el logo mientras baja las recetas; con el celular en modo oscuro, toda la app se ve en la paleta oscura; cada pantalla tiene su estado vacío; las pantallas cambian con un fundido y los avisos entran y salen, y con «quitar animaciones» del sistema nada se mueve; el test de contraste pasa en los dos modos; la extensión muestra el logo 2B.

### Fase 6: correcciones, infraestructura y funciones nuevas
Sale de la revisión del proyecto del 14/11/2026, hecha con las fases 1 a 5 terminadas. Cada grupo puede ir en uno o más commits; el orden sugerido es 6.1 → 6.2 → 6.3.

#### 6.1 Correcciones y riesgos
- **Cola offline: estado esperado en la bandeja.** `bandeja.actualizar` recibe un `desde` opcional (el estado que veía la app). Si la fila ya no está en ese estado, responde `409` y la cola descarta la edición con un aviso, igual que `ingredientes_cambiaron`. Así, «Descartar» o «Probar de nuevo» mandados sin conexión no pisan una fila que la Mac ya dejó en `lista`. (`Acciones.js`, `ediciones.js`, `vistas/bandeja.js`, con su caso en `aplicarEdicion()` y su test.)
- **Timers del modo cocina con la app en segundo plano.** Hoy no suenan si se sale de la app: el chip del timer avisa «Suena con A ojo abierta». Investigar si Chrome en Android permite abrir el temporizador del sistema con un link `intent:`; si no, queda solo el aviso.
  - *Investigado (14/11):* Chrome solo abre con `intent:` actividades marcadas `BROWSABLE`, y no hay indicios de que la del Reloj que atiende `SET_TIMER` lo esté (no se probó en un celular). **Queda solo el aviso.**
- **Fotos sin conexión.** Medir en el celular, con `navigator.storage.estimate()`, cuánto ocupa la caché de fotos (las de Drive se guardan como respuestas opacas, que pueden contar mucho más de lo que pesan). Dejar preparada en `urlImagen_()` (`Drive.js`) la alternativa `https://lh3.googleusercontent.com/d/<id>=w1200` por si `drive.google.com/thumbnail` deja de andar.
  - *Hecho (14/11):* `FORMA_URL_FOTOS_` (`Drive.js`) elige `thumbnail` o `lh3`; solo cambia las fotos nuevas. La CSP de la app ya permite las dos. Falta la medición en el celular.
- **Links `/share/` de Instagram.** `Url.js` toma `share` como nombre de usuario: `/share/p/X` se normalizaría a `/p/X/` con un id que no es el del post. Probarlo con un link real; si aparece, no canonizarlo y resolver la redirección en `fetch meta`. Con su test en `tests/url.test.js`.
  - *Revisado (14/11):* entre los 100 links procesados no hay ninguno `/share/`, y el Android de Laura comparte `/reel/<id>/`. **Queda pendiente** hasta que aparezca uno real.
- **Dos corridas de `/recetas` a la vez** (la Mac y la computadora de Laura): `bandeja.pendientes` no reserva nada, así que las dos podrían tomar la misma fila. Sumar una acción `bandeja.tomar` que, dentro del lock, pase a `procesando` las filas que devuelve, y que `/recetas` la use en lugar de `pendientes` + `actualizar procesando`.
- **Capturas que quedan en Drive.** Mandarlas a la papelera cuando la fila pasa a `lista` (en `receta.upsert`) o con una limpieza de las de más de 30 días.
  - *Decidido (14/11):* al pasar a `lista`, en `receta.upsert`. Las de filas descartadas quedan (son pocas).
- **`procesamiento/aojo`:** validar el subcomando antes de buscar el `.venv`, así `test_aojo_sin_script_valido` pasa en cualquier máquina (también en CI).
- **SPEC al día:** sumar `notas_proceso` a la hoja `Recetas` (§3) y `ping` a la tabla de la API (§4); describir en §6.1 los comentarios del autor en YouTube y los posts de fotos de Instagram (`sin_video`); aclarar en §6.4 que yt-dlp se actualiza con pip dentro del venv. Actualizar el estado del README.
- **Detalles menores:**
  - Los colores de relleno de las fotos (`RELLENOS`, `dom.js`) pasan a tokens de `estilos.css`, en los dos modos.
  - El `confirm()` de «¿Salir sin guardar los cambios?» (`vistas/ingredientes.js`) se reemplaza por un diálogo con el estilo de la app.
  - Una versión nueva no recarga la app mientras se escribe una nota (hoy solo se protege el modo cocina): espera, o avisa «Hay una versión nueva».
  - `api fila` deja de bajar `todo` entero para leer una sola fila.
  - `scripts/servir.js` escucha solo en `127.0.0.1`.

#### 6.2 Infraestructura y proceso
- **Tests en GitHub Actions:** un job `test` con `npm test` y los tests de Python (solo biblioteca estándar), y `needs: test` en el job que publica la app en Pages.
  - *Hecho (14/11):* `.github/workflows/tests.yml`, que `pages.yml` llama antes de publicar.
- **`npm run deploy` más seguro:** corre `npm test` antes del push y `procesamiento/aojo api ping` después del deploy, para detectar enseguida un permiso nuevo de Google que todavía no se aceptó.
  - *Hecho (14/11):* el ping espera la `VERSION_API` de `Api.js`.
- **Backup de la Sheet:** un trigger semanal de Apps Script que copia la planilla a «A ojo/backups» y conserva las últimas 8. Pide un permiso nuevo: correr `setup()` en el editor antes del deploy.
  - *Hecho (14/11):* `Backup.js`. `setup()` instala el trigger (domingos a las 4) sin duplicarlo y, si no hay ninguna copia, hace la primera.
- **Permisos de `/recetas` en el repo:** pasar los de `.claude/settings.local.json` a un `.claude/settings.json` versionado, con rutas `~/.a-ojo/**` en lugar de rutas fijas, y sumar `.claude/settings.local.json` al `.gitignore`. Así `/recetas` corre igual en la computadora de Laura.
  - *Hecho (14/11).*
- **`/recetas` desde la computadora de Laura (Windows), con su propia cuenta de Claude Code.** Camino elegido: **WSL 2** (Ubuntu), donde los scripts de `procesamiento/` y `aojo` corren como en la Mac. Hace falta:
  - Que `setup.sh` acepte Linux: `apt` en lugar de Homebrew para ffmpeg, y el mismo venv con uv.
  - Cookies de la cuenta secundaria de Instagram desde **Firefox**: en Windows, Chrome cifra las cookies de forma que yt-dlp no las puede leer. Un perfil de Firefox «A ojo – procesamiento» y `fetch cookies` (o una exportación a `~/.a-ojo/cookies-instagram.txt`) reemplazan al perfil de Chrome. Actualizar `docs/perfil-instagram.md`.
    - *Hecho (14/11):* el nombre visible del perfil de Firefox se resuelve con su `profiles.ini`, también el de Windows desde WSL (`/mnt/c/Users/*/AppData/Roaming/Mozilla/Firefox`), y yt-dlp recibe la ruta de la carpeta.
  - Su propio `.env` (misma URL de la API y mismo token, que se le pasan por privado; sin clasp ni `A_OJO_DEPLOYMENT_ID`, porque no despliega).
  - Una guía `docs/procesar-en-windows.md`: instalar WSL 2, Claude Code adentro de WSL, clonar el repo en el disco de WSL (no en `/mnt/c`, que es lento), correr `./setup.sh` y probar con `/recetas --dry-run`.
  - *Hecho (14/11):* `setup.sh` acepta Linux con apt; la guía está en `docs/procesar-en-windows.md`, y `.gitattributes` fuerza LF por si se clona desde Windows. Falta la prueba real en la computadora de Laura.
  - Alternativa descartada por ahora: Windows nativo (Claude Code con Git Bash), que pediría un `setup.ps1` y adaptar las rutas del venv (`Scripts\python.exe`).

#### 6.3 Funciones nuevas (de más a menos valor)
1. **Compartir directo a A ojo.** `share_target` en el manifest: en Android, la app instalada aparece en el menú Compartir de Instagram y YouTube. Además, un campo «Pegar un link» en la Bandeja (para iPhone, iPad o una computadora sin la extensión). `capturar` ya deduplica, así que puede ir por la cola.
   - *Hecho (14/11):* §5.3. Sin cambios en la API. Falta la prueba en Android: Chrome actualiza el manifest de la app instalada solo, pero puede tardar; si «A ojo» no aparece en Compartir, reinstalarla.
2. **«Algo está mal en esta receta».** Desde la ficha se pide reprocesarla con un texto («la harina son 300 g»). Queda en la bandeja y `/recetas` lo lee como instrucción.
   - *Hecho (14/11):* columna `pedido` en `Bandeja`, `receta.corregir` (API 0.7.0), `api receta` y `--sin-foto` en `procesamiento/api.py`, §1.5 de `recetas.md`. Decidido: se parte de la receta guardada y, si el pedido contradice la fuente, gana el pedido con un tip que lo avisa. Falta la demo con la API desplegada.
3. **Quién escribió cada nota.** Un mapa de nombres para mostrar en el código (`camilo` → Camilo, `pareja` → Laura), que usan las notas y cualquier otro texto que nombre a alguien.
   - *Hecho (14/11):* `NOMBRES` y `nombreDe()` en `formato.js`; los usan las notas de la ficha y las tarjetas de la Bandeja. Un test revisa que ningún texto de las vistas diga «pareja».
4. **Pasos con sus ingredientes explícitos.** `/recetas` guarda en cada paso los ingredientes que usa (columna nueva en `Pasos`); `ingredientesPorNombre()` (`cocina.js`) queda como respaldo para las recetas viejas.
   - *Hecho (14/11):* columna `ingredientes` en `Pasos` (posiciones, «1,3»), validada en `receta.upsert` (API 0.8.0); `ingredientesDePaso()` en `cocina.js`. Las recetas viejas siguen con el respaldo (o se completan si pasan por un pedido de corrección); un `/recetas --pasos` para completarlas queda como idea.
5. **«Cómo se armó»** en la ficha: `notas_proceso`, plegado.
   - *Hecho (14/11):* un `<details>` en la ficha con el origen (`textoOrigen()`, `formato.js`), la confianza y `notas_proceso`. `/recetas` las escribe desde ahora para ellos, sin jerga; las de antes quedan como están.
6. **Compartir una receta** por WhatsApp, como la lista de compras.
   - *Hecho (14/11):* botón sobre la foto de la ficha; el texto lo arma `textoReceta()` (`ingredientes.js`), con las porciones de la ficha.
7. **Editar y borrar notas.**
   - *Hecho (14/11):* `nota.editar` y `nota.borrar` (API 0.9.0), columnas `actualizado` y `borrada` en `Notas`. Decidido: los dos pueden editar o borrar cualquier nota; borrar pide confirmación.
8. **Re-agregar una receta a compras sin perder lo marcado:** reusar el id de cada ingrediente y que `compras.agregar` actualice la cantidad y las porciones de los que ya están.
   - *Hecho (14/11):* `idsPara()` (`compras.js`) le da a cada ingrediente el id del ítem que ya tiene en la lista (por nombre, dentro de la receta) y `compras.agregar` actualiza esos ítems (API 0.10.0). El paso para elegir arranca con lo que ya está en la lista. Decidido: lo marcado se desmarca si ahora hace falta más.
9. **Pendientes de v2 (§1):** un «¿Qué cocino hoy?» simple (filtrar por «tengo: …» con la búsqueda que ya existe), la exportación a Obsidian y, si se revisa la decisión de procesar siempre a mano, correr `/recetas` programado en la Mac con Claude Code sin interfaz.
   - *Decidido (14/11):* se hacen «¿Qué cocino hoy?» y la exportación a Obsidian; `/recetas` programado, no por ahora (el procesamiento sigue a mano).
   - *Hecho (14/11):* «¿Qué cocino hoy?», como modo «Con lo que tengo» de la Biblioteca.

#### 6.4 Forma de trabajo
- Se implementa en Claude Code, un ítem por sesión y por commit, siguiendo `CLAUDE.md`.
- Modelo de `/recetas`: probar `model: sonnet` en el frontmatter para las corridas de rutina y reprocesar con Opus las recetas de confianza media o baja. Comparar 3 o 4 recetas antes de dejarlo fijo.
- Esfuerzo alto para lo que toca la API, la cola y `/recetas` a la vez (estado esperado en la bandeja, compartir directo, «Algo está mal»); bajo para la SPEC al día y los detalles menores.

- **Listo cuando:** un «Descartar» mandado sin conexión sobre una fila que ya está `lista` vuelve con aviso y no la cambia; los tests corren en GitHub Actions y un test que falla frena la publicación; `npm run deploy` termina con un `ping` que responde; hay al menos un backup semanal en Drive; un Reel compartido desde Instagram a la app instalada aparece en la Bandeja; un pedido de «Algo está mal» se resuelve corriendo `/recetas`; las notas muestran quién las escribió («Laura», «Camilo»); Laura corre `/recetas` en su computadora y la receta llega a la app; dos corridas a la vez no toman la misma fila; y la SPEC describe lo que hace el código.

---

## 10. Riesgos y decisiones pendientes

| Riesgo | Mitigación |
|---|---|
| Instagram bloquea o cambia la descarga | Cookies del navegador, `yt-dlp` siempre actualizado y el plan B de las capturas |
| Usar cookies para descargar va contra los términos de Instagram | **Decidido:** cuenta secundaria dedicada; la cuenta principal de Laura nunca se usa para procesar. Volumen bajo |
| La cuenta secundaria no puede ver algún Reel (cuenta privada o restricción) | Plan B: las capturas, desde la pantalla Bandeja |
| Límites de YouTube (429) | Pausas, reintentos, procesamiento en lote espaciado |
| Cuotas de Apps Script | Uso personal: muy por debajo de los límites gratuitos |
| El token queda expuesto en la extensión o en el celular | Aceptable para uso privado. Se puede cambiar en cualquier momento desde `PropertiesService` |
| Las URLs de las miniaturas de Instagram vencen | Copia propia en Drive al procesar |
| La Mac apagada demora el procesamiento | Esperado: la bandeja lo muestra con claridad |

**Decisiones tomadas (27/09):**
- Nombre: **A ojo**. Estilo: **variante A** en todas las pantallas.
- Procesamiento **siempre manual**. Puede correr en la computadora de cualquiera de los dos.
- **Cuenta secundaria de Instagram** solo para el procesamiento; la captura sigue desde la cuenta principal de Laura.
- Logo: **monograma «a» con pizca, versión 2B**, solo en crema y terracota.

**Decisiones pendientes:**
- Ninguna por ahora.

**Decisiones tomadas (14/11):**
- La computadora de Laura es **Windows**. Va a poder correr `/recetas` con su propia cuenta de Claude Code (Fase 6.2).
- En la interfaz, los textos y la documentación se la nombra **Laura**; `pareja` queda solo como valor interno de `quien`.
