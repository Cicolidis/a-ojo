# A ojo — Spec v2

> Segunda versión de A ojo: planificar la semana (también con los platos de siempre), saber qué hay en casa y escalar las recetas con unidades que se entiendan.
> Documento para llevar a Claude Code. Versión 2 · borrador del 14/11/2026.

`SPEC_v1.md` sigue vigente: todo lo que no cambia acá (arquitectura, datos, API, captura, procesamiento, guía visual y convenciones de `CLAUDE.md`) se mantiene. Las fases siguen la numeración de la v1: arrancan en la 7.

---

## 1. Objetivo y alcance

**Problema:** ya guardamos y cocinamos las recetas, pero cada compra se arma receta por receta, la app no sabe qué hay en casa y al escalar aparecen cantidades raras («0,3 cda», «3,5 huevos»).

**Objetivo de la v2:** decidir qué comemos en la semana, comprar todo de una vez sin repetir lo que ya hay y cocinar con cantidades claras para cualquier número de porciones.

### Entra en la v2
- **Plan semanal:** un calendario con almuerzo y cena para cada día, una fila «Sin día», copiar una semana anterior (igual o como modelo) y la compra de la semana de una sola vez.
- **Recetas propias:** los platos que ya hacemos, sin video ni web. Se crean con el nombre y entran enseguida al plan; si se escribe la receta, `/recetas` la ordena después.
- **Despensa:** lo que hay en casa, compartido por los dos. La usan «¿Qué cocino hoy?», la lista de compras y la compra de la semana.
- **Escalado con conversión de unidades:** cantidades que se pasan a la unidad más cómoda al escalar, sumas de compras entre unidades distintas y avisos sobre el molde y los tiempos.

### Queda afuera
- Más fuentes de recetas (TikTok, Facebook, fotos de libros o del cuaderno, texto pegado).
- Cantidades en la despensa (cuánto hay de cada cosa) y descuento automático al cocinar.
- Un editor de ingredientes y pasos en la app: las recetas propias se completan escribiéndolas en texto libre.
- Fotos propias para las recetas propias (muestran la olla tenue, como cualquier receta sin foto).
- Procesamiento automático de `/recetas` (sigue descartado: se corre a mano).

### Restricciones
Las de la v1: **costo $0**, la Mac no está siempre prendida, todo en **castellano rioplatense** y dos usuarios (Camilo y Laura).

---

## 2. Modelo de datos (hojas nuevas)

Las dos hojas nuevas son chicas: `todo` las manda **siempre enteras**, como `Compras` y `Lugares`. Así los borrados llegan al otro celular sin marcas especiales. Los ids los genera la app, así un reintento de la cola no duplica nada. `setup()` las crea; la app sube `VERSION_DATOS`.

### `Plan`
| Columna | Tipo | Notas |
|---|---|---|
| id | texto | `s_…`, lo genera la app |
| semana | texto | `AAAA-MM-DD` del lunes de esa semana |
| fecha | texto | `AAAA-MM-DD`, el día (sin hora). Vacía: «Sin día» |
| comida | `almuerzo` · `cena` | vacía si no tiene día |
| receta_id | texto | |
| porciones | número | para cuántas se va a cocinar ese día |
| quien | `camilo` · `pareja` | quién la puso |
| creado · actualizado | fecha-hora ISO | |

- En una misma comida puede haber más de una receta (un guiso y una ensalada).
- La misma receta puede estar en varios días.
- «Sin día» (`fecha` y `comida` vacías): un plato que se va a hacer esa semana, sin día decidido. Ahí caen también los platos de «Usar como modelo» (§4.3).
- Los días pasados quedan en la hoja: son el historial del que se copian las semanas (§4.3). El backup semanal borra las entradas de más de **26 semanas**.

### `Despensa`
| Columna | Tipo | Notas |
|---|---|---|
| id | texto | `d_…`, lo genera la app |
| nombre | texto | como lo escribieron («harina 0000», «huevos») |
| desde | fecha-hora ISO | cuándo entró |
| quien | `camilo` · `pareja` | |
| actualizado | fecha-hora ISO | |

- Un nombre se compara con los ingredientes igual que las reglas de `Lugares`: sin tildes ni mayúsculas, tolerando el plural, y valiendo para lo que empieza igual («yogur» vale para «yogur griego»). La función es la misma (`compras.js`).
- No hay dos filas con el mismo nombre comparado así: sumar uno que ya está no hace nada.

