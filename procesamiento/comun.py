"""Utilidades compartidas por los scripts de procesamiento de A ojo.

Solo usa la biblioteca estándar. Cada script imprime una línea de JSON por
stdout para que /recetas la lea; los errores salen con {"ok": false, ...}.
"""
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parent.parent
DIR_PROC = RAIZ_REPO / 'procesamiento'
VENV_BIN = Path(sys.executable).parent


def cargar_env(ruta=RAIZ_REPO / '.env'):
    """Lee el .env (CLAVE=valor, con o sin comillas) sin pisar variables ya definidas."""
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding='utf-8').splitlines():
        linea = linea.strip()
        if not linea or linea.startswith('#') or '=' not in linea:
            continue
        clave, valor = linea.split('=', 1)
        clave = clave.strip().removeprefix('export ').strip()
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in '"\'':
            valor = valor[1:-1]
        os.environ.setdefault(clave, valor)


cargar_env()

DIR_A_OJO = Path(os.environ.get('A_OJO_DIR') or Path.home() / '.a-ojo')
DIR_LOG = DIR_A_OJO / 'log'
DIR_TRABAJO = DIR_A_OJO / 'trabajo'


# ---------------------------------------------------------------- salida y log

def salida(datos):
    print(json.dumps(datos, ensure_ascii=False))


def fallar(codigo, motivo, **extra):
    salida({'ok': False, 'error': codigo, 'motivo': motivo, **extra})
    sys.exit(1)


def log(bandeja_id, paso, mensaje):
    """Agrega una línea a ~/.a-ojo/log/AAAA-MM-DD.log. Nunca escribe el token."""
    DIR_LOG.mkdir(parents=True, exist_ok=True)
    ahora = datetime.now()
    token = os.environ.get('A_OJO_TOKEN')
    texto = str(mensaje).replace(token, '***') if token else str(mensaje)
    linea = f'{ahora.isoformat(timespec="seconds")} {bandeja_id or "-"} {paso}: {texto}\n'
    with open(DIR_LOG / f'{ahora:%Y-%m-%d}.log', 'a', encoding='utf-8') as f:
        f.write(linea)


def ahora_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def dir_trabajo(bandeja_id):
    """Carpeta de trabajo de una fila de la bandeja (~/.a-ojo/trabajo/<id>)."""
    if not re.fullmatch(r'[a-z]_[0-9a-z]{3,12}', bandeja_id or ''):
        fallar('id_invalido', f'«{bandeja_id}» no parece un id de la bandeja (ej.: b_7f3k2).')
    d = DIR_TRABAJO / bandeja_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def leer_json(ruta):
    return json.loads(Path(ruta).read_text(encoding='utf-8'))


def escribir_json(ruta, datos):
    Path(ruta).write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding='utf-8')


def plataforma_de(url):
    host = re.sub(r'^https?://', '', url or '').split('/')[0].lower()
    host = re.sub(r'^(www\.|m\.)', '', host)
    if host in ('youtube.com', 'youtu.be', 'youtube-nocookie.com'):
        return 'youtube'
    if host in ('instagram.com', 'instagr.am'):
        return 'instagram'
    return 'web'


# ---------------------------------------------------------------- errores de descarga

class ErrorDescarga(Exception):
    """Error de yt-dlp ya clasificado. `codigo` decide qué hace /recetas con la fila."""

    def __init__(self, codigo, motivo, detalle=''):
        super().__init__(motivo)
        self.codigo = codigo
        self.motivo = motivo
        self.detalle = detalle

    def como_dict(self):
        return {'ok': False, 'error': self.codigo, 'motivo': self.motivo, 'detalle': self.detalle}


NOMBRE_PLATAFORMA = {'youtube': 'YouTube', 'instagram': 'Instagram'}

