"""Cliente de la API de A ojo para /recetas. Lee A_OJO_API_URL y A_OJO_TOKEN del .env.

Uso (por medio de procesamiento/aojo):
  api ping
  api pendientes [--limite N]            filas para procesar, de la más vieja a la más nueva
  api fila <bandeja_id>                  una fila cualquiera de la bandeja
  api capturar <url> [--quien camilo]
  api actualizar <bandeja_id> <estado> [--motivo "…"] [--dry-run]
  api upsert <bandeja_id> [--dry-run]    manda trabajo/<id>/receta.json (y foto.jpg si existe)

Con --dry-run (o A_OJO_DRY_RUN=1) no escribe nada en la Sheet: «actualizar» no
llama a la API y «upsert» solo valida la receta. El token nunca se imprime.
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


RESUMEN_FILA = ('id', 'url', 'plataforma', 'quien', 'estado', 'motivo', 'receta_id', 'intentos', 'creado', 'actualizado')


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

    args = p.parse_args(argv)
    try:
        args.fn(args)
    except ErrorApi as e:
        log(getattr(args, 'bandeja_id', None), args.comando, f'error de la API: {e.codigo}: {e.mensaje}')
        salida({'ok': False, 'error': e.codigo, 'motivo': e.mensaje, 'detalles': e.detalles, 'status': e.status})
        sys.exit(1)


if __name__ == '__main__':
    main()