### Recetas propias (cambios en hojas que ya existen)
- `Recetas.plataforma` suma el valor `manual`: sin `fuente_url`, con `autor` vacío. `origen_datos` suma la capa `texto` (la receta escrita por ellos) y `confianza` puede quedar vacía mientras no tenga ingredientes.
- `Bandeja` suma la columna `texto`: la receta escrita en la app, para que `/recetas` la ordene. Una fila de una receta propia tiene `plataforma = manual`, `url` vacía y `receta_id` ya cargado.
- La deduplicación por link no aplica a las propias (no tienen link). Dos con el mismo título se permiten.

---

## 3. API (acciones nuevas)

Todas idempotentes, con su caso en `aplicarEdicion()` y su test, como pide `CLAUDE.md`.

| Método | `action` | Entrada | Salida |
|---|---|---|---|
| POST | `plan.poner` | `{items: [{id, semana, fecha?, comida?, receta_id, porciones}]}` (hasta 50) | `{ids}`. Crea o reemplaza cada entrada por id: sirve para sumar, mover (a un día, a la otra comida o a «Sin día») y copiar una semana entera de una vez |
| POST | `plan.quitar` | `{ids}` | `{quitados}` |
| POST | `despensa.sumar` | `{items: [{id, nombre}]}` | `{ids, nuevos}`. Los que ya estaban (por id o por nombre) no se tocan |
| POST | `despensa.quitar` | `{ids}` | `{quitados}` |
| POST | `receta.crear` | `{id, titulo, tipo, porciones?, texto?, bandeja_id?, quien}` | `{id, bandeja_id?}`. Crea una receta propia (`plataforma = manual`). Con `texto`, también la fila de la bandeja (`pendiente`) para que `/recetas` la ordene. Los ids los genera la app |
| POST | `receta.editar` | `{id, titulo?, tipo?, porciones?}` | `{id}`. Solo para recetas propias: las demás las cambia `/recetas` |
| POST | `receta.escribir` | `{id, texto, bandeja_id}` | `{bandeja_id}`. Escribe (o reescribe) el texto de una receta propia y la deja `pendiente` en la bandeja |

`todo` suma `plan` y `despensa` a su respuesta, siempre enteras.

Cambios en acciones que ya existen:
- `receta.upsert` acepta una receta sin `fuente_url` cuando la receta guardada (por `id` o por el `receta_id` de la fila) es propia; conserva `plataforma = manual` y el título que le pusieron ellos, salvo que el texto diga otro nombre.
- «Algo está mal» (`receta.corregir`) en una receta propia usa su fila de la bandeja (o la crea, sin link): `/recetas` corrige sobre el texto y la receta guardada.

---

## 4. Plan semanal

### 4.1 Pantalla `#/semana`
- Nueva pestaña en la navegación inferior: **Recetas · Semana · Compras · Bandeja**. La cuenta de la pestaña: cuántas comidas tiene la semana.
- Arriba, «Semana del 16/11» con flechas para la anterior y la siguiente. La semana va de lunes a domingo y abre en la actual; hoy se destaca.
- Arriba de los días, la fila **«Sin día»**: los platos de esa semana sin día decidido. Si está vacía, no se muestra (salvo como destino al mover).
- Cada día, en una fila, con **almuerzo** y **cena**. Cada receta muestra su foto chica, el título y las porciones («Pollo marroquí · 4»); tocarla abre la ficha.
- En cada comida (y en «Sin día»), «+» abre el buscador de recetas (el de «Agregar una receta» en Compras: `elegir.js`), que arriba ofrece **«Una receta nuestra»** (§6), y después un paso para elegir las porciones (las de la última vista de esa receta, con −/+).
- Cada entrada se puede **mover** (a otro día, a la otra comida o a «Sin día», con una hoja como la de mover en Compras), **cambiar las porciones** o **quitar**.
- Desde la ficha: **«Sumar a la semana»** (elige día, comida y porciones).
- Si una receta de hoy tiene pasos, su entrada ofrece «Empezar a cocinar» con esas porciones.