# (código, patrón) en orden: gana el primero que aparezca en el stderr de yt-dlp.
PATRONES_ERROR = [
    ('cookies', r'could not find .* cookies database|failed to decrypt|cookies? from browser|keyring|'
                r'Operation not permitted.*(Chrome|Brave|Edge|Firefox)'),
    ('limite', r'HTTP Error 429|Too Many Requests'),
    ('limite', r"Sign in to confirm you.re not a bot"),
    ('login', r'login required|requires? (authentication|login)|Sign in to confirm your age|'
              r'age.restricted|inappropriate for some users|certain audiences|'
              r'isn.t available to everyone|Use --cookies'),
    ('privado', r'[Pp]rivate video|video is private|account is private'),
    ('no_disponible', r'Video unavailable|has been removed|no longer available|does not exist|'
                      r'HTTP Error 404|Unsupported URL|not available|content isn.t available'),
    ('limite', r'rate.limit'),
    ('red', r'Unable to download webpage|timed out|Connection (refused|reset)|getaddrinfo|'
            r'Name or service not known|nodename nor servname|Temporary failure in name resolution|'
            r'Network is unreachable'),
]


def motivo_de(codigo, plataforma):
    nombre = NOMBRE_PLATAFORMA.get(plataforma, 'La página')
    return {
        'cookies': ('No pude leer las cookies de la cuenta secundaria. Corré «procesamiento/aojo fetch cookies» '
                    'en la Terminal (ver docs/perfil-instagram.md).'),
        'limite': f'{nombre} está limitando los pedidos. Probá de nuevo más tarde.',
        'login': f'{nombre} pide iniciar sesión. Mandá 2 o 3 capturas.',
        'privado': 'El video es privado. Mandá 2 o 3 capturas.',
        'no_disponible': 'El video ya no está disponible.',
        'red': f'No pude conectarme con {nombre}. Revisá la conexión.',
    }.get(codigo, f'{nombre} dio un error inesperado.')


def clasificar_error(stderr, plataforma='web'):
    lineas = [l for l in (stderr or '').splitlines() if l.strip()]
    errores = [l for l in lineas if l.startswith('ERROR')]
    detalle = (errores[-1] if errores else (lineas[-1] if lineas else 'sin detalle'))[:300]
    for codigo, patron in PATRONES_ERROR:
        if re.search(patron, stderr or '', re.IGNORECASE):
            return ErrorDescarga(codigo, motivo_de(codigo, plataforma), detalle)
    return ErrorDescarga('otro', motivo_de('otro', plataforma), detalle)


# ---------------------------------------------------------------- cookies

def dir_navegador(navegador):
    """Carpeta de datos de un navegador basado en Chromium, en macOS o Linux."""
    soporte = Path.home() / 'Library' / 'Application Support'
    config = Path.home() / '.config'
    mac = sys.platform == 'darwin'
    rutas = {
        'chrome': soporte / 'Google' / 'Chrome' if mac else config / 'google-chrome',
        'chromium': soporte / 'Chromium' if mac else config / 'chromium',
        'brave': soporte / 'BraveSoftware' / 'Brave-Browser' if mac else config / 'BraveSoftware' / 'Brave-Browser',
        'edge': soporte / 'Microsoft Edge' if mac else config / 'microsoft-edge',
    }
    return rutas.get(navegador)


def _comparable(nombre):
    s = unicodedata.normalize('NFKC', str(nombre or '')).casefold()
    s = re.sub(r'[‐-―−-]', '-', s)
    return re.sub(r'\s+', ' ', s).strip()


def resolver_perfil(navegador, perfil, base=None):
    """Traduce el nombre visible de un perfil («A ojo – procesamiento») a su carpeta («Profile 2»).

    yt-dlp espera la carpeta. En navegadores que no son Chromium devuelve `perfil` tal cual.
    """
    if not perfil:
        return None
    base = Path(base) if base else dir_navegador(navegador)
    if base is None:
        return perfil
    try:
        if (base / perfil).is_dir():
            return perfil
        estado = json.loads((base / 'Local State').read_text(encoding='utf-8'))
    except PermissionError as e:
        raise ErrorDescarga('cookies', motivo_de('cookies', 'instagram'), f'Sin permiso para leer {base}: {e}')
    except (OSError, ValueError) as e:
        raise ErrorDescarga('cookies', motivo_de('cookies', 'instagram'), f'No pude leer {base / "Local State"}: {e}')
    perfiles = estado.get('profile', {}).get('info_cache', {})
    for carpeta, info in perfiles.items():
        if _comparable(info.get('name')) == _comparable(perfil):
            return carpeta
    nombres = ', '.join(sorted(str(i.get('name')) for i in perfiles.values()))
    raise ErrorDescarga('cookies', f'No encontré el perfil «{perfil}» en {navegador}. Revisá docs/perfil-instagram.md.',
                        f'Perfiles disponibles: {nombres}')


