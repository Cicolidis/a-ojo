"""Descargas para /recetas (§6.1, capas 1 a 3 y archivos para las capas 4 y 5).

Uso (por medio de procesamiento/aojo):
  fetch actualizar                       actualiza yt-dlp
  fetch cookies                          exporta las cookies de la cuenta secundaria (correr en la Terminal)
  fetch meta <bandeja_id> <url> [--sin-cookies]
                                         capa 1 (metadatos) y capa 2 (subtítulos de YouTube)
  fetch web <url> [--id <bandeja_id>]    capa 3: receta de una página web
  fetch audio <bandeja_id>               baja el audio (para transcribe)
  fetch video <bandeja_id>               baja el video en 720p o menos (para frames)
  fetch foto <bandeja_id> [--segundo N | --url URL]
                                         deja foto.jpg (miniatura, cuadro del video o imagen)

Todo queda en ~/.a-ojo/trabajo/<bandeja_id>/. Cada comando imprime una línea de JSON.
"""
import argparse
import gzip
import html
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

import comun
from comun import ErrorDescarga, fallar, log, salida

AGENTE = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
MAX_TEXTO_WEB = 20000
MAX_BYTES_WEB = 3 * 1024 * 1024


# ---------------------------------------------------------------- actualizar

def cmd_actualizar(_args):
    """`yt-dlp -U` no funciona si se instaló con pip: se actualiza el paquete en el venv."""
    antes = version_ytdlp()
    uv = shutil.which('uv')
    if uv:
        cmd = [uv, 'pip', 'install', '--quiet', '--python', sys.executable, '-U', 'yt-dlp[default]']
    else:
        cmd = [sys.executable, '-m', 'pip', 'install', '--quiet', '-U', 'yt-dlp[default]']
    r = subprocess.run(cmd, capture_output=True, text=True)
    despues = version_ytdlp()
    log(None, 'actualizar', f'yt-dlp {antes} → {despues}')
    datos = {'ok': True, 'yt_dlp': despues, 'antes': antes}
    if r.returncode != 0:
        # Sin conexión o PyPI caído: se sigue con la versión que hay.
        datos['aviso'] = 'No pude actualizar yt-dlp; sigo con la versión instalada.'
        datos['detalle'] = (r.stderr or '').strip()[-300:]
    salida(datos)


# Un Reel con restricción de edad (§6.5): si se ve, las cookies sirven.
REEL_DE_PRUEBA = 'https://www.instagram.com/reel/Dai7vRBSXvl/'


def cmd_cookies(_args):
    """Copia las cookies del perfil de procesamiento a un archivo y prueba que alcancen.

    Se corre una vez desde la Terminal: macOS no deja que Claude Code lea la carpeta
    de Chrome. Con el archivo, yt-dlp ya no necesita el navegador.
    """
    origen = comun.args_navegador()
    if not origen:
        fallar('sin_config', 'Falta A_OJO_COOKIES_PERFIL en el .env (ver docs/perfil-instagram.md).')
    archivo = comun.archivo_cookies()
    archivo.parent.mkdir(parents=True, exist_ok=True)
    try:
        # --cookies con --cookies-from-browser: lee del navegador y guarda todo en el archivo.
        comun.correr_ytdlp([*origen, '--cookies', str(archivo), '--skip-download', '-J', REEL_DE_PRUEBA],
                           'instagram')
    except ErrorDescarga as e:
        if not archivo.exists() or e.codigo == 'cookies':
            salida(e.como_dict())
            sys.exit(1)
        archivo.chmod(0o600)
        salida({'ok': False, 'error': e.codigo, 'archivo': str(archivo),
                'motivo': 'Exporté las cookies, pero con ellas no se ve el Reel de prueba. '
                          '¿La sesión de la cuenta secundaria sigue abierta en ese perfil?',
                'detalle': e.detalle})
        sys.exit(1)
    archivo.chmod(0o600)
    log(None, 'cookies', f'exportadas a {archivo}')
    salida({'ok': True, 'archivo': str(archivo), 'mensaje': '✓ Cookies exportadas: se ve el Reel restringido.'})


