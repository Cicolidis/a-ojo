---
description: Procesa la Bandeja de A ojo — baja cada link pendiente, arma la receta en rioplatense y la guarda en la Sheet
argument-hint: "[cantidad | id de bandeja] [--dry-run] [--sin-cookies] [--clasificar]"
allowed-tools: Bash(procesamiento/aojo:*), Read, Write, WebFetch
---

# /recetas

Procesá la Bandeja de A ojo siguiendo §6 de `SPEC_v1.md`. Los scripts bajan y transcriben; vos leés, decidís qué capas hacen falta y **estructurás la receta**.

Argumentos: `$ARGUMENTS`

- Un número `N`: procesá hasta N filas. Sin número, **hasta 10** (YouTube corta con HTTP 429 si se le pide mucho seguido).
- Un id de la bandeja (ej.: `b_e3cgj`): procesá solo esa fila, esté en el estado que esté (sirve para reprocesar).
- `--dry-run`: no escribe nada en la Sheet. Pasá `--dry-run` a todos los `api actualizar` y `api upsert` (este último solo valida la receta contra la API).
- `--sin-cookies`: pasáselo a `fetch meta` (para probar Instagram sin la cuenta secundaria).
- `--clasificar`: no procesa la bandeja. Completa la sección y el rol de los ingredientes de las recetas ya guardadas que no los tienen. Seguí §5 y no hagas nada más.

Todos los comandos se corren **desde la raíz del repo** con `procesamiento/aojo <script> …`. Cada uno imprime una línea de JSON: si trae `"ok": false`, mirá `error` y `motivo`. Nunca leas `info.json` entero (pesa megas) ni imprimas el `.env`.

## 0. Arranque

1. `procesamiento/aojo fetch actualizar` (una vez por corrida; si avisa que no pudo actualizar, seguí igual).
2. Las filas:
   - Con un id: `procesamiento/aojo api fila <id>`.
   - Si no: `procesamiento/aojo api pendientes --limite N`. Trae las `pendiente` y las que quedaron trabadas en `procesando` por una corrida cortada.
3. Si no hay filas, decilo en una línea y terminá. Si hay, decí cuántas vas a procesar y de cuántas en total.

Procesá las filas **de a una, en orden**. Después de cada una, contá en una línea cómo salió.

## 1. Por cada fila

### 1.1 Marcarla

`procesamiento/aojo api actualizar <id> procesando`. La respuesta trae `intentos`: si es **mayor que 3**, pasala a `ayuda` con el motivo «Lo intenté 3 veces y no pude. Mandá 2 o 3 capturas.» y seguí con la próxima.

### 1.2 Capas, solo mientras falten datos

Si la fila trae `capturas` (las subieron desde la app porque el link necesitaba ayuda), empezá por ellas: `procesamiento/aojo api capturas <id>` las deja en `<dir>/capturas/` y devuelve las rutas. Leelas todas con Read: suelen tener justo lo que faltaba (la lista de ingredientes, el texto del video, la receta del caption). Después seguí con las capas de abajo como siempre.

La receta **alcanza** cuando cada ingrediente importante tiene cantidad (o es legítimamente «a ojo»: sal, pimienta, aceite para engrasar, decoración) y los pasos se entienden de punta a punta. Apenas alcance, dejá de bajar cosas.

1. **Metadatos y subtítulos (capas 1 y 2):** `procesamiento/aojo fetch meta <id> <url>`.
   - Trae `titulo`, `autor`, `descripcion` (en Instagram es el caption), `links` de la descripción, `subtitulos.texto` (solo YouTube) e `idioma`. Si la fila es de una página web, trae directamente `web` (capa 3).
   - Si falla, andá a §1.4.