def archivo_cookies():
    """Cookies exportadas con «fetch cookies». yt-dlp las lee y las vuelve a guardar en cada uso."""
    return Path(os.environ.get('A_OJO_COOKIES_ARCHIVO') or DIR_A_OJO / 'cookies-instagram.txt').expanduser()


def args_navegador():
    """--cookies-from-browser con el perfil del .env, o [] si no hay perfil configurado."""
    navegador = os.environ.get('A_OJO_COOKIES_NAVEGADOR', 'chrome').strip().lower()
    perfil = os.environ.get('A_OJO_COOKIES_PERFIL', '').strip()
    if not perfil:
        return []
    return ['--cookies-from-browser', f'{navegador}:{resolver_perfil(navegador, perfil)}']


def args_cookies(plataforma, sin_cookies=False):
    """Instagram usa siempre las cookies de la cuenta secundaria; YouTube, ninguna.

    Primero el archivo exportado (macOS no deja que Claude Code lea la carpeta de
    Chrome); si no existe, directo del perfil del navegador.
    """
    if plataforma != 'instagram' or sin_cookies:
        return []
    archivo = archivo_cookies()
    if archivo.exists():
        return ['--cookies', str(archivo)]
    return args_navegador()


# ---------------------------------------------------------------- yt-dlp

ARCHIVO_TURNO = DIR_A_OJO / 'ultimo_pedido'
ESPERAS_429 = (30, 60, 120)


def esperar_turno(minimo=2.0, maximo=5.0, reloj=time.time, dormir=time.sleep, archivo=None):
    """Deja entre 2 y 5 s entre pedidos a las plataformas, aunque vengan de procesos distintos."""
    archivo = Path(archivo or ARCHIVO_TURNO)
    try:
        ultimo = float(archivo.read_text())
    except (OSError, ValueError):
        ultimo = 0.0
    falta = ultimo + random.uniform(minimo, maximo) - reloj()
    if falta > 0:
        dormir(falta)
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text(str(reloj()))


def args_base_ytdlp():
    args = ['--no-progress', '--no-playlist', '--socket-timeout', '30', '--extractor-retries', '3']
    # YouTube exige un runtime de JavaScript; Node ya es requisito del repo.
    runtime = os.environ.get('A_OJO_JS_RUNTIME', 'node').strip()
    if runtime:
        args += ['--js-runtimes', runtime]
    return args


def correr_ytdlp(args, plataforma, bandeja_id=None, correr=subprocess.run, dormir=time.sleep, turno=esperar_turno):
    """Corre yt-dlp. Ante un 429 reintenta después de 30, 60 y 120 s; si sigue, tira ErrorDescarga('limite').

    Los demás errores se clasifican y se tiran sin reintentar.
    """
    cmd = [str(VENV_BIN / 'yt-dlp'), *args_base_ytdlp(), *args]
    for espera in (*ESPERAS_429, None):
        turno()
        r = correr(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            return r
        error = clasificar_error(r.stderr, plataforma)
        if error.codigo == 'limite' and espera is not None and 'HTTP Error 429' in (r.stderr or ''):
            log(bandeja_id, 'yt-dlp', f'429: espero {espera} s y reintento')
            dormir(espera)
            continue
        log(bandeja_id, 'yt-dlp', f'{error.codigo}: {error.detalle}')
        raise error
    raise AssertionError('no se llega')