def version_ytdlp():
    r = subprocess.run([str(comun.VENV_BIN / 'yt-dlp'), '--version'], capture_output=True, text=True)
    return r.stdout.strip() or None


# ---------------------------------------------------------------- meta

def cmd_meta(args):
    d = comun.dir_trabajo(args.bandeja_id)
    plataforma = comun.plataforma_de(args.url)
    log(args.bandeja_id, 'meta', f'{plataforma} {args.url}')
    if plataforma == 'web':
        # Una página con la receta escrita: no hay video, va directo a la capa 3.
        datos = leer_web(args.url)
        comun.escribir_json(d / 'web.json', datos)
        salida({'ok': True, 'id': args.bandeja_id, 'plataforma': 'web', 'dir': str(d), 'web': datos})
        return

    try:
        cookies = comun.args_cookies(plataforma, args.sin_cookies)
        r = comun.correr_ytdlp(['-J', *cookies, args.url], plataforma, args.bandeja_id)
        info = json.loads(r.stdout)
        comun.escribir_json(d / 'info.json', info)
        comun.escribir_json(d / 'fuente.json', {'url': args.url, 'plataforma': plataforma, 'sin_cookies': args.sin_cookies})

        subtitulos = None
        if plataforma == 'youtube':
            subtitulos = bajar_subtitulos(info, d, args.bandeja_id)
    except ErrorDescarga as e:
        log(args.bandeja_id, 'meta', f'error {e.codigo}: {e.motivo}')
        salida({**e.como_dict(), 'id': args.bandeja_id, 'plataforma': plataforma})
        sys.exit(1)

    descripcion = info.get('description') or ''
    resumen = {
        'ok': True,
        'id': args.bandeja_id,
        'plataforma': plataforma,
        'dir': str(d),
        'titulo': info.get('title'),
        'autor': autor_de(info),
        'duracion_s': info.get('duration'),
        'idioma': info.get('language'),
        'descripcion': descripcion,
        'links': links_de(descripcion),
        'subtitulos': subtitulos,
        'miniatura': info.get('thumbnail'),
    }
    log(args.bandeja_id, 'meta', f'ok: «{info.get("title")}», subtítulos: {bool(subtitulos)}')
    salida(resumen)


def autor_de(info):
    cuenta = info.get('channel') if info.get('extractor_key') == 'Instagram' else info.get('uploader_id')
    cuenta = cuenta or info.get('uploader_id') or info.get('channel')
    if cuenta and not str(cuenta).startswith('@') and re.fullmatch(r'[\w.]+', str(cuenta)) and not str(cuenta).isdigit():
        cuenta = '@' + str(cuenta)
    return {'nombre': info.get('uploader') or info.get('channel'), 'cuenta': cuenta}


def links_de(texto):
    """Links de una descripción, sin repetir y sin la puntuación final."""
    vistos = []
    for m in re.finditer(r'https?://[^\s<>"\'`«»]+', texto or ''):
        url = re.sub(r'[.,;:!?…)\]]+$', '', m.group(0))
        if url not in vistos:
            vistos.append(url)
    return vistos[:15]


def elegir_subtitulos(info):
    """Elige la pista de subtítulos: manuales antes que automáticos, en el idioma del video.

    Devuelve (idioma, automaticos) o None. Evita las traducciones automáticas.
    """
    idioma = (info.get('language') or '').split('-')[0]
    manuales = info.get('subtitles') or {}
    automaticos = info.get('automatic_captions') or {}

    def base(lang):
        return lang.split('-')[0]

    candidatos_manuales = [l for l in manuales if base(l) in ('es', 'en') and l != 'live_chat']
    for l in sorted(candidatos_manuales, key=lambda l: (base(l) != idioma, base(l) != 'es', len(l))):
        return l, False

    # Automáticos: la pista "-orig" es la transcripción del audio original; las demás son traducciones.
    originales = [l for l in automaticos if l.endswith('-orig')]
    if originales:
        l = sorted(originales, key=lambda l: (base(l) != idioma, base(l) not in ('es', 'en')))[0]
        return l, True
    if idioma and idioma in automaticos:
        return idioma, True
    for l in ('es', 'en'):
        if l in automaticos:
            return l, True
    return None