2. **Web externa (capa 3):** si la descripción remite a una receta escrita («RECIPE ⬇️», «receta completa en…», un link a un blog), consultala **siempre**, aunque los subtítulos parezcan completos, porque suele tener las cantidades exactas: `procesamiento/aojo fetch web <link> --id <id>`. Si `receta` viene armada (JSON-LD), usala; si no, leé `texto`. Si la página bloquea la descarga, probá con WebFetch.
3. **Audio (capa 4):** si todavía faltan cantidades o pasos, `procesamiento/aojo fetch audio <id>` y después `procesamiento/aojo transcribe <id>`. En Instagram, el caption suele tener los ingredientes y el audio los pasos. Si viene `sin_voz: true`, es un video con música: pasá a la capa 5.
4. **Fotogramas (capa 5):** si todavía falta algo, `procesamiento/aojo fetch video <id>` y después `procesamiento/aojo frames <id>`. Leé los mosaicos con Read: cada uno trae `segundos`, en orden de izquierda a derecha y de arriba abajo. Buscá el texto sobreimpreso (cantidades, temperaturas, tiempos).
5. **Capturas (capa 6):** las de arriba. Si `fetch meta` falla con `login` o `privado` pero las capturas alcanzan, armá la receta con ellas: `titulo` y `autor` salen de las capturas (si no se ve el autor, dejalo vacío) y `fuente_url` es la de la fila. Sumá `capturas` a `origen_datos`.

### 1.3 Armar y guardar la receta

1. **Foto:** `procesamiento/aojo fetch foto <id>` (en un Short usa la miniatura vertical). Miralá con Read. Si no se ve el plato (una cara, una placa con texto, algo crudo), elegí un cuadro del plato terminado con `procesamiento/aojo fetch foto <id> --segundo N` (necesita el video; los segundos salen de los mosaicos), si vino de la web `--url <receta.imagen>` o, si una captura muestra el plato, `--archivo <dir>/capturas/N.jpg`. Si no hay ninguna imagen del plato, guardala sin foto (no mandes una captura de texto).
2. **Receta:** escribí `<dir>/receta.json` con Write. `dir` es el que devolvió `fetch meta` (`~/.a-ojo/trabajo/<id>`). El formato está en §2.
3. **Relectura antes de guardar:** volvé a leer la descripción entera (y la receta de la web, si hubo) **línea por línea**. Por cada dato, comprobá que esté en `receta.json`: cantidades, técnicas, advertencias, variantes, rinde, conservación (freezer, heladera, cuántos días) y sugerencias para servir. Hacé lo mismo con lo que se dice en el audio o en los subtítulos. Si falta algo, sumalo antes de mandar.
4. **Guardar:** `procesamiento/aojo api upsert <id>`. Manda la receta y la foto, y deja la fila en `lista`. Si responde `receta_invalida`, los `detalles` dicen qué corregir: arreglá `receta.json` y volvé a mandar.

### 1.4 Cuando algo falla

| `error` | Qué hacer |
|---|---|
| `login`, `privado` | Si la fila tiene capturas y alcanzan, seguí con ellas (§1.2). Si no, `api actualizar <id> ayuda --motivo "<motivo del JSON>"` |
| `no_disponible` | `ayuda` con «El video ya no está disponible.» |
| `limite` | La fila vuelve a `pendiente`. **Cortá la corrida**: la plataforma está limitando. Avisá que conviene esperar un rato |
| `red` | La fila vuelve a `pendiente` y cortá la corrida |
| `cookies` | La fila vuelve a `pendiente`. Salteá el resto de Instagram en esta corrida y pedí que corran `procesamiento/aojo fetch cookies` en la Terminal (`docs/perfil-instagram.md`). No lo corras vos: macOS no te deja leer Chrome |
| cualquier otro | Si `intentos` < 3, la fila vuelve a `pendiente`. Si no, `ayuda` con un motivo legible |

Si el video **no es una receta** o, después de todas las capas, no se puede saber ni qué lleva, pasala a `ayuda`: «No encontré la receta en el video. Mandá 2 o 3 capturas.» Si solo faltan algunas cantidades, **no** es `ayuda`: guardala con confianza `baja`.

Si ya tenía capturas y no alcanzan, el motivo dice qué falta: «Las capturas no muestran los ingredientes. Mandá una de la lista.» (las capturas nuevas se suman a las anteriores).

Los motivos de `ayuda` los leen ellos en la app: en rioplatense, cortos y diciendo qué hacer.

## 2. Formato de `receta.json`

