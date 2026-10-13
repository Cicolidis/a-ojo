# A ojo — Spec v1

> App personal de recetas para dos personas (Camilo y su pareja). Captura links de YouTube e Instagram, los convierte en recetas estructuradas en rioplatense y los muestra en una app instalable, cálida y editorial.
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
| Base de datos | Google Sheets | Drive de Camilo, compartida con ella |
| API | Apps Script, web app (`doGet`/`doPost`) que devuelve JSON | Proyecto ligado a la Sheet |
| App | PWA: HTML, CSS y JS, sin framework pesado (vanilla o Preact) | GitHub Pages |
| Captura Mac | Extensión de Chrome MV3 (desempaquetada) | Chrome de Camilo |
| Captura Android | HTTP Shortcuts (Play Store / F-Droid) | Celular de ella |
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
| quien | `camilo` · `pareja` | según el origen: extensión o HTTP Shortcuts |
| estado | `pendiente` · `procesando` · `lista` · `ayuda` · `descartada` | |
| motivo | texto | solo si `estado = ayuda` (ej.: "Instagram pide login") |
| receta_id | texto | se completa cuando está `lista` |
| intentos | número | |
| actualizado | fecha-hora ISO | |
| capturas | texto | ids de Drive de las capturas que subieron desde la app (capa 6), separados por coma |

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
| id | receta_id | orden | texto | timer_min (opcional) | tip (opcional) |
|---|---|---|---|---|---|

### `Notas`
| id | receta_id | fecha | quien | texto | creado |
|---|---|---|---|---|---|

Cada vez que cocinan algo, suman una nota: es el **historial de cocción**. `fecha` es la del celular (puede haberla escrito sin conexión) y `creado`, cuándo llegó a la Sheet: con eso se arma el delta de `todo`.

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
| POST | `capturar` | `{url, quien}` | `{id, estado}` o `{duplicada: true}` |
| GET | `todo` | `since?` (fecha ISO) | Recetas, ingredientes, pasos, notas, compras, lugares y bandeja (solo lo cambiado desde `since`; compras y lugares, siempre enteras) |
| POST | `receta.upsert` | receta completa (con ingredientes y pasos) | `{id}` |
| POST | `receta.estado` | `{id, estado?, valoracion?}` | `{id, estado, valoracion}` |
| POST | `receta.porciones` | `{id, porciones, quitar?}` | `{id, porciones_vistas}` (pone la vista al frente, o la saca) |
| POST | `receta.ingredientes` | `{id, ingredientes: [{id, seccion, rol}]}` | `{id}` (ediciones de ellos: `*_usuario`) |
| POST | `receta.clasificar` | `{id, ingredientes: [{id, seccion, rol}]}` | `{id}` (`/recetas --clasificar`: todos los ingredientes) |
| POST | `nota.agregar` | `{id?, receta_id, quien, texto, fecha?}` | `{id}` (con el id de la app, un reintento no la duplica) |
| POST | `compras.agregar` | `{receta_id?, porciones?, items: [{id, nombre, cantidad, unidad, gondola, rol, lugar?}]}` | `{ids, nuevos, quitados}` (suma lo que no está; con `receta_id`, lo de esa receta que no vino se borra: volver a agregarla la reemplaza) |
| POST | `compras.marcar` | `{ids, hecho}` | `{ids, hecho}` |
| POST | `compras.mover` | `{ids, lugar}` | `{ids, lugar}` (`lugar` vacío: el de la regla) |
| POST | `compras.quitar` | `{ids}` | `{quitados}` (limpiar los marcados, sacar una receta o un ítem) |
| POST | `lugares.asignar` | `{por, clave, lugar}` | `{por, clave, lugar}` (por ingrediente, `lugar` vacío borra la regla) |
| GET | `bandeja.pendientes` | — | filas `pendiente` (las usa `/recetas`) |
| POST | `bandeja.actualizar` | `{id, estado, motivo?, receta_id?}` | `{id, estado, intentos}` (volver a `pendiente` desde `ayuda` o `descartada` reinicia los intentos) |
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

---

## 6. Procesamiento: comando `/recetas` (Claude Code en la Mac)

Un comando de Claude Code (en `.claude/commands/recetas.md`) que usa scripts de Python del repo. Claude hace la **extracción y estructuración**; los scripts hacen la **descarga y la transcripción**.

