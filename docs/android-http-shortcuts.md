# Guardar recetas desde Android con HTTP Shortcuts

Con esto, guardar un Reel queda en 3 toques: **Compartir → HTTP Shortcuts → listo**. Aparece un aviso breve ("✓ Guardada" o "Ya estaba guardada") y el link entra en la bandeja.

La app puede estar en castellano o en inglés. Cada opción aparece así: **Castellano** (*English*).

## Qué necesitás

- La **URL del web app**: la que termina en `/exec`. Está en el `.env` de la Mac (`A_OJO_API_URL`).
- El **token**: también está en el `.env` (`A_OJO_TOKEN`).

Para no tipearlos en el celular, mandátelos por un canal privado (un chat con vos misma o un mail) y copialos desde ahí. Cuando termines, borrá ese mensaje.

## 1. Instalar la app

En Play Store buscá **HTTP Request Shortcuts**, del desarrollador **Waboodoo**, o entrá directo desde el celular:
<https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts>

Es gratis y no tiene publicidad. Ya instalada, en el celular y en el menú Compartir aparece como **HTTP Shortcuts**. También está en F-Droid: <https://f-droid.org/packages/ch.rmy.android.http_shortcuts/>.

## 2. Crear las dos variables

En la pantalla principal: menú **⋮** → **Variables** (*Global Variables*) → **+** → **Variable estática** (*Static Variable*).

**Variable 1: el token**
- **Nombre** (*Name*): `token_a_ojo`
- Valor: pegá el token.
- Marcá **Treat value as secret**, para que no se vea en pantalla ni en el historial.
- Guardá.

**Variable 2: lo que se comparte**
- **Nombre** (*Name*): `texto_compartido`
- Valor: dejalo vacío.
- En **Configuración avanzada** (*Advanced Settings*), marcá **Permitir 'Compartir…'** (*Allow Receiving Value from Share Dialog*).
- En **Datos a recibir por compartir** (*Data to Receive from Sharing*), elegí **Sólo texto** (*Text only*).
- Guardá.

## 3. Crear el atajo "Guardar receta"

Volvé a la pantalla principal → **+** → atajo HTTP normal (*Regular HTTP Shortcut*).

**Datos básicos**
- Nombre: `Guardar receta`. Si querés, elegí un ícono.

**Configuración de solicitud básica** (*Basic Request Settings*)
- **Método** (*Method*): `POST`
- **URL**: la del web app, con esto agregado al final:
  ```
  ?action=capturar&formato=texto
  ```
  Queda algo así: `https://script.google.com/macros/s/AKfy…/exec?action=capturar&formato=texto`

**Cuerpo de solicitud** (*Request Body / Parameters*)
- **Solicitar tipo de cuerpo** (*Request Body Type*): **Parámetros (x-www-form-urlencoded)** (*Parameters (x-www-form-urlencoded)*)
- Agregá tres parámetros con el botón **+**:

  | Parámetro (*Parameter Name*) | Valor (*Value*) |
  |---|---|
  | `url` | la variable `texto_compartido` |
  | `quien` | `pareja` |
  | `t` | la variable `token_a_ojo` |

  Para poner una variable en un valor, tocá el botón **{ }** al lado del campo y elegila. Queda marcada con color.

  > Usamos form-urlencoded, y no JSON, porque así la app codifica el texto compartido. Si Instagram suma comillas o saltos de línea, no rompe nada.

**Manejo de respuesta** (*Response Handling*)
- **Tipo de pantalla** (*Display Type*): **Tostada Popup** (*Toast Popup*). Es el aviso breve que se va solo.
- **Sobre el éxito** (*On Success*): **Mostrar la respuesta** (*Show the response*). La API responde directamente "✓ Guardada" o "Ya estaba guardada".
- **Sobre el fracaso** (*On Failure*): **Mostrar un simple mensaje de error** (*Show a simple error message*).

**Ajustes de activación y ejecución** (*Trigger & Execution Settings*)
- Que **no** esté marcado "pedir confirmación antes de ejecutar" (*Require confirmation before execution*): nada de diálogos.
- Marcá **Espere la conexión cuando esté desconectado** (*Wait for connection when offline*): si no hay señal, el link se manda solo cuando vuelve.
- Opcional, en Android 11 o más nuevo: **Mostrar como acceso directo a aplicación en el launcher** (*Show as app shortcut on launcher*). Así "Guardar receta" también aparece como destino directo en la hoja de Compartir, y se ahorra un toque.

**Configuraciones técnicas avanzadas** (*Advanced Technical Settings*)
- Verificá que **Seguir los redireccionamientos** (*Follow redirects*) esté activado. Viene así por defecto y es necesario: Google responde con una redirección.

Guardá el atajo (✓ arriba a la derecha).

## 4. Probar

1. En Instagram, abrí un Reel → **Compartir** → **Compartir en…** → **HTTP Shortcuts**.
   - Como hay un solo atajo que recibe texto compartido, se ejecuta directo. Si en el futuro hubiera más, la app pregunta cuál usar.
2. Tiene que aparecer **"✓ Guardada"**.
3. Compartí el mismo Reel otra vez: tiene que decir **"Ya estaba guardada"**.
4. En la Sheet "A ojo — datos", hoja **Bandeja**: una sola fila `pendiente`, con `quien = pareja`.

## Si algo falla

| Qué pasa | Qué hacer |
|---|---|
| El aviso dice "Token inválido. Revisá la configuración." | El token de `token_a_ojo` no coincide con el de la API. Volvé a copiarlo del `.env` de la Mac. Si se rotó el token, hay que actualizarlo acá también. |
| El aviso muestra HTML o texto largo raro | La URL no es la del web app o le falta `/exec`. También puede ser que **Seguir los redireccionamientos** esté apagado. |
| "No encontré un link en lo que mandaste." | Lo compartido no tenía un link. Revisá que `url` use la variable `texto_compartido` y que esa variable tenga marcado **Permitir 'Compartir…'**. |
| HTTP Shortcuts no aparece en Compartir | Revisá **Permitir 'Compartir…'** en `texto_compartido`. Después cerrá y volvé a abrir Instagram. |
| "La planilla está ocupada…" | Justo se estaba guardando otra cosa. Compartilo de nuevo en unos segundos. |

Para ver la respuesta completa y depurar: en **Manejo de respuesta**, cambiá temporalmente **Tipo de pantalla** a pantalla completa (*Fullscreen Window*) y marcá **Show Meta Information**.