```json
{
  "titulo": "Budín de limón",
  "tipo": "dulce",
  "etiquetas": ["rápida", "freezable"],
  "porciones": 8,
  "tiempo_min": 60,
  "molde": "budinera de 25 cm",
  "autor": "@cuenta",
  "fuente_url": "<la url de la fila de la bandeja>",
  "confianza": "alta",
  "origen_datos": ["descripcion", "subtitulos"],
  "idioma_original": "es",
  "notas_proceso": "Subtítulos: «harina 4» → harina 0000. Porciones estimadas por el molde.",
  "ingredientes": [
    { "seccion": "", "rol": "principal", "cantidad": 3, "unidad": "u", "nombre": "huevos", "nota": "", "gondola": "lácteos y huevos" },
    { "seccion": "", "rol": "principal", "cantidad": 200, "unidad": "g", "nombre": "azúcar", "nota": "", "gondola": "almacén" },
    { "seccion": "", "rol": "principal", "cantidad": 1, "unidad": "u", "nombre": "limón", "nota": "ralladura y jugo", "gondola": "verdulería" },
    { "seccion": "", "rol": "condimento", "cantidad": null, "unidad": "a ojo", "nombre": "sal", "nota": "una pizca", "gondola": "almacén" },
    { "seccion": "", "rol": "utensilio", "cantidad": null, "unidad": "a ojo", "nombre": "papel manteca", "nota": "para forrar la budinera", "gondola": "otros" }
  ],
  "pasos": [
    { "texto": "Precalentá el horno a 180 °C.", "timer_min": null, "tip": "" },
    { "texto": "Batí los huevos con el azúcar hasta que estén espumosos.", "timer_min": 5, "tip": "Cuanto más aire, más esponjoso queda." },
    { "texto": "Horneá 40 minutos, hasta que un palillo salga seco.", "timer_min": 40, "tip": "" }
  ]
}
```

- `tipo`: `dulce` · `salado` · `sopa` · `bebida` · `otro`.
- `confianza`: `alta` · `media` · `baja` (§3 abajo).
- `origen_datos`: las capas que **aportaron datos**, de `descripcion` · `subtitulos` · `web` · `audio` · `frames` · `capturas`.
- `idioma_original`: código de 2 letras del video (`es`, `en`, `it`…).
- `unidad`: `g` · `kg` · `ml` · `l` · `u` · `cda` · `cdita` · `taza` · `pizca` · `a ojo` · `lata` · `paquete` · `diente` · `ramo`.
- `cantidad` es un número (`0.5`, no «1/2») y va `null` **si y solo si** la unidad es `a ojo`.
- `gondola`: `verdulería` · `almacén` · `lácteos y huevos` · `carnicería` · `panadería` · `congelados` · `otros`.
- `rol`: `principal` · `condimento` · `opcional` · `utensilio` (obligatorio; ver «Secciones y roles» en §3).
- `seccion`: texto corto, o `""` si la receta tiene una sola parte.
- `porciones` y `tiempo_min` pueden ser `null`. `molde`, `nota` y `seccion` pueden quedar vacíos.

## 3. Reglas de estructuración (§6.2 y §6.3)

**Idioma y tono**
- Todo en **castellano rioplatense**. Pasos con voseo: «Batí», «Sumá», «Mezclá», «Horneá», «Dejá reposar», «Precalentá».
- `titulo`: el nombre del plato, corto y claro, no el título del video. «EL BROWNIE PERFECTO te doy todos los tips» → «Brownie húmedo».
- Si el original está en otro idioma, **traducí** todo y poné `idioma_original`.

**Nunca inventar cantidades.** Si una cantidad no aparece en ninguna capa: `cantidad: null`, `unidad: "a ojo"` y la expresión original en `nota` («una pizca», «un chorrito», «a gusto»). `porciones` y `tiempo_min` sí se pueden estimar; si los estimás, decilo en `notas_proceso`.

**Corregir errores de transcripción por contexto** y anotarlos en `notas_proceso`: «harina 4» → harina 0000; «polo para hornear» → polvo de hornear; «baño marío» → baño María; «venilla» → vainilla.