### 6.1 Flujo por cada link pendiente
1. `bandeja.actualizar → procesando`.
2. **Capa 1: metadatos.** `yt-dlp --skip-download --write-info-json` → título, autor, descripción o caption, miniatura.
   - Instagram: siempre con las cookies de la **cuenta secundaria de Instagram dedicada al procesamiento**, nunca las de la cuenta principal de ella. Esas cookies viven en un **perfil de Chrome separado** ("A ojo – procesamiento") en la computadora donde se corra `/recetas`: `--cookies-from-browser "chrome:A ojo – procesamiento"`. La cuenta secundaria tiene que estar configurada como **mayor de 18** para poder ver Reels con restricción de audiencia.
3. **Capa 2: subtítulos** (solo YouTube). `--write-auto-subs --sub-langs "es.*,en.*"`.
4. **Capa 3: link externo.** Si la descripción remite a una web con la receta (ej.: "RECIPE ⬇️ https://…"), se lee esa página.
5. **Capa 4: audio.** Si con lo anterior faltan cantidades o pasos, se baja el audio y se transcribe con `faster-whisper` (modelo `small`, idioma autodetectado).
6. **Capa 5: fotogramas.** Si todavía faltan datos, se extrae 1 cuadro cada 3 segundos con `ffmpeg`, se arman mosaicos y Claude lee el texto sobreimpreso.
7. **Capa 6: capturas.** Si la fila tiene capturas subidas desde la app, se bajan (`capturas.bajar`) y se leen primero. Si Instagram pide iniciar sesión pero las capturas alcanzan, la receta se arma con ellas.
8. Claude **estructura la receta** (§6.2), elige la foto, **copia la miniatura a Drive**, hace `receta.upsert` y deja la bandeja en `lista`.
9. Si nada alcanza, la fila pasa a `ayuda` con un motivo legible (ej.: "Instagram pide iniciar sesión. Mandá 2 o 3 capturas").

### 6.2 Reglas de estructuración
- Todo en **castellano rioplatense**, con voseo en los pasos ("Batí", "Sumá").
- **Traducir** si el original está en otro idioma y guardar `idioma_original`.
- **Convertir** unidades estadounidenses: °F → °C, cups → g o ml cuando sea razonable, oz → g.
- **Nombres locales:** manteca (no mantequilla), crema de leche, harina 0000, zapallito, choclo, porotos, frutillas, palta.
- **Corregir errores de transcripción por contexto** ("harina 4" → "harina 0000"; "polo para hornear" → "polvo de hornear") y **registrarlo** en una nota interna.
- Ignorar el relleno del video: saludos, pedidos de suscripción, publicidad, menciones de marca innecesarias.
- Si una cantidad no aparece: `cantidad` vacía y `unidad = "a ojo"`. **Nunca inventar cantidades.**
- Pasos: frases cortas, un verbo principal por paso; temperatura y tiempo explícitos; `timer_min` cuando corresponda.
- Asignar `tipo`, `etiquetas`, `gondola` y `tiempo_min` (estimado).
- Asignar a cada ingrediente su `seccion` y su `rol` (§3). Los ingredientes van agrupados por sección y, dentro de cada una, en orden de uso.

### 6.3 Confianza
- **Alta:** ingredientes con cantidades y pasos completos a partir de texto o subtítulos, o de audio claro.
- **Media:** hubo que estimar pasos o completar por contexto.
- **Baja:** faltan cantidades importantes. Se muestra con una advertencia visible en la ficha.

### 6.3 bis Dónde corre y con qué cuenta
- **Se corre a mano**, cuando alguno de los dos decide procesar la bandeja.
- **Computadora:** la Mac Mini de Camilo o la computadora de ella. El repo tiene que ser **portable**: un `setup.sh` instala las dependencias (`yt-dlp`, `ffmpeg`, `faster-whisper`), la configuración va en `.env` (URL de la API, token, nombre del perfil de Chrome) y no hay rutas fijas a la carpeta de un usuario.
- **Cuentas de Instagram:**
  - La **captura** se hace desde la cuenta principal de ella: solo se comparte el link, sin cookies ni scraping.
  - El **procesamiento** usa solo la **cuenta secundaria**, en su perfil de Chrome separado.
- Como las cookies son de la cuenta secundaria, **no hace falta procesar en la computadora de ella**: alcanza con que el perfil "A ojo – procesamiento" exista en la computadora donde se corra.

