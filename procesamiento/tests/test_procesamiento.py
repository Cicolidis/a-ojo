"""Tests de los scripts de procesamiento. Sin red ni yt-dlp: todo simulado.

Correr con: npm run test:py
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Antes de importar comun: que el log y la carpeta de trabajo no toquen ~/.a-ojo.
os.environ['A_OJO_DIR'] = tempfile.mkdtemp(prefix='a-ojo-tests-')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import comun  # noqa: E402
import fetch  # noqa: E402
import frames  # noqa: E402

VTT_AUTOMATICO = """WEBVTT
Kind: captions
Language: es

00:00:00.160 --> 00:00:02.149 align:start position:0%

Vamos<00:00:00.480><c> a</c><00:00:00.640><c> hacer</c><00:00:00.880><c> brownie.</c>

00:00:02.149 --> 00:00:02.159 align:start position:0%
Vamos a hacer brownie.


00:00:02.159 --> 00:00:03.830 align:start position:0%
Vamos a hacer brownie.
fácil<00:00:02.480><c> como</c><00:00:02.720><c> lo</c><00:00:02.960><c> esperabas</c>

00:01:05.000 --> 00:01:07.000 align:start position:0%
fácil como lo esperabas
harina 4 &amp; polo para hornear
"""

VTT_MANUAL = """WEBVTT

1
00:00:01.000 --> 00:00:03.000
<i>Preheat the oven</i> to 350°F.