### 4.2 Compra de la semana
- «Armar la compra de la semana» (abajo de la pantalla) junta las recetas de los días que **todavía no pasaron** y las de «Sin día». Las recetas propias que todavía no tienen ingredientes se listan aparte: «Sin ingredientes: Milanesas con puré» (con «Escribir la receta»). Si una receta está dos veces, se suman sus porciones.
- Lleva a un paso para elegir, como «Agregar a compras» pero para varias recetas: una sección por receta (plegable), con sus porciones, los principales marcados y los opcionales sin marcar. Lo que está en la **despensa** arranca **desmarcado** con la marca «En casa».
- Guardar llama a `compras.agregar` una vez por receta, con las porciones sumadas: el mismo mecanismo de la v1, que reusa los ids y conserva lo marcado. Una receta que ya estaba en la lista se reemplaza, como hoy.
- Al terminar vuelve a la lista de compras con el aviso «✓ Compra de la semana armada».

### 4.3 Copiar una semana anterior
Dos botones arriba de la semana, **«Repetir una semana»** y **«Usar como modelo»**. Los dos abren primero un selector con las semanas anteriores que tienen algo, de la más nueva a la más vieja, cada una con un resumen («Semana del 2/11 · 6 platos: Croquetas, Pollo marroquí…»). El destino es **la semana que se está mirando** (abre en la actual; así también se puede planificar la próxima).
- **Repetir una semana:** copia las entradas tal cual: el mismo día de la semana, la misma comida y las mismas porciones (las de «Sin día» siguen sin día). Si la semana de destino ya tiene algo, pregunta antes: «Reemplazar lo que hay» o «Sumar a lo que hay».
- **Usar como modelo:** trae los platos de esa semana, con sus porciones, a la fila **«Sin día»** de la semana de destino, sin tocar lo que ya tiene. Después se reparten con «Mover», de a uno y cuando quieran: la fila se guarda y se sincroniza.
- Las dos copias se arman en la app y van en un solo `plan.poner` con ids nuevos (y, al reemplazar, antes un `plan.quitar`): un reintento no duplica nada. Las recetas descartadas desde entonces no se copian; se avisa cuáles quedaron afuera.

### 4.4 Estados vacíos
- Semana vacía: «Todavía no hay nada para esta semana» con «Elegir una receta» y, si hay semanas anteriores, «Repetir una semana».
- Sin recetas para elegir: el estado vacío de la Biblioteca.

---

## 5. Despensa

### 5.1 Pantalla `#/despensa`
- Se llega desde Compras («Lo que hay en casa») y desde «Con lo que tengo» en la Biblioteca.
- Una lista en orden alfabético con «Quitar» en cada ítem y «Sumar algo» arriba (acepta varios separados por coma: «harina, huevos, manteca»).
- Arriba, un aviso corto: «Anotá lo que tenés para que la compra no lo repita».

### 5.2 Cómo se llena y cómo se vacía
- **A mano**, en la pantalla de la despensa.
- **Desde la lista de compras:** «Limpiar marcados» pasa a la despensa lo que se compró (salvo los utensilios), con el aviso «Lo pasé a la despensa» y «Deshacer».
- **Desde «Revisá si tenés»:** marcar «lo tengo» lo suma a la despensa.
- **Al terminar de cocinar:** «¿Cómo salió?» suma una pregunta opcional, «¿Se terminó algo?», con los principales de la receta que están en la despensa como casillas. Lo marcado sale de la despensa.
- La despensa no lleva cantidades ni fechas de vencimiento en la v2.

### 5.3 Dónde se usa
- **Lista de compras:** un ítem que está en la despensa va a «Revisá si tenés» con la marca «En casa», salvo que lo hayan movido a mano. Si se compra igual, queda como está.
- **«¿Qué cocino hoy?»:** «Con lo que tengo» arranca con la despensa (un chip «Usar lo de la despensa», prendido por defecto) más lo que escriban. La lógica de `queCocino()` no cambia: solo recibe más ingredientes.
- **Compra de la semana:** ver §4.2.

---

## 6. Recetas propias

Los platos que ya hacemos, sin video ni web: se cargan rápido para ponerlos en la semana y se completan después, si queremos.

### 6.1 Crear
- **«Nueva receta»** en la Biblioteca (al lado del buscador) y **«Una receta nuestra»** en el buscador de recetas del plan.
- Un formulario corto: **nombre** (obligatorio), **porciones** (−/+, por defecto 4), **tipo** (dulce, salado, sopa, bebida, otro) y, opcional, **«La receta»**: un campo de texto libre donde se escribe como salga («4 milanesas, 1 kg de papa, manteca y leche. Freír las milanesas…»).
- Al guardar, la receta existe enseguida (va por la cola, también sin conexión). Desde el plan, queda puesta en la comida donde se tocó «+».