**La descripción no es solo la lista de ingredientes.** Los autores suelen meter indicaciones de técnica entre los ingredientes («preferible port salut porque es más firme», «clave: cocinarlo congelado»). Cada una va al paso donde se aplica. Si el autor la marca como importante («clave», «importante», «el secreto», «no te saltees»), va **como paso propio**, en el orden en que hay que hacerla, no solo en un `tip`. Si la descripción y el audio cuentan el procedimiento distinto, armá los pasos de forma que respeten los dos (por ejemplo, «Si tenés tiempo, congelalas crudas antes de hornear»).

**Orden real de los pasos:** el precalentado del horno va justo antes de que el horno haga falta, no siempre primero (por ejemplo, si antes hay que congelar o marinar).

**Ignorar el relleno:** saludos, pedidos de suscripción, publicidad, menciones de marca innecesarias, anécdotas. Un tip útil del video («mezclá hasta que se disuelvan los cristales de azúcar») va en `tip` del paso al que corresponde.

**Ingredientes**
- `nombre` corto y genérico («manteca», «chocolate semiamargo»). El estado o la preparación van en `nota` («pomada», «picado», «a temperatura ambiente»).
- En el orden en que se usan, agrupados por sección (todos los de la masa, después todos los del relleno).
- Si el video ofrece variantes («o 2 cucharadas de mayonesa»), la principal va como ingrediente y la variante, en la `nota` o en un `tip`.
- Si algo se usa en dos partes (azúcar en la masa y en el almíbar), va dos veces, una en cada sección.

**Secciones y roles** (la ficha agrupa por sección y, dentro de cada una, por rol; ellos verifican de un vistazo que tienen lo infaltable)
- `seccion`: la parte de la receta a la que pertenece el ingrediente, en pocas palabras y con mayúscula inicial: «Masa», «Relleno», «Cobertura», «Almíbar», «Marinada», «Para servir». Usá los nombres de la fuente si los tiene. Si la receta tiene **una sola parte**, todas van vacías. Si tiene secciones, **todos** los ingredientes llevan la suya (salvo los utensilios, que dan igual).
- `rol`:
  - `principal`: lo infaltable, sin eso el plato no sale (la harina y los huevos de una torta, el pollo y la cebolla de un guiso, el aceite de oliva de un hummus).
  - `condimento`: lo que da sabor en poca cantidad y suele estar en la alacena: sal, pimienta, especias, hierbas secas, esencias, ralladuras, y el aceite o la manteca para cocinar o engrasar.
  - `opcional`: lo que la fuente marca como opcional o «si querés», la decoración y lo que es solo para acompañar o servir.
  - `utensilio`: lo que no se come: papel manteca, papel aluminio, film, palitos, bolsa de horno, manga. El molde no: va en `molde`.
- Ante la duda entre `principal` y `condimento`, preguntate si sin eso igual la harías: si sí, es condimento.

**Pasos**
- Frases cortas, un verbo principal por paso, nombrando los ingredientes que se usan (el modo cocina los muestra por paso).
- Temperatura y tiempo explícitos («Horneá a 180 °C durante 25 minutos»).
- `timer_min` cuando el paso tiene una espera o una cocción con tiempo.

**Nombres locales:** manteca (no mantequilla), crema de leche (no nata ni heavy cream), harina 0000 (all-purpose flour, harina de trigo común), polvo de hornear (baking powder, levadura química), bicarbonato de sodio, azúcar impalpable (glas, powdered), azúcar mascabo (brown sugar), fécula de maíz o maicena, zapallito (calabacín, zucchini), choclo (elote, corn), porotos (frijoles, judías, beans), frutillas (fresas), palta (aguacate), morrón (pimiento), cebolla de verdeo (green onion), maní (cacahuate), durazno, queso crema, esencia de vainilla.

**Unidades de EE. UU. → métricas** (redondeá con sentido: múltiplos de 5 g arriba de 50 g):

