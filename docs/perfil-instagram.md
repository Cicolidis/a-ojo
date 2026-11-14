# Perfil de navegador para procesar Instagram

Para bajar Reels, `/recetas` usa las cookies de la **cuenta secundaria de Instagram**, nunca las de la cuenta principal. Esas cookies salen de un perfil de navegador aparte, que solo se usa para eso. Hay que armarlo **una sola vez en cada computadora** donde se corra `/recetas`.

En la Mac se usa **Chrome**; en la computadora de Laura (Windows, con `/recetas` dentro de WSL 2), **Firefox**: en Windows, Chrome cifra las cookies de una forma que yt-dlp no puede leer. Ver [Con Firefox](#con-firefox-windows-con-wsl-2).

## Con Chrome (la Mac)

1. Abrí Chrome y tocá tu foto o el ícono de perfil, arriba a la derecha.
2. Elegí **Agregar** (o **Agregar perfil de Chrome**).
3. Tocá **Continuar sin cuenta**. No hace falta una cuenta de Google.
4. Ponele de nombre **A ojo – procesamiento**, elegí un color si querés y tocá **Listo**. Se abre una ventana nueva con ese perfil.
5. En esa ventana, entrá a <https://www.instagram.com> e **iniciá sesión con la cuenta secundaria**.
6. Revisá que la cuenta figure como **mayor de 18**: Instagram oculta algunos Reels a las cuentas de menores.
7. Abrí <https://www.instagram.com/reel/Dai7vRBSXvl/> en esa misma ventana. Si se ve el Reel, el perfil está listo.
8. Cerrá la ventana **sin cerrar la sesión de Instagram**.

En el `.env` (ya viene así en `.env.example`):

```
A_OJO_COOKIES_NAVEGADOR=chrome
A_OJO_COOKIES_PERFIL="A ojo – procesamiento"
```

El nombre tiene que coincidir con el del perfil. Da igual si escribís el guion largo (–) o uno común (-), y también da igual usar mayúsculas o minúsculas.

## Exportar las cookies en la Mac (desde la Terminal)

macOS no deja que la app de Claude lea la carpeta de Chrome (aparece «Operation not permitted»). Por eso, las cookies se copian **una vez** a un archivo, desde la app Terminal:

1. Abrí **Terminal** (no la de Claude) y andá a la carpeta del repo, por ejemplo `cd ~/Downloads/claude/app_RECETAS`.
2. Corré:

   ```bash
   procesamiento/aojo fetch cookies
   ```

3. Si macOS pregunta si Terminal puede acceder a datos de otras apps, tocá **Permitir**.
4. Si pregunta si `python` puede usar el llavero «Chrome Safe Storage», escribí la contraseña de la Mac y elegí **Permitir siempre**. Lo pide porque las cookies de Chrome están encriptadas.
5. Tiene que terminar con «✓ Cookies exportadas: se ve el Reel restringido.»

Las cookies quedan en `~/.a-ojo/cookies-instagram.txt`, que solo puede leer tu usuario. Ese archivo da acceso a la cuenta secundaria: no lo compartas ni lo subas al repo, que de todos modos no lo incluye. yt-dlp lo actualiza cada vez que lo usa. Si Instagram cierra la sesión, volvé a entrar en el perfil y repetí este paso.

Si no existe el archivo, `/recetas` intenta leer las cookies directamente del perfil. Eso solo funciona si Claude Code corre desde una Terminal que tenga ese permiso.

## Con Firefox (Windows con WSL 2)

Firefox se instala y se usa **en Windows**, como siempre. `/recetas` corre dentro de WSL 2 y lee las cookies desde el disco de Windows (`/mnt/c/Users/<tu usuario>/AppData/Roaming/Mozilla/Firefox`). Las de Firefox no están cifradas, así que no hace falta ningún permiso.

1. En Firefox, escribí `about:profiles` en la barra de direcciones.
2. Tocá **Crear un nuevo perfil** → **Siguiente**, ponele de nombre **A ojo – procesamiento** y tocá **Finalizar**. No lo marques como predeterminado.
3. En la lista, buscá el perfil nuevo y tocá **Iniciar perfil en un nuevo navegador**.
4. En esa ventana, entrá a <https://www.instagram.com> e **iniciá sesión con la cuenta secundaria** (nunca con la tuya).
5. Revisá que la cuenta figure como **mayor de 18**.
6. Abrí <https://www.instagram.com/reel/Dai7vRBSXvl/> en esa misma ventana. Si se ve el Reel, el perfil está listo.
7. **Cerrá Firefox del todo** (todas las ventanas), sin cerrar la sesión de Instagram: Firefox termina de guardar las cookies recién al cerrarse.

En el `.env` (dentro de WSL):

```
A_OJO_COOKIES_NAVEGADOR=firefox
A_OJO_COOKIES_PERFIL="A ojo – procesamiento"
```

Con el nombre alcanza: `/recetas` busca el perfil en el `profiles.ini` de Firefox (el de Windows, si corre en WSL). Si tenés más de un usuario de Windows con Firefox, o el perfil está en otro lado, poné la ruta de la carpeta del perfil en `A_OJO_COOKIES_PERFIL`, o la carpeta de Firefox en `A_OJO_FIREFOX_DIR`.

Después, con Firefox cerrado, exportá las cookies una vez desde la terminal de Ubuntu, en la carpeta del repo:

```bash
procesamiento/aojo fetch cookies
```

Tiene que terminar con «✓ Cookies exportadas: se ve el Reel restringido.» Quedan en `~/.a-ojo/cookies-instagram.txt`, dentro de WSL. Si Instagram cierra la sesión, abrí el perfil, volvé a entrar, cerrá Firefox y repetí este paso.

## ¿Puede ser otro navegador?

Sí: yt-dlp también lee las cookies de **Brave, Edge y Chromium** (en la Mac o en Linux). Armá ahí un perfil aparte con la cuenta secundaria y cambiá `A_OJO_COOKIES_NAVEGADOR` y `A_OJO_COOKIES_PERFIL` en el `.env`.

**Safari no sirve:** yt-dlp lee las cookies de Safari en general, sin distinguir perfiles, así que usaría la sesión con la que entrás vos todos los días.

## Si algo falla

- **«No encontré el perfil…»:** el nombre del `.env` no coincide con ninguno. El mensaje lista los perfiles que existen.
- **En WSL, «Instagram pide iniciar sesión» justo después de entrar:** Firefox seguía abierto y no había guardado las cookies. Cerralo del todo y repetí `procesamiento/aojo fetch cookies`.
- **«No pude leer las cookies…»:** corré `procesamiento/aojo fetch cookies` en la Terminal (arriba). Si ahí también falla, cerrá Chrome del todo (⌘Q) y probá de nuevo, o revisá el permiso en *Acceso a Llaveros → Chrome Safe Storage → Control de acceso*.
- **«Instagram pide iniciar sesión»:** la sesión venció. Abrí el perfil, volvé a entrar a Instagram, repetí `procesamiento/aojo fetch cookies` y reprocesá la fila con `/recetas <id>`.

Para probar qué pasa **sin** la cuenta secundaria: `/recetas <id> --dry-run --sin-cookies`.