### 6.2 Cómo se ve
- En la Biblioteca y en la ficha, en lugar del autor dice **«Receta nuestra»**. Un chip de filtro «Nuestras» aparece si hay alguna.
- Sin ingredientes, la ficha muestra «Todavía no escribieron esta receta» con **«Escribir la receta»** (el mismo campo de texto), y no ofrece «Agregar a compras» ni «Empezar a cocinar» (§7.2 de la v1).
- Con el texto escrito y todavía sin procesar: «La Mac la va a ordenar en la próxima corrida», y el texto se ve tal cual, para cocinar igual.
- «Editar» (solo en las propias) cambia el nombre, el tipo y las porciones. Los ingredientes y los pasos se corrigen como cualquier receta: «Algo está mal» o reescribiendo el texto.

### 6.3 En `/recetas`
- Una fila con `plataforma = manual` no baja nada: su única capa es `texto`. Se estructura con las mismas reglas de §6.2 de la v1 (rioplatense, voseo en los pasos, **nunca inventar cantidades**, roles, secciones e ingredientes por paso) y se manda con `receta.upsert` sobre la receta que ya existe.
- Lo que el texto no dice queda «a ojo» y la confianza, en `media` o `baja`, como siempre. `notas_proceso` cuenta qué se dedujo («Las cantidades de la leche y la manteca no estaban: quedaron a ojo»).
- Va en `.claude/commands/recetas.md`, como un caso más de §1.2.

---

## 7. Escalado con conversión de unidades

Todo es lógica pura de la app (`ingredientes.js`, `formato.js`, `compras.js`), con tests. No cambia la API ni la Sheet: la receta guardada queda como la dejó `/recetas`.

### 7.1 Familias de unidades
- **Peso:** `g` · `kg`.
- **Volumen:** `cdita` (5 ml) · `cda` (15 ml) · `taza` (240 ml, la misma equivalencia que usa `/recetas` al convertir cups) · `ml` · `l`.
- **Contables:** `u`, `diente`, `lata`, `paquete`, `ramo`.
- **Sin escala:** `pizca` y `a ojo`. Una pizca escalada sigue siendo «una pizca» (o «2 pizcas» desde el doble, y no más).

### 7.2 Reglas al escalar
- **Volumen:** después de escalar se elige la unidad más cómoda, sin pasar de cucharas a mililitros ni al revés:
  - menos de 1 cda → cditas (½ cda → «1 ½ cditas»), nunca menos de ¼ cdita;
  - de 4 cdas a 1 taza → tazas cuando da una fracción común («4 cdas» → «¼ taza») o si la receta ya decía tazas; si no, cdas enteras o medias;
  - 1 taza o más → tazas;
  - menos de ¼ taza → cdas;
  - ml: desde 1000, litros; y un litro escalado por debajo de 1, en ml.
  - Si el redondeo toca un umbral, se vuelve a elegir (3,9 cdas → «¼ taza»).
- **Peso:** redondeo a gramos (a entero desde 10), kilos desde 1000 y gramos por debajo de 1 kg.
- **Contables:** si la receta dice enteros, se redondea a enteros. Si el resultado cae entre dos números, se muestran los dos: «3 o 4 huevos» («7 u 8» antes del 8). Los dientes de ajo y las latas, igual. Nunca menos de 1. Si la receta usa medios (½ cebolla), se escala de a medios; con otra fracción (¼), al cuarto o al tercio.
- **Fracciones:** solo las comunes (¼, ⅓, ½, ⅔, ¾), como hoy, también en kilos y litros («1 ½ kg»). El plural va con el número que se muestra: «1 ½ cditas», «1 ¼ tazas», pero «1 cda» aunque el cálculo dé 1,005.
- Con las porciones originales, las cantidades quedan como las dejó `/recetas`.

### 7.3 Avisos en la ficha y en el modo cocina
- Con un factor distinto de 1 y la receta con `molde`: «Para 12 porciones, el molde de 20×30 cm no alcanza: usá dos, o uno de unos 28×42 cm» (el área se escala con el factor). Las medidas se leen del texto libre («budinera de 25 cm», «20 x 30»); si dice una cantidad de moldes («2 moldes de 18 cm»), no se puede leer.
  - «usá dos/tres…» solo con un factor entero (o a menos de 0,15 de uno) desde 2; con uno no entero desde 2, «usá dos o tres del mismo tamaño»; entre 1 y 2, «usá uno de unos 24×37 cm».
  - Con menos porciones: «Para 2 porciones alcanza un molde de unos 12×17 cm (la receta usa uno de 20×30 cm)».
  - Si el molde no se puede leer, solo «Revisá el tamaño del molde».