def bajar_subtitulos(info, d, bandeja_id):
    eleccion = elegir_subtitulos(info)
    if not eleccion:
        return None
    lang, automaticos = eleccion
    for viejo in d.glob('subs.*'):
        viejo.unlink()
    # --load-info-json reusa los metadatos: no vuelve a pedirle la página a YouTube.
    args = ['--load-info-json', str(d / 'info.json'), '--skip-download',
            '--write-auto-subs' if automaticos else '--write-subs',
            '--sub-langs', lang, '--sub-format', 'vtt', '-o', str(d / 'subs.%(ext)s')]
    try:
        comun.correr_ytdlp(args, 'youtube', bandeja_id)
    except ErrorDescarga as e:
        if e.codigo == 'limite':
            raise
        log(bandeja_id, 'subtitulos', f'no pude bajarlos: {e.detalle}')
        return {'pista': lang, 'automaticos': automaticos, 'error': e.motivo, 'texto': ''}
    archivos = sorted(d.glob('subs*.vtt'))
    if not archivos:
        return {'pista': lang, 'automaticos': automaticos, 'error': 'yt-dlp no dejó el archivo', 'texto': ''}
    texto = vtt_a_texto(archivos[0].read_text(encoding='utf-8', errors='replace'))
    (d / 'subtitulos.txt').write_text(texto, encoding='utf-8')
    return {'pista': lang, 'automaticos': automaticos, 'texto': texto}


def vtt_a_texto(vtt):
    """Pasa un WebVTT a líneas "[mm:ss] texto".

    Los subtítulos automáticos de YouTube repiten la línea anterior en cada cue
    (texto que "rueda"): se emite cada línea una sola vez.
    """
    salida_lineas = []
    emitidas = []
    inicio = None
    lineas = vtt.replace('\r\n', '\n').split('\n')
    for i, linea in enumerate(lineas):
        m = re.match(r'\s*(\d+:)?(\d{2}):(\d{2})\.\d{3}\s+-->', linea)
        if m:
            horas = int((m.group(1) or '0:')[:-1])
            inicio = horas * 3600 + int(m.group(2)) * 60 + int(m.group(3))
            continue
        siguiente = lineas[i + 1] if i + 1 < len(lineas) else ''
        if inicio is None or '-->' in siguiente:
            continue  # encabezado o identificador del próximo cue
        texto = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', linea))).strip()
        if not texto or texto in emitidas[-3:]:
            continue
        emitidas.append(texto)
        salida_lineas.append(f'[{inicio // 60:02d}:{inicio % 60:02d}] {texto}')
    return '\n'.join(salida_lineas)


# ---------------------------------------------------------------- web (capa 3)

def cmd_web(args):
    try:
        datos = leer_web(args.url)
    except ErrorDescarga as e:
        log(args.id, 'web', f'error: {e.detalle}')
        salida({**e.como_dict(), 'url': args.url})
        sys.exit(1)
    if args.id:
        comun.escribir_json(comun.dir_trabajo(args.id) / 'web.json', datos)
    log(args.id, 'web', f'{args.url}: receta JSON-LD: {bool(datos.get("receta"))}')
    salida(datos)


def leer_web(url):
    try:
        html_crudo, final = bajar_html(url)
    except (urllib.error.URLError, OSError, ValueError) as e:
        motivo = 'La página no respondió o bloqueó la descarga. Probá con WebFetch.'
        raise ErrorDescarga('red', motivo, str(e)[:300])
    receta = receta_de_html(html_crudo)
    datos = {'ok': True, 'url': final, 'titulo': titulo_de_html(html_crudo), 'receta': receta}
    if not receta:
        datos['texto'] = texto_de_html(html_crudo)[:MAX_TEXTO_WEB]
    return datos


