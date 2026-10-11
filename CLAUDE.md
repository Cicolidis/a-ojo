# A ojo — notas para Claude Code

La spec es `SPEC_v1.md`; el desarrollo avanza por las fases de su §9. Cada fase termina con una demo y un commit.

## Convenciones

- Todo el texto visible va en **castellano rioplatense** con voseo ("Guardá", "Probá de nuevo"). El código también usa nombres en castellano.
- **Nunca emojis en la interfaz**: íconos SVG de trazo. Los caracteres "✓" y "…" están permitidos, como indica la spec.
- **Ningún secreto en el repo**: probablemente sea público cuando se sume GitHub Pages. El token vive en Script Properties, `.env`, `chrome.storage.local` y el celular.
- Colores y tipografía: §8 de la spec (variante A).

## Apps Script (`apps-script/src`)

- Los archivos se evalúan por separado, en orden alfabético, en un mismo scope global. En el nivel superior, solo constantes literales; si una tabla referencia funciones de otros archivos, se arma dentro de una función (ver `rutas_()`).
- **No existe la clase `URL`**: por eso `Url.js` parsea con regex. `Url.js` también se exporta a Node para los tests.
- Las hojas se leen y escriben **por nombre de columna** (`Hojas.js`). Para sumar una columna: editar `Esquema.js` y volver a correr `setup()` en el editor.
- Las escrituras van dentro de `conLock_()`. Las fechas se guardan como texto ISO, en columnas con formato `@`.
- Acciones nuevas: una función en `Acciones.js`, registrada en `rutas_()` (`Api.js`), con su test en `tests/api.test.js`.
- clasp siempre se corre con `npm run clasp -- …`, que usa la cuenta de `A_OJO_CLASP_USER` (Gmail personal; la sesión por defecto de clasp es otra cuenta).
- Deploy: `npm run deploy` (push + redeploy sobre `A_OJO_DEPLOYMENT_ID`). **Nunca crear un deployment nuevo**: cambiaría la URL `/exec`.

## Tests

- `npm test`: tests de Node, sin dependencias. `tests/fakes/apps-script.js` simula SpreadsheetApp y los demás servicios, incluida la conversión de fechas ISO que hace Sheets cuando una celda no tiene formato de texto.
- `npm run smoke`: prueba contra la API desplegada (necesita el `.env`).