- Con un factor distinto de 1 y pasos con tiempo de horno (no de la hornalla): «Los tiempos de cocción no se escalan: controlá la cocción» (una vez, arriba de los pasos; en el modo cocina, en el primer paso y en los de horno).
- Los dos avisos también van en la receta compartida por WhatsApp.
- Los pasos siguen diciendo las cantidades originales (como hoy), con la aclaración de cuántas porciones son.

### 7.4 Compras
- `sumarCantidades()` suma dentro de cada familia aunque cambie la unidad («1 taza + 4 cdas» → «1 ¼ tazas»; «2 cdas + 1 cdita» → «2 ⅓ cdas»), y muestra el total en la unidad más cómoda con las reglas de §7.2. Si en la suma hay ml o l, el total va en ml o l.
- Entre peso y volumen no se convierte (harina en tazas y en gramos siguen separados: «200 g + 1 taza»).
- Lo que se cuenta se guarda en la lista redondeado para arriba (7,5 huevos → «8»; los medios, al medio de arriba), y el paso para elegir muestra eso mismo.

---

## 8. Fases de desarrollo (para Claude Code)

Cada fase termina con un commit y su tilde en `docs/PLAN.md`. **Las pruebas en dispositivos reales de la Fase 6 y de toda la v2 se juntan en la Fase 11**, al final.

### Fase 7: arrastre de la v1
- **Backup sin script:** `hacerBackup()` hoy copia la planilla con `makeCopy`, que también copia el script ligado: cada semana aparece un proyecto de Apps Script nuevo con el código de la API. Pasar a una planilla nueva con las hojas copiadas una por una (`sheet.copyTo()`), sin script. Sin permisos nuevos.
- **Paridad entre Python y JavaScript:** `procesamiento/obsidian.py` repite el formato de `formato.js` e `ingredientes.js` (cantidades, fracciones, plurales y `NOMBRES`). Un test con los mismos casos de los dos lados, para que no se desfasen. Como la Fase 8 cambia ese formato, va antes.
- **Una sola lista de pendientes:** las specs dicen qué se pide y `docs/PLAN.md` lleva las casillas. Sacar de §9 de `SPEC_v1.md` los estados («hecho», «falta la demo») que hoy repiten lo de `PLAN.md`.
- **Listo cuando:** el backup a mano (`hacerBackup()` en el editor) deja una planilla sin script en «A ojo/backups»; el test de paridad pasa y falla si se cambia un plural de un solo lado.

### Fase 8: escalado con conversión
- §7 completo: familias, reglas, avisos de molde y de cocción, y sumas de compras entre unidades.
- **Listo cuando:** los tests de §7 pasan y, con la API falsa, una receta de 6 porciones llevada a 2 y a 15 se lee sin cantidades raras en la ficha, el modo cocina y la lista de compras.

### Fase 9: despensa
- Hoja `Despensa`, `despensa.sumar` y `despensa.quitar`, `todo` con `despensa`.
- Pantalla `#/despensa` y las entradas desde Compras, «Revisá si tenés», «Limpiar marcados», «¿Cómo salió?» y «Con lo que tengo» (§5).
- **Listo cuando:** con la API falsa, lo que se marca y se limpia en la lista pasa a la despensa; al agregar una receta, lo que está en la despensa aparece en «Revisá si tenés» con «En casa»; y «Con lo que tengo» arranca con la despensa.

### Fase 10a: recetas propias
- `Recetas.plataforma = manual`, la capa `texto`, la columna `Bandeja.texto`; `receta.crear`, `receta.editar` y `receta.escribir`; los cambios en `receta.upsert` y `receta.corregir` (§2 y §3).
- «Nueva receta», «Receta nuestra», el chip «Nuestras», «Escribir la receta» y «Editar» en la app (§6.1 y §6.2).
- El caso `manual` en `/recetas` (§6.3).
- **Listo cuando:** con la API falsa, una receta propia creada sin conexión aparece en la Biblioteca con «Receta nuestra»; con el texto escrito, `/recetas --dry-run` la valida contra la API con ingredientes y pasos, sin inventar cantidades.