def bajar_html(url):
    pedido = urllib.request.Request(url, headers={
        'User-Agent': AGENTE,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip',
    })
    with urllib.request.urlopen(pedido, timeout=30) as r:
        crudo = r.read(MAX_BYTES_WEB)
        if r.headers.get('Content-Encoding') == 'gzip':
            crudo = gzip.decompress(crudo)
        charset = r.headers.get_content_charset() or 'utf-8'
        return crudo.decode(charset, errors='replace'), r.geturl()


def receta_de_html(texto):
    """Busca un schema.org/Recipe en los bloques JSON-LD de la página."""
    for bloque in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', texto, re.S | re.I):
        try:
            datos = json.loads(bloque.strip())
        except ValueError:
            continue
        receta = buscar_receta(datos)
        if receta:
            return normalizar_receta(receta)
    return None


def buscar_receta(nodo):
    if isinstance(nodo, list):
        for x in nodo:
            r = buscar_receta(x)
            if r:
                return r
    elif isinstance(nodo, dict):
        tipo = nodo.get('@type')
        tipos = tipo if isinstance(tipo, list) else [tipo]
        if 'Recipe' in tipos:
            return nodo
        for clave in ('@graph', 'mainEntity', 'itemListElement'):
            if clave in nodo:
                r = buscar_receta(nodo[clave])
                if r:
                    return r
    return None


def normalizar_receta(r):
    def texto(v):
        if isinstance(v, dict):
            v = v.get('name') or v.get('text') or v.get('url')
        if isinstance(v, list):
            v = ', '.join(str(texto(x)) for x in v if x)
        return html.unescape(re.sub(r'<[^>]+>', '', str(v))).strip() if v else None

    imagen = r.get('image')
    if isinstance(imagen, list):
        imagen = imagen[0] if imagen else None
    if isinstance(imagen, dict):
        imagen = imagen.get('url')

    return {
        'nombre': texto(r.get('name')),
        'autor': texto(r.get('author')),
        'rinde': texto(r.get('recipeYield')),
        'tiempo_total_min': minutos_iso(r.get('totalTime')),
        'tiempo_prep_min': minutos_iso(r.get('prepTime')),
        'tiempo_coccion_min': minutos_iso(r.get('cookTime')),
        'ingredientes': [texto(i) for i in (r.get('recipeIngredient') or r.get('ingredients') or []) if i],
        'pasos': pasos_de(r.get('recipeInstructions')),
        'notas': texto(r.get('description')),
        'imagen': imagen,
    }


def pasos_de(instrucciones):
    """Aplana recipeInstructions: texto, lista de textos, HowToStep o HowToSection."""
    if not instrucciones:
        return []
    if isinstance(instrucciones, str):
        partes = re.split(r'\n+|(?<=\.)\s+(?=\d+[.)]\s)', html.unescape(re.sub(r'<[^>]+>', '\n', instrucciones)))
        return [p.strip() for p in partes if p.strip()]
    if isinstance(instrucciones, dict):
        instrucciones = [instrucciones]
    pasos = []
    for x in instrucciones:
        if isinstance(x, str):
            pasos.extend(pasos_de(x))
        elif isinstance(x, dict):
            tipos = x.get('@type') if isinstance(x.get('@type'), list) else [x.get('@type')]
            if 'HowToSection' in tipos:
                if x.get('name'):
                    pasos.append(f'— {html.unescape(str(x["name"])).strip()} —')
                pasos.extend(pasos_de(x.get('itemListElement')))
            else:
                t = x.get('text') or x.get('name')
                if t:
                    pasos.append(html.unescape(re.sub(r'<[^>]+>', '', str(t))).strip())
    return pasos