2
01:00:04.000 --> 01:00:06.000
Mix the flour.
"""

HTML_RECETA = """<html><head><title>Banana bread | Blog</title>
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebSite", "name": "Blog"}</script>
<script type="application/ld+json">
{"@context": "https://schema.org", "@graph": [
  {"@type": "Organization", "name": "Blog"},
  {"@type": ["Recipe", "NewsArticle"], "name": "Easy Banana Bread",
   "author": {"@type": "Person", "name": "Ana"},
   "recipeYield": ["1", "1 loaf"],
   "totalTime": "PT1H15M", "prepTime": "PT15M", "cookTime": "PT60M",
   "image": [{"@type": "ImageObject", "url": "https://blog.example/bb.jpg"}],
   "recipeIngredient": ["3 ripe bananas", "1/3 cup melted butter", "1 &amp; 1/2 cups flour"],
   "recipeInstructions": [
     {"@type": "HowToSection", "name": "Batter", "itemListElement": [
       {"@type": "HowToStep", "text": "Preheat the oven to 350&#176;F."},
       {"@type": "HowToStep", "text": "<p>Mash the bananas.</p>"}
     ]},
     {"@type": "HowToStep", "text": "Bake for 60 minutes."}
   ]}
]}
</script></head><body><p>Hola</p></body></html>"""

HTML_SIN_RECETA = """<html><head><title>Notas</title><style>p{}</style></head><body>
<nav>Menú</nav><article><h1>Galletitas</h1><p>200 g de garbanzos&nbsp;cocidos</p>
<script>var x = 1;</script><ul><li>Horneá 15 minutos</li></ul></article><footer>Pie</footer></body></html>"""


class TestVtt(unittest.TestCase):
    def test_automaticos_sin_repeticiones_ni_etiquetas(self):
        self.assertEqual(fetch.vtt_a_texto(VTT_AUTOMATICO).splitlines(), [
            '[00:00] Vamos a hacer brownie.',
            '[00:02] fácil como lo esperabas',
            '[01:05] harina 4 & polo para hornear',
        ])

    def test_manuales_con_horas(self):
        self.assertEqual(fetch.vtt_a_texto(VTT_MANUAL).splitlines(), [
            '[00:01] Preheat the oven to 350°F.',
            '[60:04] Mix the flour.',
        ])


class TestSubtitulos(unittest.TestCase):
    def test_manuales_antes_que_automaticos_y_en_el_idioma_del_video(self):
        info = {'language': 'en', 'subtitles': {'es': [], 'en-US': [], 'live_chat': []},
                'automatic_captions': {'en-orig': []}}
        self.assertEqual(fetch.elegir_subtitulos(info), ('en-US', False))

    def test_automaticos_originales_no_traducciones(self):
        info = {'language': 'es-US', 'automatic_captions': {'en': [], 'es': [], 'es-orig': [], 'fr': []}}
        self.assertEqual(fetch.elegir_subtitulos(info), ('es-orig', True))

    def test_sin_orig_usa_el_idioma_del_video(self):
        self.assertEqual(fetch.elegir_subtitulos({'language': 'en', 'automatic_captions': {'en': [], 'es': []}}),
                         ('en', True))

    def test_sin_subtitulos(self):
        self.assertIsNone(fetch.elegir_subtitulos({'language': 'es'}))
        self.assertIsNone(fetch.elegir_subtitulos({'subtitles': {'de': []}}))


class TestDescripcion(unittest.TestCase):
    def test_links_sin_repetir_ni_puntuacion(self):
        texto = ('RECIPE ⬇️ https://blog.example/banana-bread/. Más en (https://instagram.com/x) '
                 'y otra vez https://blog.example/banana-bread/')
        self.assertEqual(fetch.links_de(texto), ['https://blog.example/banana-bread/', 'https://instagram.com/x'])

    def test_autor(self):
        self.assertEqual(fetch.autor_de({'uploader': 'Edgardo', 'uploader_id': '@mambrunense'}),
                         {'nombre': 'Edgardo', 'cuenta': '@mambrunense'})
        ig = {'extractor_key': 'Instagram', 'uploader': 'Cocina Fácil', 'uploader_id': '123456', 'channel': 'cocina.facil'}
        self.assertEqual(fetch.autor_de(ig), {'nombre': 'Cocina Fácil', 'cuenta': '@cocina.facil'})


class TestWeb(unittest.TestCase):
    def test_receta_json_ld_en_graph_con_secciones(self):
        r = fetch.receta_de_html(HTML_RECETA)
        self.assertEqual(r['nombre'], 'Easy Banana Bread')
        self.assertEqual(r['autor'], 'Ana')
        self.assertEqual(r['rinde'], '1, 1 loaf')
        self.assertEqual((r['tiempo_total_min'], r['tiempo_prep_min'], r['tiempo_coccion_min']), (75, 15, 60))
        self.assertEqual(r['imagen'], 'https://blog.example/bb.jpg')
        self.assertEqual(r['ingredientes'][2], '1 & 1/2 cups flour')
        self.assertEqual(r['pasos'], ['— Batter —', 'Preheat the oven to 350°F.', 'Mash the bananas.',
                                      'Bake for 60 minutes.'])

    def test_instrucciones_como_texto(self):
        self.assertEqual(fetch.pasos_de('Mezclá todo.\nHorneá.'), ['Mezclá todo.', 'Horneá.'])
        self.assertEqual(fetch.pasos_de(['Uno.', {'@type': 'HowToStep', 'name': 'Dos.'}]), ['Uno.', 'Dos.'])

    def test_sin_receta_devuelve_texto_limpio(self):
        self.assertIsNone(fetch.receta_de_html(HTML_SIN_RECETA))
        self.assertEqual(fetch.texto_de_html(HTML_SIN_RECETA), 'Galletitas\n200 g de garbanzos cocidos\nHorneá 15 minutos')
        self.assertEqual(fetch.titulo_de_html(HTML_SIN_RECETA), 'Notas')

    def test_minutos_iso(self):
        self.assertEqual(fetch.minutos_iso('PT45M'), 45)
        self.assertEqual(fetch.minutos_iso('P0DT1H'), 60)
        self.assertEqual(fetch.minutos_iso('PT90S'), 2)
        self.assertIsNone(fetch.minutos_iso('45 minutos'))
        self.assertIsNone(fetch.minutos_iso(None))


class TestErrores(unittest.TestCase):
    def codigo(self, stderr, plataforma='youtube'):
        return comun.clasificar_error(stderr, plataforma).codigo

    def test_clasificacion(self):
        casos = {
            'ERROR: [youtube] a2qRJHVeJwk: Unable to download API page: HTTP Error 429: Too Many Requests': 'limite',
            "ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser": 'limite',
            'ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.': 'login',
            'ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access': 'privado',
            'ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader': 'no_disponible',
            'ERROR: [youtube] x: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname '
            'provided, or not known>': 'red',
            'ERROR: could not find chrome cookies database in "/Users/x/Library/Application Support/Google/Chrome/'
            'Profile 9"': 'cookies',
            'ERROR: algo raro': 'otro',
        }
        for stderr, esperado in casos.items():
            self.assertEqual(self.codigo(stderr), esperado, stderr)

    def test_instagram_restringido_pide_login(self):
        stderr = ('ERROR: [Instagram] Dai7vRBSXvl: Requested content is not available, rate-limit reached or login '
                  'required. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or '
                  '--netrc (instagram) to provide account credentials')
        e = comun.clasificar_error(stderr, 'instagram')
        self.assertEqual(e.codigo, 'login')
        self.assertEqual(e.motivo, 'Instagram pide iniciar sesión. Mandá 2 o 3 capturas.')
        self.assertIn('Dai7vRBSXvl', e.detalle)
        # Lo que responde hoy sin cookies un Reel con restricción de edad.
        stderr = ("ERROR: [Instagram] Dai7vRBSXvl: This content isn't available to everyone: "
                  "It can't be seen by certain audiences.")
        self.assertEqual(self.codigo(stderr, 'instagram'), 'login')
        self.assertEqual(self.codigo("ERROR: [Instagram] x: This content isn't available right now", 'instagram'),
                         'no_disponible')


class Resultado:
    def __init__(self, returncode, stderr='', stdout=''):
        self.returncode, self.stderr, self.stdout = returncode, stderr, stdout


class TestReintentos(unittest.TestCase):
    def correr(self, respuestas):
        llamadas, esperas = [], []

        def correr(cmd, **_kw):
            llamadas.append(cmd)
            return respuestas.pop(0)

        def ejecutar():
            return comun.correr_ytdlp(['-J', 'url'], 'youtube', 'b_test1', correr=correr,
                                      dormir=esperas.append, turno=lambda: None)
        return ejecutar, llamadas, esperas

    def test_429_reintenta_con_espera_exponencial(self):
        r429 = Resultado(1, 'ERROR: HTTP Error 429: Too Many Requests')
        ejecutar, llamadas, esperas = self.correr([r429, r429, Resultado(0, stdout='{}')])
        self.assertEqual(ejecutar().stdout, '{}')
        self.assertEqual(len(llamadas), 3)
        self.assertEqual(esperas, [30, 60])
        self.assertIn('--js-runtimes', llamadas[0])

    def test_429_persistente_termina_en_limite(self):
        r429 = Resultado(1, 'ERROR: HTTP Error 429: Too Many Requests')
        ejecutar, llamadas, esperas = self.correr([r429] * 4)
        with self.assertRaises(comun.ErrorDescarga) as ctx:
            ejecutar()
        self.assertEqual(ctx.exception.codigo, 'limite')
        self.assertEqual(esperas, [30, 60, 120])
        self.assertEqual(len(llamadas), 4)

    def test_otros_errores_no_reintentan(self):
        ejecutar, llamadas, esperas = self.correr([Resultado(1, 'ERROR: Private video')])
        with self.assertRaises(comun.ErrorDescarga) as ctx:
            ejecutar()
        self.assertEqual(ctx.exception.codigo, 'privado')
        self.assertEqual((len(llamadas), esperas), (1, []))

    def test_esperar_turno_deja_al_menos_2_segundos(self):
        archivo = Path(os.environ['A_OJO_DIR']) / 'turno_test'
        reloj = [1000.0]
        dormidas = []
        archivo.write_text('999.5')
        comun.esperar_turno(reloj=lambda: reloj[0], dormir=dormidas.append, archivo=archivo)
        self.assertEqual(len(dormidas), 1)
        self.assertTrue(1.5 <= dormidas[0] <= 4.5, dormidas)
        reloj[0] = 2000.0
        comun.esperar_turno(reloj=lambda: reloj[0], dormir=dormidas.append, archivo=archivo)
        self.assertEqual(len(dormidas), 1, 'si ya pasó el tiempo, no espera')


class TestCookies(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        (self.base / 'Profile 2').mkdir()
        (self.base / 'Local State').write_text(json.dumps({'profile': {'info_cache': {
            'Default': {'name': 'Camilo'},
            'Profile 2': {'name': 'A ojo – procesamiento'},
        }}}))

    def test_resuelve_el_nombre_visible(self):
        self.assertEqual(comun.resolver_perfil('chrome', 'A ojo – procesamiento', self.base), 'Profile 2')
        self.assertEqual(comun.resolver_perfil('chrome', 'a ojo - procesamiento', self.base), 'Profile 2',
                         'con guion común y minúsculas')
        self.assertEqual(comun.resolver_perfil('chrome', 'Profile 2', self.base), 'Profile 2', 'ya es la carpeta')

    def test_perfil_inexistente(self):
        with self.assertRaises(comun.ErrorDescarga) as ctx:
            comun.resolver_perfil('chrome', 'Otro', self.base)
        self.assertEqual(ctx.exception.codigo, 'cookies')
        self.assertIn('A ojo – procesamiento', ctx.exception.detalle)

    def test_sin_local_state(self):
        with self.assertRaises(comun.ErrorDescarga) as ctx:
            comun.resolver_perfil('chrome', 'A ojo', Path(tempfile.mkdtemp()))
        self.assertEqual(ctx.exception.codigo, 'cookies')

    def test_solo_instagram_usa_cookies(self):
        viejo = dict(os.environ)
        try:
            archivo = Path(tempfile.mkdtemp()) / 'cookies.txt'
            os.environ['A_OJO_COOKIES_ARCHIVO'] = str(archivo)
            os.environ['A_OJO_COOKIES_NAVEGADOR'] = 'firefox'
            os.environ['A_OJO_COOKIES_PERFIL'] = 'procesamiento'
            self.assertEqual(comun.args_cookies('youtube'), [])
            self.assertEqual(comun.args_cookies('instagram', sin_cookies=True), [])
            self.assertEqual(comun.args_cookies('instagram'), ['--cookies-from-browser', 'firefox:procesamiento'])
            archivo.write_text('# Netscape HTTP Cookie File\n')
            self.assertEqual(comun.args_cookies('instagram'), ['--cookies', str(archivo)], 'el archivo exportado gana')
            self.assertEqual(comun.args_cookies('instagram', sin_cookies=True), [])
            archivo.unlink()
            os.environ['A_OJO_COOKIES_PERFIL'] = ''
            self.assertEqual(comun.args_cookies('instagram'), [])
        finally:
            os.environ.clear()
            os.environ.update(viejo)


class TestVarios(unittest.TestCase):
    def test_cargar_env_con_comillas_sin_pisar(self):
        ruta = Path(tempfile.mkdtemp()) / '.env'
        ruta.write_text('# comentario\nA_OJO_PRUEBA_1="A ojo – procesamiento"\nexport A_OJO_PRUEBA_2=\'x=1\'\n'
                        'A_OJO_PRUEBA_3=nuevo\n', encoding='utf-8')
        os.environ['A_OJO_PRUEBA_3'] = 'viejo'
        comun.cargar_env(ruta)
        self.assertEqual(os.environ['A_OJO_PRUEBA_1'], 'A ojo – procesamiento')
        self.assertEqual(os.environ['A_OJO_PRUEBA_2'], 'x=1')
        self.assertEqual(os.environ['A_OJO_PRUEBA_3'], 'viejo')

    def test_plataforma(self):
        self.assertEqual(comun.plataforma_de('https://youtu.be/x'), 'youtube')
        self.assertEqual(comun.plataforma_de('https://www.instagram.com/reel/x/'), 'instagram')
        self.assertEqual(comun.plataforma_de('https://blog.example/x'), 'web')

    def test_dir_trabajo_rechaza_ids_raros(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()) as out:
            comun.dir_trabajo('../../etc')
        self.assertEqual(json.loads(out.getvalue())['error'], 'id_invalido')

    def test_mosaicos(self):
        self.assertEqual(frames.disposicion(1080, 1920), (360, 4, 2))
        self.assertEqual(frames.disposicion(1920, 1080), (480, 3, 3))
        self.assertEqual(frames.segundos_por_mosaico(20, 3, 4), [[0, 3, 6, 9], [12, 15, 18]])

    def test_aojo_sin_script_valido(self):
        r = subprocess.run([str(comun.DIR_PROC / 'aojo'), 'rm'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == '__main__':
    unittest.main()
