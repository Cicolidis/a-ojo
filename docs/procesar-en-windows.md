# Correr `/recetas` en Windows (WSL 2)

Esta guía es para la computadora de Laura. `/recetas` corre dentro de **WSL 2**, un Ubuntu que vive adentro de Windows, con la **cuenta de Claude Code de Laura**. Los scripts de `procesamiento/` corren ahí igual que en la Mac.

Se hace **una sola vez**. Lleva una media hora, casi toda esperando descargas (el modelo de Whisper pesa unos 500 MB).

Las dos computadoras pueden procesar a la vez: cada fila se reserva al tomarla (`bandeja.tomar`), así que nunca procesan la misma.

## 1. Instalar WSL 2 con Ubuntu

1. Abrí el menú Inicio, buscá **PowerShell**, hacé clic derecho y elegí **Ejecutar como administrador**.
2. Escribí:

   ```powershell
   wsl --install
   ```

3. Cuando termine, **reiniciá** la computadora.
4. Después del reinicio se abre **Ubuntu** solo (si no, buscalo en el menú Inicio). Te pide un **usuario** y una **contraseña**: elegí los que quieras y anotá la contraseña, porque `setup.sh` la pide para instalar programas. Al escribirla no se ve nada en pantalla: es normal.

Desde ahora, todo lo que sigue se escribe en la ventana de **Ubuntu**, no en PowerShell.

## 2. Bajar el repo (en el disco de WSL)

```bash
cd ~
git clone https://github.com/Cicolidis/a-ojo.git
cd a-ojo
```

El repo tiene que quedar en el disco de WSL (`~/a-ojo`), **no** en `/mnt/c/…` (el disco de Windows): ahí todo anda muchísimo más lento, y `setup.sh` frena si lo detecta.

## 3. Configurar el `.env`

```bash
./setup.sh
```

La primera vez crea el `.env` y se detiene. Abrilo con:

```bash
nano .env
```

Completá:

| Variable | Valor |
|---|---|
| `A_OJO_API_URL` | la URL de la API: te la pasa Camilo **por privado** |
| `A_OJO_TOKEN` | el token: te lo pasa Camilo **por privado** |
| `A_OJO_COOKIES_NAVEGADOR` | `firefox` |
| `A_OJO_COOKIES_PERFIL` | `"A ojo – procesamiento"` |

Dejá vacíos `A_OJO_CLASP_USER` y `A_OJO_DEPLOYMENT_ID`: son para desplegar la API, y eso se hace solo desde la Mac. Guardá con **Ctrl+O**, **Enter**, y salí con **Ctrl+X**.

El `.env` tiene el token: no lo compartas ni lo subas a ningún lado (el repo ya lo ignora).

## 4. Correr `setup.sh`

```bash
./setup.sh
```

Instala ffmpeg (con `apt`, te pide la contraseña de Ubuntu) y uv, crea el entorno de Python con yt-dlp y faster-whisper, baja el modelo de Whisper y prueba la conexión con la API. Tiene que terminar con «Listo».

Si dice que faltan las cookies de Instagram, seguí con el paso 5 y después volvé a correrlo.

## 5. El perfil de Firefox con la cuenta secundaria

En Windows, `/recetas` usa **Firefox** (Chrome cifra las cookies de una forma que no se puede leer). Seguí [Con Firefox (Windows con WSL 2)](perfil-instagram.md#con-firefox-windows-con-wsl-2) en `docs/perfil-instagram.md`: un perfil «A ojo – procesamiento» con la **cuenta secundaria** de Instagram (nunca la tuya) y, con Firefox cerrado:

```bash
procesamiento/aojo fetch cookies
```

## 6. Claude Code adentro de WSL

Instalalo en Ubuntu (no en Windows):

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Cerrá y volvé a abrir Ubuntu. Después, en la carpeta del repo:

```bash
cd ~/a-ojo
claude
```

La primera vez te pide iniciar sesión: usá **tu** cuenta de Claude. Los permisos que necesita `/recetas` ya vienen en el repo (`.claude/settings.json`).

## 7. Probar

En Claude Code, primero una prueba que no escribe nada en la Sheet:

```
/recetas 1 --dry-run
```

Si sale bien (una receta armada y «no se escribió nada en la Sheet»), ya podés procesar de verdad:

```
/recetas
```

Las recetas aparecen en la app de los dos celulares en la próxima sincronización.

## Para actualizar

Cuando Camilo avise que hay cambios:

```bash
cd ~/a-ojo
git pull
./setup.sh
```

## Si algo falla

- **`setup.sh` dice que el repo está en el disco de Windows:** volvé al paso 2 y clonalo en `~`.
- **«Falta A_OJO_API_URL o A_OJO_TOKEN»** o **el ping a la API falla:** revisá el `.env` (paso 3). La URL termina en `/exec`.
- **«No encontré el perfil…» en Firefox:** el nombre del `.env` no coincide; el mensaje lista los que hay. Si Windows tiene varios usuarios con Firefox, poné en `A_OJO_FIREFOX_DIR` la carpeta `/mnt/c/Users/<tu usuario>/AppData/Roaming/Mozilla/Firefox`.
- **«Instagram pide iniciar sesión»:** la sesión de la cuenta secundaria venció o Firefox estaba abierto al exportar. Abrí el perfil, entrá de nuevo, cerrá Firefox y repetí `procesamiento/aojo fetch cookies`.
- **`wsl --install` dice que la virtualización está desactivada:** hay que activarla en la BIOS de la computadora («Virtualization», «VT-x» o «SVM»). Pedile ayuda a Camilo.

No hace falta Node ni clasp: los tests y el deploy de la API se hacen en la Mac.