### 6.4 Robustez
- **Pausa de 2 a 5 segundos** entre links y **reintento con espera exponencial** ante `HTTP 429`: YouTube limitó las pruebas.
- `yt-dlp` se actualiza (`-U`) al inicio de cada corrida.
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
- `manifest.json` (nombre "A ojo", íconos, `display: standalone`, `theme_color #A6461F`, `background_color #F5EEE3`).
- Service worker: guarda la interfaz en caché y funciona offline.
- Datos: IndexedDB. Al abrir la app se piden solo los cambios (`todo?since=…`). Las ediciones se ven al instante, se encolan y se reintentan si no hay conexión.
- Búsqueda local, sin tildes y sin distinguir mayúsculas, sobre título, ingredientes y etiquetas.
- **Wake Lock API** en el modo cocina: la pantalla no se apaga.
- **Web Share API** para la lista de compras. Si no está disponible, se abre `https://wa.me/?text=…`.
- Las capturas se achican en el celular (JPEG de hasta 1600 px) y se mandan directo, sin pasar por la cola: piden conexión.
- Configuración inicial (URL de la API, token, quién soy) mediante un **link de configuración** único con parámetros, para no tipear nada en el celular.

### 7.2 Pantallas (referencia: lienzo "A ojo — maquetas", **variante A**)
1. **Biblioteca:** saludo "¿Qué cocinamos hoy?", buscador, chips de filtro (Todas / Para probar / Favoritas / Dulce / Salado / etiquetas), aviso de la bandeja con contador y grilla de 2 columnas, en orden alfabético, con foto, título, autor y estado o valoración.
2. **Ficha:** foto grande, título, autor con link a la fuente, tiempo y molde; selector de estado (Para probar / Probada / Favorita) y, si está probada o es favorita, las estrellas; pasos; notas con fecha ("Nuestra nota") y "Sumar una nota"; advertencia si la confianza es baja; "Descartar receta" (se recupera desde la ficha o el filtro "Descartadas" de la Biblioteca); "Agregar a compras" (en los ingredientes; si ya está, "En compras para N" con "Ver la lista" y "Cambiar") y "Empezar a cocinar", justo encima de la navegación inferior.
   - **Ingredientes** agrupados por sección y, dentro de cada una, por rol, en orden de uso: los principales con renglón propio, los condimentos en una línea, lo opcional tenue y los utensilios al final ("También vas a necesitar").
   - **Porciones:** −/+ para escalar y un chip por cada vista guardada ("6 · original", "12"). Empezar a cocinar con otro número lo guarda como vista; la ficha abre en la última usada.
   - **"Editar ingredientes":** cambia el rol y la sección de cada ingrediente (no los nombres ni las cantidades).
   - **"Agregar a compras":** un paso para elegir, con las porciones de la ficha (−/+). En "Para comprar", los principales marcados y los opcionales sin marcar; los condimentos y utensilios van aparte, a "Revisá si tenés". Se agrega solo lo marcado. Si la receta ya está en la lista, guardar la reemplaza ("Quitar de la lista" también está ahí). Desde la ficha, guardar vuelve a la receta con el aviso "✓ Agregada a compras" y su botón "Ver la lista"; desde Compras, vuelve a la lista.
3. **Modo cocina:** barra de progreso, "PASO N DE M", texto grande en serif, los ingredientes de ese paso (con las cantidades de la vista de porciones), el tip del video, los pasos anteriores tachados y botones grandes Anterior / "Listo, siguiente"; timer cuando el paso tiene `timer_min`. Al terminar ofrece "¿Cómo salió?": estrellas y nota, opcionales. "Guardar" pasa la receta a `probada` (una favorita sigue siendo favorita); "Guardar y editar ingredientes" lleva al editor; "Ahora no" no cambia nada.
4. **Lista de compras:** las recetas que están (con sus porciones y "Quitar"), "Agregar una receta" (un buscador de recetas, en orden alfabético, que marca las que ya están y lleva al paso para elegir), "Sumar algo" a mano y la lista agrupada por lugar, con "Revisá si tenés" al final y, dentro de cada lugar, en orden alfabético. Cantidades sumadas entre recetas (con el desglose "(3 + 1)"), checkboxes grandes y lo marcado tachado en su lugar.
   - Cada ítem se puede mover a otro lugar; la hoja de mover ofrece "Comprar siempre ahí", que guarda la regla del ingrediente. En "Revisá si tenés", la casilla es "lo tengo" y "Comprar" lo pasa al lugar de su regla.
   - "Mandar por WhatsApp": un título por lugar con lo que falta y, al final, "Revisá si tenés". "Limpiar marcados".
   - "Dónde compramos cada cosa" (`#/lugares`): el lugar de cada tipo de producto y los ingredientes con lugar fijo ("Olvidar").
