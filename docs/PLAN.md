# A ojo — Plan

Sale de la §9 de `SPEC_v1.md`, que sigue siendo la fuente de verdad: si cambia una fase, se cambia primero ahí. Cada fase termina con una demo y un commit. Una casilla se marca apenas se termina la tarea.

## Fase 1: datos y captura

- [x] Sheet con las hojas y encabezados de §3, armada por `setup()`
- [x] API con `capturar`, `todo`, `bandeja.*` y el token
- [x] Extensión de Chrome
- [x] Guía para configurar HTTP Shortcuts en Android
- [x] Demo: un Reel compartido desde el celular y un Short guardado desde Chrome quedan `pendiente`, sin duplicados

## Fase 2: procesamiento

- [x] Scripts de Python (`fetch.py`, `transcribe.py`, `frames.py`) y el comando `/recetas`
- [x] `receta.upsert` y copia de miniaturas a Drive
- [x] Demo: los 8 casos de §6.5 dan el resultado esperado

## Fase 3: app (lectura y cocina)

- [x] PWA con Biblioteca, Ficha y Modo cocina, caché offline e instalación
- [x] Configuración con un link
- [x] Demo: Laura la instala en Android, la abre sin conexión y cocina una receta de punta a punta

## Fase 4: ficha, compras y bandeja

### 4a: ficha

- [x] Secciones y roles de los ingredientes: los asigna `/recetas`, y las recetas viejas se completan con `/recetas --clasificar`
- [x] Editor de ingredientes (rol y sección), estados, valoración, notas, vistas de porciones y «¿Cómo salió?»
- [x] Cola offline de las ediciones
- [x] Demo: sin conexión, un celular cambia un rol, cocina para otras porciones y guarda «¿Cómo salió?»; al volver la conexión, el otro celular lo ve

### 4b: compras y bandeja

- [x] Lista de compras por lugar: paso para elegir, mover, reglas de `Lugares` y envío por WhatsApp
- [x] Navegación inferior y pantalla Bandeja con la subida de capturas; capa 6 de `/recetas`
- [x] Demo: arman la compra de 3 recetas, con un opcional y un ítem movido, y la mandan por WhatsApp
- [ ] Demo: una fila en «Necesita ayuda» se resuelve subiendo capturas desde el celular y corriendo `/recetas`

## Fase 5: pulido

- [x] Logo e íconos, también los de la extensión
- [x] Pantallas vacías y primera carga
- [x] Microanimaciones que respetan «reducir movimiento»
- [x] Revisión de accesibilidad (AA) y test de contraste en los dos modos
- [x] Modo oscuro según el sistema
- [ ] Demo formal en Android: instalada de cero, en modo oscuro y con «quitar animaciones»

## Fase 6: correcciones, infraestructura y funciones nuevas

### 6.1 Correcciones y riesgos

- [x] Cola offline: estado esperado (`desde`) en `bandeja.actualizar`
- [x] Timers con la app en segundo plano: investigado; queda solo el aviso
- [x] Fotos: la alternativa `lh3` preparada en `urlImagen_()`
- [ ] Fotos: medir en el celular cuánto ocupa la caché con `navigator.storage.estimate()`
- [ ] Links `/share/` de Instagram: no canonizarlos (pendiente hasta que aparezca uno real)
- [x] `bandeja.tomar`: dos corridas de `/recetas` no toman la misma fila
- [x] Capturas a la papelera de Drive cuando la fila queda `lista`
- [x] `procesamiento/aojo` valida el subcomando antes de buscar el venv
- [x] SPEC al día: `notas_proceso`, `ping`, comentarios de YouTube, posts de fotos y yt-dlp en el venv
- [x] Colores de relleno de las fotos como tokens
- [x] Diálogo con el estilo de la app en lugar de `confirm()`
- [x] Una versión nueva no recarga con una nota o ingredientes a medio escribir
- [x] `api fila` lee una sola fila con `bandeja.fila`
- [x] `scripts/servir.js` escucha solo en `127.0.0.1`

### 6.2 Infraestructura y proceso

- [x] Tests en GitHub Actions; Pages publica solo si pasan
- [x] `npm run deploy` más seguro: tests antes y `ping` después
- [x] Backup semanal de la Sheet en «A ojo/backups»
- [x] Permisos de `/recetas` en `.claude/settings.json`, versionado
- [x] `setup.sh` también en Linux con apt (WSL 2)
- [x] Cookies de Instagram desde Firefox, también el de Windows desde WSL 2
- [x] Guía `docs/procesar-en-windows.md`
- [ ] Prueba real de `/recetas` en la computadora de Laura

### 6.3 Funciones nuevas

- [ ] Compartir directo a A ojo: `share_target` y «Pegar un link» en la Bandeja (implementado y revisado; falta la prueba en Android, que incluye compartir y volver enseguida a Instagram para ver si el link llega igual a la Sheet)
- [ ] «Algo está mal en esta receta»: pedir que se reprocese con un texto que `/recetas` lee como instrucción (implementado; falta desplegar la API 0.7.0 y la demo. Orden: `npm run deploy`, `setup()` en el editor y recién después el push a `main`, así ningún pedido traba la cola)
- [ ] Quién escribió cada nota: un mapa de nombres (`camilo` → Camilo, `pareja` → Laura)
- [ ] Pasos con sus ingredientes explícitos (columna nueva en `Pasos`)
- [ ] «Cómo se armó» en la ficha: `notas_proceso`, plegado
- [ ] Compartir una receta por WhatsApp
- [ ] Editar y borrar notas
- [ ] Volver a agregar una receta a compras sin perder lo marcado
- [ ] Pendientes de v2: «¿Qué cocino hoy?» simple, exportación a Obsidian y, si se revisa la decisión, `/recetas` programado

### 6.4 Forma de trabajo

- [ ] `/recetas` con `model: sonnet`: comparar 3 o 4 recetas con Opus antes de dejarlo fijo

### Demo de la Fase 6

- [ ] Un «Descartar» mandado sin conexión sobre una fila que ya está `lista` vuelve con aviso y no la cambia
- [x] Los tests corren en GitHub Actions y un test que falla frena la publicación
- [x] `npm run deploy` termina con un `ping` que responde
- [ ] Hay al menos un backup semanal en Drive
- [ ] Un Reel compartido desde Instagram a la app instalada aparece en la Bandeja
- [ ] Un pedido de «Algo está mal» se resuelve corriendo `/recetas`
- [ ] Las notas muestran quién las escribió («Laura», «Camilo»)
- [ ] Laura corre `/recetas` en su computadora y la receta llega a la app
- [ ] Dos corridas a la vez no toman la misma fila
- [ ] La SPEC describe lo que hace el código
