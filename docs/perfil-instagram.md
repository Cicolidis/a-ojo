# Perfil de navegador para procesar Instagram

Para bajar Reels, `/recetas` usa las cookies de la **cuenta secundaria de Instagram**, nunca las de la cuenta principal. Esas cookies salen de un perfil de navegador aparte, que solo se usa para eso. Hay que armarlo **una sola vez en cada computadora** donde se corra `/recetas`.

## Con Chrome (recomendado)

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

## Exportar las cookies (desde la Terminal)

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

## ¿Tiene que ser Chrome?

No. yt-dlp también lee las cookies de **Firefox, Brave, Edge y Chromium**. Armá ahí un perfil aparte con la cuenta secundaria y cambiá el `.env`:

```
A_OJO_COOKIES_NAVEGADOR=firefox
A_OJO_COOKIES_PERFIL=nombre-del-perfil
```

En Firefox, el perfil se crea desde `about:profiles`. Como nombre, usá el de la carpeta del perfil que figura ahí, no el nombre visible.

**Safari no sirve:** yt-dlp lee las cookies de Safari en general, sin distinguir perfiles, así que usaría la sesión con la que entrás vos todos los días.

## Si algo falla

- **«No encontré el perfil…»:** el nombre del `.env` no coincide con ninguno. El mensaje lista los perfiles que existen.
- **«No pude leer las cookies…»:** corré `procesamiento/aojo fetch cookies` en la Terminal (arriba). Si ahí también falla, cerrá Chrome del todo (⌘Q) y probá de nuevo, o revisá el permiso en *Acceso a Llaveros → Chrome Safe Storage → Control de acceso*.
- **«Instagram pide iniciar sesión»:** la sesión venció. Abrí el perfil, volvé a entrar a Instagram, repetí `procesamiento/aojo fetch cookies` y reprocesá la fila con `/recetas <id>`.

Para probar qué pasa **sin** la cuenta secundaria: `/recetas <id> --dry-run --sin-cookies`.