### Fase 10b: plan semanal
- Hoja `Plan` (con `semana` y «Sin día»), `plan.poner` (en lote) y `plan.quitar`, `todo` con `plan`, y la limpieza de las 26 semanas en el backup.
- Pantalla `#/semana`, la pestaña nueva, «Sumar a la semana» en la ficha y la compra de la semana (§4.1 y §4.2).
- «Repetir una semana» y «Usar como modelo», con el selector de semanas (§4.3).
- **Listo cuando:** con la API falsa, se arma una semana con 4 comidas (una receta repetida, una entrada movida de día y una receta propia creada desde «+»); «Repetir una semana» la copia igual a la siguiente y «Usar como modelo» deja sus platos en «Sin día» de otra; y la compra de la semana suma las porciones de la repetida, deja desmarcado lo que está en la despensa y avisa de la receta propia sin ingredientes.

### Fase 11: pruebas en dispositivos
Todo lo que pide un celular, la computadora de Laura o la API desplegada. Las de la Fase 6 (y la 4b y la 5) pasan acá: en `docs/PLAN.md`, esas fases dicen «→ Fase 11» y la casilla está solo en esta.
- **De la Fase 6 (y la 4b y la 5):**
  - compartir un Reel desde Instagram a la app instalada, también volviendo enseguida a Instagram;
  - un «Algo está mal» resuelto con `/recetas`;
  - los ingredientes por paso con una receta nueva;
  - Laura corre `/recetas` en su computadora y la receta llega a la app;
  - dos corridas a la vez no toman la misma fila;
  - un «Descartar» mandado sin conexión sobre una fila que ya está `lista` vuelve con aviso;
  - el primer backup semanal (ya sin script) está en Drive;
  - `navigator.storage.estimate()` en el celular: cuánto ocupa la caché de fotos;
  - una fila en «Necesita ayuda» resuelta con capturas desde el celular (4b);
  - la demo de Android de la Fase 5: instalada de cero, en modo oscuro y con «quitar animaciones»;
  - `/recetas` con Sonnet comparado con Opus en 3 o 4 recetas.
- **De la v2:**
  - sin conexión, un celular arma la semana y suma a la despensa; al volver la conexión, el otro lo ve;
  - la compra de la semana armada en un celular aparece en el otro y se manda por WhatsApp;
  - cocinar desde «Hoy» en la semana, con las porciones de ese día, y vaciar algo de la despensa en «¿Cómo salió?»;
  - una receta propia creada en un celular, con el texto escrito, ordenada por `/recetas` (en la Mac o en la computadora de Laura) y vista en el otro celular;
  - «Usar como modelo» en un celular y el reparto de «Sin día» terminado en el otro.
- **Listo cuando:** todas las casillas de la Fase 11 en `docs/PLAN.md` están tildadas o tienen anotado por qué no.

---

## 9. Decisiones

**Tomadas (14/11):**
- Entran el plan semanal, la despensa y el escalado con conversión; las otras fuentes de recetas quedan afuera.
- El plan semanal es un **calendario por día**, con almuerzo y cena, y una fila «Sin día».
- **Recetas propias:** se crean con el nombre y entran enseguida al plan; si se escribe la receta en texto libre, `/recetas` la ordena después. Sin editor de ingredientes en la app.
- **Copiar semanas:** «Repetir una semana» (igual) y «Usar como modelo» (a «Sin día», para repartir), desde cualquier semana guardada, hacia la semana que se está mirando.
- La v2 tiene su propia spec (este documento); `SPEC_v1.md` queda como registro del MVP.
- Las pruebas en dispositivos se juntan al final (Fase 11).
- **Escalado (Fase 8):** 1 taza = 240 ml; lo que se cuenta va de a medios si la receta usa medios (½ cebolla) y, en compras, redondeado para arriba.

**Supuestos de este borrador, para revisar antes de empezar:**
- La semana empieza el lunes, y solo hay almuerzo y cena (sin desayuno ni merienda).
- La navegación pasa a cuatro pestañas, con Semana en segundo lugar.
- La despensa no lleva cantidades y no se descuenta sola al cocinar: se pregunta en «¿Cómo salió?».
- «Limpiar marcados» pasa lo comprado a la despensa (con «Deshacer»), en lugar de preguntar cada vez.
- El historial del plan se guarda 26 semanas (medio año).
- Al repetir sobre una semana que ya tiene algo, se pregunta si reemplazar o sumar.
- «Usar como modelo» trae todos los platos, aunque alguno ya esté en la semana de destino.
- Las recetas propias arrancan en 4 porciones y sin foto.
