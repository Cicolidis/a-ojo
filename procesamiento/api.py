"""Cliente de la API de A ojo para /recetas. Lee A_OJO_API_URL y A_OJO_TOKEN del .env.

Uso (por medio de procesamiento/aojo):
  api ping
  api pendientes [--limite N]            filas para procesar, de la más vieja a la más nueva
  api fila <bandeja_id>                  una fila cualquiera de la bandeja
  api capturar <url> [--quien camilo]
  api actualizar <bandeja_id> <estado> [--motivo "…"] [--dry-run]
  api upsert <bandeja_id> [--dry-run]    manda trabajo/<id>/receta.json (y foto.jpg si existe)
  api capturas <bandeja_id>              baja las capturas que subieron desde la app a trabajo/<id>/capturas/
  api sin-clasificar                     recetas con ingredientes sin rol (para /recetas --clasificar)
  api ingredientes <receta_id>           la receta guardada: ingredientes con id, pasos y notas
  api clasificar <receta_id> [--dry-run] manda trabajo/<receta_id>/clasificacion.json

Con --dry-run (o A_OJO_DRY_RUN=1) no escribe nada en la Sheet: «actualizar» no
llama a la API, «upsert» solo valida la receta y «clasificar» solo revisa el archivo.
El token nunca se imprime.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import comun
from comun import fallar, log, salida


class ErrorApi(Exception):
    def __init__(self, codigo, mensaje, detalles=None, status=None):
        super().__init__(mensaje)
        self.codigo, self.mensaje, self.detalles, self.status = codigo, mensaje, detalles, status


def config():
    url = os.environ.get('A_OJO_API_URL', '').strip()
    token = os.environ.get('A_OJO_TOKEN', '').strip()
    if not url or 'XXXX' in url or not token:
        fallar('sin_config', 'Faltan A_OJO_API_URL o A_OJO_TOKEN en el .env.')
    return url, token


def tapar(texto):
    token = os.environ.get('A_OJO_TOKEN')
    return str(texto).replace(token, '***') if token else str(texto)


def llamar(metodo, accion, datos=None):
    """GET con los datos en la query, o POST con JSON como text/plain (sin preflight de CORS).

    Apps Script responde los POST con un 302: urllib lo sigue con GET, como corresponde.
    """
    url, token = config()
    datos = dict(datos or {})
    if metodo == 'GET':
        query = urllib.parse.urlencode({'action': accion, 't': token, **datos})
        pedido = urllib.request.Request(f'{url}?{query}')
    else:
        cuerpo = json.dumps({'action': accion, 't': token, **datos}, ensure_ascii=False).encode('utf-8')
        pedido = urllib.request.Request(url, data=cuerpo, method='POST',
                                        headers={'Content-Type': 'text/plain;charset=utf-8'})
    try:
        with urllib.request.urlopen(pedido, timeout=90) as r:
            texto = r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        raise ErrorApi('http', f'La API respondió HTTP {e.code}.', status=e.code)
    except (urllib.error.URLError, OSError) as e:
        raise ErrorApi('red', tapar(f'No pude conectarme con la API: {getattr(e, "reason", e)}'))
    try:
        respuesta = json.loads(texto)
    except ValueError:
        raise ErrorApi('no_json', 'La API no devolvió JSON (¿el deployment está bien?): ' + tapar(texto[:200]))
    if not respuesta.get('ok'):
        raise ErrorApi(respuesta.get('error'), respuesta.get('mensaje'), respuesta.get('detalles'), respuesta.get('status'))
    return respuesta['data']


def dry_run(args):
    return getattr(args, 'dry_run', False) or os.environ.get('A_OJO_DRY_RUN') == '1'


ROLES = ('principal', 'condimento', 'opcional', 'utensilio')

RESUMEN_FILA = ('id', 'url', 'plataforma', 'quien', 'estado', 'motivo', 'receta_id', 'intentos', 'creado', 'actualizado',
                'capturas')
EXTENSIONES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}


def cmd_ping(_args):
    salida({'ok': True, **llamar('GET', 'ping')})


def cmd_pendientes(args):
    filas = llamar('GET', 'bandeja.pendientes')['filas']
    limite = args.limite if args.limite and args.limite > 0 else len(filas)
    salida({'ok': True, 'total': len(filas), 'filas': [{k: f.get(k) for k in RESUMEN_FILA} for f in filas[:limite]]})


def cmd_fila(args):
    filas = [f for f in llamar('GET', 'todo')['bandeja'] if f.get('id') == args.bandeja_id]
    if not filas:
        fallar('no_encontrada', f'No encontré la fila «{args.bandeja_id}» en la bandeja.')
    salida({'ok': True, 'fila': {k: filas[0].get(k) for k in RESUMEN_FILA}})


def cmd_capturar(args):
    salida({'ok': True, **llamar('POST', 'capturar', {'url': args.url, 'quien': args.quien})})


def cmd_actualizar(args):
    datos = {'id': args.bandeja_id, 'estado': args.estado}
    if args.motivo:
        datos['motivo'] = args.motivo
    if dry_run(args):
        log(args.bandeja_id, 'actualizar', f'(dry-run) {args.estado} {args.motivo or ""}')
        salida({'ok': True, 'dry_run': True, 'id': args.bandeja_id, 'estado': args.estado})
        return
    r = llamar('POST', 'bandeja.actualizar', datos)
    log(args.bandeja_id, 'actualizar', f'{args.estado} (intento {r.get("intentos")}) {args.motivo or ""}')
    salida({'ok': True, **r})


def cmd_upsert(args):
    d = comun.dir_trabajo(args.bandeja_id)
    try:
        receta = comun.leer_json(d / 'receta.json')
    except OSError:
        fallar('sin_receta', f'No encontré {d / "receta.json"}.')
    except ValueError as e:
        fallar('receta_no_json', f'receta.json no es JSON válido: {e}')
    datos = {'receta': receta, 'bandeja_id': args.bandeja_id}
    foto = d / 'foto.jpg'
    if foto.exists():
        datos['foto'] = {'base64': base64.b64encode(foto.read_bytes()).decode('ascii'), 'mime': 'image/jpeg'}
    if dry_run(args):
        datos['validar'] = True
    r = llamar('POST', 'receta.upsert', datos)
    log(args.bandeja_id, 'upsert', ('(dry-run) válida' if dry_run(args) else f'{r.get("id")} '
                                    f'({"nueva" if r.get("nueva") else "actualizada"})'))
    salida({'ok': True, 'dry_run': dry_run(args), **r})


def cmd_capturas(args):
    """Baja las capturas de la fila (capa 6) a trabajo/<id>/capturas/1.jpg, 2.png… Borra las de una bajada anterior."""
    r = llamar('GET', 'capturas.bajar', {'bandeja_id': args.bandeja_id})
    d = comun.dir_trabajo(args.bandeja_id) / 'capturas'
    d.mkdir(exist_ok=True)
    for vieja in d.iterdir():
        vieja.unlink()
    archivos = []
    for n, img in enumerate(r.get('imagenes') or [], 1):
        ruta = d / f'{n}.{EXTENSIONES.get(img.get("mime"), "jpg")}'
        ruta.write_bytes(base64.b64decode(img.get('base64') or ''))
        archivos.append(str(ruta))
    if not archivos:
        fallar('sin_capturas', 'La fila no tiene capturas (o las borraron de Drive).')
    log(args.bandeja_id, 'capturas', f'{len(archivos)} bajadas')
    salida({'ok': True, 'id': args.bandeja_id, 'total': len(archivos), 'archivos': archivos})


def sin_clasificar(todo):
    """Recetas con algún ingrediente sin rol, de la más vieja a la más nueva."""
    sin_rol = {i.get('receta_id') for i in todo['ingredientes'] if not str(i.get('rol') or '').strip()}
    recetas = sorted((r for r in todo['recetas'] if r.get('id') in sin_rol), key=lambda r: r.get('creado') or '')
    return [{'id': r['id'], 'titulo': r.get('titulo')} for r in recetas]


def detalle_receta(todo, receta_id):
    """Lo que hace falta para clasificar los ingredientes de una receta ya guardada."""
    receta = next((r for r in todo['recetas'] if r.get('id') == receta_id), None)
    if not receta:
        fallar('no_encontrada', f'No encontré la receta «{receta_id}».')
    def en_orden(filas):
        return sorted((f for f in filas if f.get('receta_id') == receta_id), key=lambda f: f.get('orden') or 0)
    bandeja = next((b['id'] for b in todo['bandeja'] if b.get('receta_id') == receta_id), None)
    return {
        'receta': {k: receta.get(k) for k in ('id', 'titulo', 'porciones', 'fuente_url', 'notas_proceso')},
        'bandeja_id': bandeja,
        'ingredientes': [{k: i.get(k) for k in ('id', 'cantidad', 'unidad', 'nombre', 'nota', 'seccion', 'rol')}
                         for i in en_orden(todo['ingredientes'])],
        'pasos': [p.get('texto') for p in en_orden(todo['pasos'])],
        'archivo': str(comun.dir_trabajo(receta_id) / 'clasificacion.json'),
    }


def cmd_sin_clasificar(_args):
    recetas = sin_clasificar(llamar('GET', 'todo'))
    salida({'ok': True, 'total': len(recetas), 'recetas': recetas})


def cmd_ingredientes(args):
    salida({'ok': True, **detalle_receta(llamar('GET', 'todo'), args.receta_id)})


def cmd_clasificar(args):
    d = comun.dir_trabajo(args.receta_id)
    try:
        datos = comun.leer_json(d / 'clasificacion.json')
    except OSError:
        fallar('sin_clasificacion', f'No encontré {d / "clasificacion.json"}.')
    except ValueError as e:
        fallar('clasificacion_no_json', f'clasificacion.json no es JSON válido: {e}')
    lista = datos.get('ingredientes') if isinstance(datos, dict) else datos
    if not isinstance(lista, list) or not lista:
        fallar('clasificacion_invalida', 'clasificacion.json tiene que traer la lista «ingredientes».')
    ingredientes = [{'id': i.get('id'), 'seccion': i.get('seccion') or '', 'rol': i.get('rol')}
                    for i in lista if isinstance(i, dict)]
    errores = [f'ingrediente {n}: rol «{i["rol"]}» no es válido' for n, i in enumerate(ingredientes, 1) if i['rol'] not in ROLES]
    errores += [f'ingrediente {n}: falta el id' for n, i in enumerate(ingredientes, 1) if not i['id']]
    if len(ingredientes) != len(lista) or errores:
        fallar('clasificacion_invalida', 'Revisá clasificacion.json: ' + ('; '.join(errores) or 'hay ítems que no son objetos') + '.')
    if dry_run(args):
        log(args.receta_id, 'clasificar', f'(dry-run) {len(ingredientes)} ingredientes')
        salida({'ok': True, 'dry_run': True, 'id': args.receta_id, 'ingredientes': len(ingredientes)})
        return
    r = llamar('POST', 'receta.clasificar', {'id': args.receta_id, 'ingredientes': ingredientes})
    log(args.receta_id, 'clasificar', f'{r.get("ingredientes")} ingredientes')
    salida({'ok': True, **r})


def main(argv=None):
    p = argparse.ArgumentParser(prog='api')
    sub = p.add_subparsers(dest='comando', required=True)
    sub.add_parser('ping').set_defaults(fn=cmd_ping)

    s = sub.add_parser('pendientes')
    s.add_argument('--limite', type=int)
    s.set_defaults(fn=cmd_pendientes)

    s = sub.add_parser('fila')
    s.add_argument('bandeja_id')
    s.set_defaults(fn=cmd_fila)

    s = sub.add_parser('capturar')
    s.add_argument('url')
    s.add_argument('--quien', default='camilo', choices=['camilo', 'pareja'])
    s.set_defaults(fn=cmd_capturar)

    s = sub.add_parser('actualizar')
    s.add_argument('bandeja_id')
    s.add_argument('estado', choices=['pendiente', 'procesando', 'lista', 'ayuda', 'descartada'])
    s.add_argument('--motivo')
    s.add_argument('--dry-run', action='store_true')
    s.set_defaults(fn=cmd_actualizar)

    s = sub.add_parser('upsert')
    s.add_argument('bandeja_id')
    s.add_argument('--dry-run', action='store_true')
    s.set_defaults(fn=cmd_upsert)

    s = sub.add_parser('capturas')
    s.add_argument('bandeja_id')
    s.set_defaults(fn=cmd_capturas)

    sub.add_parser('sin-clasificar').set_defaults(fn=cmd_sin_clasificar)

    s = sub.add_parser('ingredientes')
    s.add_argument('receta_id')
    s.set_defaults(fn=cmd_ingredientes)

    s = sub.add_parser('clasificar')
    s.add_argument('receta_id')
    s.add_argument('--dry-run', action='store_true')
    s.set_defaults(fn=cmd_clasificar)

    args = p.parse_args(argv)
    try:
        args.fn(args)
    except ErrorApi as e:
        log(getattr(args, 'bandeja_id', None) or getattr(args, 'receta_id', None), args.comando,
            f'error de la API: {e.codigo}: {e.mensaje}')
        salida({'ok': False, 'error': e.codigo, 'motivo': e.mensaje, 'detalles': e.detalles, 'status': e.status})
        sys.exit(1)


if __name__ == '__main__':
    main()