| Original | Conversión |
|---|---|
| 1 cup de harina | 125 g |
| 1 cup de azúcar / azúcar mascabo | 200 g |
| 1 cup de azúcar impalpable | 120 g |
| 1 cup de cacao | 85 g |
| 1 cup de avena | 90 g |
| 1 cup de chips de chocolate | 170 g |
| 1 cup de manteca / 1 stick | 225 g / 113 g |
| 1 cup de líquido (leche, agua, aceite, crema) | 240 ml |
| 1 tbsp / 1 tsp | 1 cda / 1 cdita |
| 1 oz / 1 fl oz / 1 lb | 28 g / 30 ml / 450 g |
| °F | °C = (°F − 32) × 5/9, llevado a la temperatura de horno habitual: 325 °F → 160 °C, 350 → 180, 375 → 190, 400 → 200, 425 → 220 |
| pulgadas | cm (8×8 in → 20×20 cm, 9×13 in → 23×33 cm, budinera de 9×5 in → 23×13 cm) |

**Góndolas**
- `verdulería`: frutas, verduras, hierbas frescas, ajo, cebolla, limón, papa.
- `almacén`: harinas, azúcares, aceite, sal, especias, legumbres secas o en lata, arroz, fideos, chocolate, cacao, polvo de hornear, esencias, frutos secos, conservas, salsas, caldos.
- `lácteos y huevos`: manteca, leche, crema, quesos, yogur, huevos, dulce de leche, tapas de empanada y masas frescas.
- `carnicería`: carnes, pollo, pescado, fiambres.
- `panadería`: pan, pan lactal, prepizzas.
- `congelados`: verduras y frutas congeladas, helado.
- `otros`: lo que no sea comida (papel manteca, palitos) o no entre en ninguna.

**Etiquetas** (en minúscula, solo las que apliquen): `rápida` (30 minutos o menos), `freezable`, `vegetariana`, `vegana`, `sin tacc`, `sin horno`, `para invitados`, `económica`, `para llevar`, más alguna libre si ayuda a encontrarla. `sin tacc` va **solo si la fuente lo dice**: para alguien celíaco no alcanza con que los ingredientes parezcan sin gluten.

**Confianza**
- `alta`: ingredientes con cantidades y pasos completos, sacados de texto, subtítulos o un audio claro.
- `media`: hubo que estimar pasos o completar algo por contexto.
- `baja`: faltan cantidades importantes (la app muestra una advertencia).

## 4. Al terminar

Mostrá una tabla con: fila, plato (o el link si no salió), resultado (`lista` / `ayuda` / `pendiente`), confianza, capas usadas y, si corresponde, el motivo. Después, en una línea: cuántas siguen pendientes en la bandeja y que el detalle está en `~/.a-ojo/log/<fecha de hoy>.log`. Si fue `--dry-run`, aclaralo: no se escribió nada en la Sheet.

## 5. `--clasificar`: recetas ya guardadas

Completa `seccion` y `rol` de recetas guardadas antes de que existieran, **sin reprocesarlas**: no cambia nada más de la receta (nombres, cantidades, pasos, foto), y las ediciones que hayan hecho ellos en la app se conservan.

1. `procesamiento/aojo api sin-clasificar`. Si no hay recetas, decilo en una línea y terminá.
2. Por cada receta, de a una:
   1. `procesamiento/aojo api ingredientes <receta_id>`: trae los ingredientes con su `id`, los pasos, `notas_proceso` y el `archivo` donde va la clasificación.
   2. Decidí sección y rol de cada ingrediente con las reglas de §3. Los pasos ayudan a ver las partes («Para el relleno…», «Mientras tanto, el almíbar»). Si no sabés si algo era opcional para el autor, mirá la descripción con `procesamiento/aojo fetch meta <bandeja_id> <fuente_url>` (solo metadatos; no bajes audio ni video).
   3. Escribí el `archivo` con Write: `{"ingredientes": [{"id": "i_…", "seccion": "", "rol": "principal"}, …]}`, con **todos** los ingredientes de la receta.
   4. `procesamiento/aojo api clasificar <receta_id>` (con `--dry-run` si la corrida es de prueba).
3. Al terminar, mostrá una tabla por receta: secciones (o «una sola parte») y, por rol, los ingredientes que no son `principal`. Así se revisa rápido.