5. **Bandeja:** la hora del último procesamiento y tarjetas por link: "Necesita ayuda" (el motivo, Subir capturas / Descartar y "Probar de nuevo sin capturas"), "Esperando a la Mac…" ("Procesando…" o "Con N capturas"; Descartar) y "Recién llegadas" (la última semana, con la foto y la marca de confianza).

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

Todos los pares de texto y fondo tienen que cumplir un contraste de al menos 4,5:1 (WCAG AA).

### Tipografía
- **Títulos:** Fraunces (Google Fonts), pesos 500 y 700. Títulos de pantalla de 32 px, de receta de 28 px, de tarjeta de 17 px. En el modo cocina, el paso va en Fraunces de 30 px.
- **Texto:** Work Sans, pesos 400, 500 y 600. Cuerpo de 15 px; texto secundario de 13–14 px; etiquetas de sección en MAYÚSCULAS de 12 px con espaciado de 0.06em.

### Forma y espacio
- Márgenes laterales de 20 px. Radios: tarjetas de foto 16 px, contenedores 14–16 px, chips 18 px (píldora), botones principales 16–18 px.
- Área tocable de al menos 44 px. Botones principales de 52 px de alto; en el modo cocina, de 60 px.
- Íconos: SVG de trazo de 2 px con puntas redondeadas. **Nunca emojis en la interfaz.**

### Tono de los textos
Rioplatense, cercano y breve: "¿Qué cocinamos hoy?", "Empezar a cocinar", "Listo, siguiente", "Esperando a la Mac…", "Mandá 2 o 3 capturas y lo resolvemos".

### Logo
**Elegido: 2 · Monograma «a» con pizca, versión 2B** (fondo terracota `#A6461F`, «a» itálica en Fraunces 700 y granos en crema). Regla: **solo dos colores**, crema y terracota. La variante clara 2A invierte los colores: fondo crema, «a» y granos en terracota. En tamaños chicos, los granos pasan de 3 a 2 (48 px) y desaparecen en 32 px. Referencia en el lienzo, fila "Logo · finalistas". Tiene que funcionar como ícono de la app (512 × 512, con zona segura para la versión adaptable de Android) y en tamaño chico (32 px).

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
- **Listo cuando:** ella la instala en Android, la abre sin conexión y cocina una receta de punta a punta.

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
- Logo e íconos, pantallas vacías, microanimaciones, revisión de accesibilidad.

---

## 10. Riesgos y decisiones pendientes

| Riesgo | Mitigación |
|---|---|
| Instagram bloquea o cambia la descarga | Cookies del navegador, `yt-dlp` siempre actualizado y el plan B de las capturas |
| Usar cookies para descargar va contra los términos de Instagram | **Decidido:** cuenta secundaria dedicada; la cuenta principal de ella nunca se usa para procesar. Volumen bajo |
| La cuenta secundaria no puede ver algún Reel (cuenta privada o restricción) | Plan B: las capturas, desde la pantalla Bandeja |
| Límites de YouTube (429) | Pausas, reintentos, procesamiento en lote espaciado |
| Cuotas de Apps Script | Uso personal: muy por debajo de los límites gratuitos |
| El token queda expuesto en la extensión o en el celular | Aceptable para uso privado. Se puede cambiar en cualquier momento desde `PropertiesService` |
| Las URLs de las miniaturas de Instagram vencen | Copia propia en Drive al procesar |
| La Mac apagada demora el procesamiento | Esperado: la bandeja lo muestra con claridad |

**Decisiones tomadas (27/09):**
- Nombre: **A ojo**. Estilo: **variante A** en todas las pantallas.
- Procesamiento **siempre manual**. Puede correr en la computadora de cualquiera de los dos.
- **Cuenta secundaria de Instagram** solo para el procesamiento; la captura sigue desde la cuenta principal de ella.
- Logo: **monograma «a» con pizca, versión 2B**, solo en crema y terracota.

**Decisiones pendientes:**
- Sistema operativo de la computadora de ella, si se va a procesar ahí (el `setup.sh` está pensado para macOS; en Windows convendría usar WSL).