def minutos_iso(v):
    """PT1H15M → 75. None si no se puede leer."""
    m = re.fullmatch(r'P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', str(v or '').strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi + round(s / 60)


def titulo_de_html(texto):
    m = re.search(r'<title[^>]*>(.*?)</title>', texto, re.S | re.I)
    return html.unescape(m.group(1)).strip() if m else None


class _Texto(HTMLParser):
    IGNORAR = {'head', 'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'svg', 'iframe'}
    BLOQUES = {'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'div', 'tr', 'section', 'article'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.partes = []
        self.ignorando = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.IGNORAR:
            self.ignorando += 1
        elif tag in self.BLOQUES:
            self.partes.append('\n')

    def handle_endtag(self, tag):
        if tag in self.IGNORAR and self.ignorando:
            self.ignorando -= 1
        elif tag in self.BLOQUES:
            self.partes.append('\n')

    def handle_data(self, data):
        if not self.ignorando:
            self.partes.append(data)


def texto_de_html(texto):
    p = _Texto()
    p.feed(texto)
    lineas = [re.sub(r'[ \t\xa0]+', ' ', l).strip() for l in ''.join(p.partes).splitlines()]
    return '\n'.join(l for l in lineas if l)


# ---------------------------------------------------------------- audio, video y foto

def fuente(d):
    try:
        return comun.leer_json(d / 'fuente.json')
    except OSError:
        fallar('sin_meta', 'Primero corré «fetch meta» para esta fila.')


def bajar_medio(args, nombre, formato, orden=()):
    d = comun.dir_trabajo(args.bandeja_id)
    f = fuente(d)
    for viejo in d.glob(f'{nombre}.*'):
        viejo.unlink()
    cookies = comun.args_cookies(f['plataforma'], f.get('sin_cookies'))
    salida_tpl = str(d / f'{nombre}.%(ext)s')
    intentos = [
        ['--load-info-json', str(d / 'info.json'), *cookies, '-f', formato, *orden, '-o', salida_tpl],
        # Las URLs de info.json vencen a las horas: si falla, se extrae de nuevo.
        [*cookies, '-f', formato, *orden, '-o', salida_tpl, f['url']],
    ]
    ultimo = None
    for extra in intentos:
        try:
            comun.correr_ytdlp(extra, f['plataforma'], args.bandeja_id)
            break
        except ErrorDescarga as e:
            ultimo = e
            if e.codigo in ('limite', 'login', 'privado', 'cookies'):
                break
    archivos = [a for a in d.glob(f'{nombre}.*') if not a.name.endswith(('.part', '.ytdl'))]
    if not archivos:
        e = ultimo or ErrorDescarga('otro', 'yt-dlp no dejó el archivo.')
        log(args.bandeja_id, nombre, f'error {e.codigo}: {e.detalle}')
        salida({**e.como_dict(), 'id': args.bandeja_id})
        sys.exit(1)
    archivo = archivos[0]
    log(args.bandeja_id, nombre, f'ok: {archivo.name} ({archivo.stat().st_size // 1024} KB)')
    salida({'ok': True, 'id': args.bandeja_id, 'archivo': str(archivo), 'kb': archivo.stat().st_size // 1024})


def cmd_audio(args):
    bajar_medio(args, 'audio', 'ba/b')


def cmd_video(args):
    # «res» es el lado más corto: 720 cubre tanto 1280×720 como un Short de 720×1280.
    bajar_medio(args, 'video', 'bv*/b', ('-S', 'res:720'))


def cmd_foto(args):
    """Deja foto.jpg (hasta 1200 px de ancho): la miniatura, un cuadro del video o una imagen (de la web o local)."""
    d = comun.dir_trabajo(args.bandeja_id)
    destino = d / 'foto.jpg'
    if args.archivo:
        archivo = Path(args.archivo).expanduser()
        if not archivo.is_file():
            fallar('sin_archivo', f'No encontré {archivo}.')
        origen, extra = str(archivo), []
        descripcion = f'imagen {archivo.name}'
    elif args.segundo is not None:
        videos = [v for v in d.glob('video.*') if not v.name.endswith('.part')]
        if not videos:
            fallar('sin_video', 'Primero corré «fetch video» para esta fila.')
        origen, extra = str(videos[0]), ['-ss', str(args.segundo)]
        descripcion = f'cuadro del segundo {args.segundo}'
    else:
        crudo = d / 'foto_original'
        error = None
        for url, descripcion in candidatos_foto(d, args.url):
            try:
                pedido = urllib.request.Request(url, headers={'User-Agent': AGENTE})
                with urllib.request.urlopen(pedido, timeout=30) as r:
                    crudo.write_bytes(r.read(15 * 1024 * 1024))
                break
            except (urllib.error.URLError, OSError) as e:
                error = e
        else:
            fallar('sin_miniatura', 'No pude bajar ninguna imagen: pasá --url o --segundo.', detalle=str(error)[:300])
        origen, extra = str(crudo), []
    # Que el lado más largo no pase de 1200 px.
    escala = 'scale=w=min(1200\\,iw):h=min(1200\\,ih):force_original_aspect_ratio=decrease'
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', *extra, '-i', origen, '-frames:v', '1',
           '-vf', escala, '-q:v', '3', str(destino)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not destino.exists():
        fallar('ffmpeg', 'No pude convertir la imagen.', detalle=(r.stderr or '')[-300:])
    log(args.bandeja_id, 'foto', descripcion)
    salida({'ok': True, 'id': args.bandeja_id, 'archivo': str(destino), 'origen': descripcion,
            'kb': destino.stat().st_size // 1024})


def candidatos_foto(d, url=None):
    """[(url, descripción)] para la foto: la pedida, o la miniatura (vertical primero en un Short)."""
    if url:
        return [(url, 'imagen elegida')]
    try:
        info = comun.leer_json(d / 'info.json')
    except OSError:
        info = {}
    candidatos = []
    urls = ' '.join(str(info.get(k) or '') for k in ('webpage_url', 'original_url'))
    vertical = (info.get('width') or 0) < (info.get('height') or 0)
    if info.get('extractor_key') == 'Youtube' and info.get('id') and ('/shorts/' in urls or vertical):
        candidatos.append((f'https://i.ytimg.com/vi/{info["id"]}/oardefault.jpg', 'miniatura vertical del Short'))
    if info.get('thumbnail'):
        candidatos.append((info['thumbnail'], 'miniatura'))
    return candidatos


# ---------------------------------------------------------------- main

def main(argv=None):
    p = argparse.ArgumentParser(prog='fetch', description='Descargas para /recetas.')
    sub = p.add_subparsers(dest='comando', required=True)
    sub.add_parser('actualizar').set_defaults(fn=cmd_actualizar)
    sub.add_parser('cookies').set_defaults(fn=cmd_cookies)

    m = sub.add_parser('meta')
    m.add_argument('bandeja_id')
    m.add_argument('url')
    m.add_argument('--sin-cookies', action='store_true', help='probar Instagram sin la cuenta secundaria')
    m.set_defaults(fn=cmd_meta)

    w = sub.add_parser('web')
    w.add_argument('url')
    w.add_argument('--id', help='guarda web.json en la carpeta de esa fila')
    w.set_defaults(fn=cmd_web)

    for nombre, fn in (('audio', cmd_audio), ('video', cmd_video)):
        s = sub.add_parser(nombre)
        s.add_argument('bandeja_id')
        s.set_defaults(fn=fn)

    f = sub.add_parser('foto')
    f.add_argument('bandeja_id')
    g = f.add_mutually_exclusive_group()
    g.add_argument('--segundo', type=float)
    g.add_argument('--url')
    g.add_argument('--archivo', help='una imagen local, por ejemplo una captura (capturas/2.jpg)')
    f.set_defaults(fn=cmd_foto)

    args = p.parse_args(argv)
    try:
        args.fn(args)
    except ErrorDescarga as e:
        salida(e.como_dict())
        sys.exit(1)


if __name__ == '__main__':
    main()
