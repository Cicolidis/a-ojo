"""Tests de los scripts de procesamiento. Sin red ni yt-dlp: todo simulado.

Correr con: npm run test:py
"""
import base64
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Antes de importar comun: que el log y la carpeta de trabajo no toquen ~/.a-ojo.
os.environ['A_OJO_DIR'] = tempfile.mkdtemp(prefix='a-ojo-tests-')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api  # noqa: E402
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


def correr_api(*argv):
    """Corre `api <argv>` y devuelve (JSON impreso, código de salida)."""
    codigo = 0
    with contextlib.redirect_stdout(io.StringIO()) as out:
        try:
            api.main(list(argv))
        except SystemExit as e:
            codigo = e.code
    return json.loads(out.getvalue()), codigo


TODO_CLASIFICAR = {
    'recetas': [
        {'id': 'r_nueva', 'titulo': 'Torta', 'creado': '2026-10-02T00:00:00.000Z'},
        {'id': 'r_vieja', 'titulo': 'Brownie', 'creado': '2026-10-01T00:00:00.000Z', 'porciones': 6,
         'fuente_url': 'https://youtu.be/x', 'notas_proceso': 'nada'},
        {'id': 'r_lista', 'titulo': 'Sopa', 'creado': '2026-10-03T00:00:00.000Z'},
    ],
    'ingredientes': [
        {'id': 'i_2', 'receta_id': 'r_vieja', 'orden': 2, 'nombre': 'sal', 'unidad': 'a ojo', 'rol': ''},
        {'id': 'i_1', 'receta_id': 'r_vieja', 'orden': 1, 'nombre': 'chocolate', 'unidad': 'g', 'cantidad': 200},
        {'id': 'i_3', 'receta_id': 'r_nueva', 'orden': 1, 'nombre': 'harina', 'rol': None},
        {'id': 'i_4', 'receta_id': 'r_lista', 'orden': 1, 'nombre': 'zapallo', 'rol': 'principal', 'seccion': ''},
    ],
    'pasos': [{'receta_id': 'r_vieja', 'orden': 1, 'texto': 'Derretí el chocolate.'}],
    'bandeja': [{'id': 'b_1', 'receta_id': 'r_vieja'}],
}


class TestClasificar(unittest.TestCase):
    def test_sin_clasificar_de_la_mas_vieja_a_la_mas_nueva(self):
        with mock.patch.object(api, 'llamar', return_value=TODO_CLASIFICAR):
            r, codigo = correr_api('sin-clasificar')
        self.assertEqual(codigo, 0)
        self.assertEqual([x['id'] for x in r['recetas']], ['r_vieja', 'r_nueva'])

    def test_ingredientes_en_orden_con_bandeja_y_archivo(self):
        with mock.patch.object(api, 'llamar', return_value=TODO_CLASIFICAR):
            r, _ = correr_api('ingredientes', 'r_vieja')
        self.assertEqual([i['id'] for i in r['ingredientes']], ['i_1', 'i_2'])
        self.assertEqual(r['pasos'], ['Derretí el chocolate.'])
        self.assertEqual(r['bandeja_id'], 'b_1')
        self.assertTrue(r['archivo'].endswith('r_vieja/clasificacion.json'))
        with mock.patch.object(api, 'llamar', return_value=TODO_CLASIFICAR):
            r, codigo = correr_api('ingredientes', 'r_nada0')
        self.assertEqual((r['error'], codigo), ('no_encontrada', 1))

    def test_clasificar_manda_el_archivo_y_valida_antes(self):
        archivo = comun.dir_trabajo('r_vieja') / 'clasificacion.json'
        comun.escribir_json(archivo, {'ingredientes': [
            {'id': 'i_1', 'seccion': 'Masa', 'rol': 'principal'},
            {'id': 'i_2', 'rol': 'condimento'},
        ]})
        with mock.patch.object(api, 'llamar', return_value={'id': 'r_vieja', 'ingredientes': 2}) as llamar:
            r, _ = correr_api('clasificar', 'r_vieja', '--dry-run')
            self.assertTrue(r['dry_run'])
            llamar.assert_not_called()
            r, _ = correr_api('clasificar', 'r_vieja')
        llamar.assert_called_once_with('POST', 'receta.clasificar', {'id': 'r_vieja', 'ingredientes': [
            {'id': 'i_1', 'seccion': 'Masa', 'rol': 'principal'},
            {'id': 'i_2', 'seccion': '', 'rol': 'condimento'},
        ]})
        self.assertEqual(r['ingredientes'], 2)

        comun.escribir_json(archivo, [{'id': 'i_1', 'rol': 'infaltable'}])
        with mock.patch.object(api, 'llamar') as llamar:
            r, codigo = correr_api('clasificar', 'r_vieja')
        llamar.assert_not_called()
        self.assertEqual((r['error'], codigo), ('clasificacion_invalida', 1))
        self.assertIn('infaltable', r['motivo'])


class TestCapturas(unittest.TestCase):
    def test_baja_las_capturas_a_la_carpeta_de_trabajo(self):
        imagenes = [
            {'id': 'a', 'nombre': 'b_cap01-k3x9a0-1.jpg', 'mime': 'image/jpeg', 'base64': base64.b64encode(b'uno').decode()},
            {'id': 'b', 'nombre': 'b_cap01-k3x9a0-2.png', 'mime': 'image/png', 'base64': base64.b64encode(b'dos').decode()},
        ]
        carpeta = comun.dir_trabajo('b_cap01') / 'capturas'
        carpeta.mkdir(exist_ok=True)
        (carpeta / '9.jpg').write_bytes(b'de una bajada anterior')
        with mock.patch.object(api, 'llamar', return_value={'id': 'b_cap01', 'imagenes': imagenes}) as llamar:
            r, codigo = correr_api('capturas', 'b_cap01')
        llamar.assert_called_once_with('GET', 'capturas.bajar', {'bandeja_id': 'b_cap01'})
        self.assertEqual((codigo, r['total']), (0, 2))
        self.assertEqual([Path(a).name for a in r['archivos']], ['1.jpg', '2.png'])
        self.assertEqual(Path(r['archivos'][1]).read_bytes(), b'dos')
        self.assertFalse((carpeta / '9.jpg').exists())

        with mock.patch.object(api, 'llamar', return_value={'id': 'b_cap01', 'imagenes': []}):
            r, codigo = correr_api('capturas', 'b_cap01')
        self.assertEqual((r['error'], codigo), ('sin_capturas', 1))

    def test_fila_usa_bandeja_fila(self):
        with mock.patch.object(api, 'llamar', return_value={'fila': {'id': 'b_1', 'estado': 'lista', 'otra': 'x'}}) as llamar:
            r, _ = correr_api('fila', 'b_1')
        llamar.assert_called_once_with('GET', 'bandeja.fila', {'id': 'b_1'})
        self.assertEqual((r['fila']['id'], r['fila']['estado']), ('b_1', 'lista'))
        self.assertNotIn('otra', r['fila'])

    def test_fila_con_una_api_vieja_busca_en_todo(self):
        def llamar(metodo, accion, datos=None):
            if accion == 'bandeja.fila':
                raise api.ErrorApi('accion_desconocida', 'No conozco la acción.', status=404)
            return {'bandeja': [{'id': 'b_1', 'estado': 'pendiente'}]}
        with mock.patch.object(api, 'llamar', side_effect=llamar):
            r, _ = correr_api('fila', 'b_1')
            self.assertEqual(r['fila']['estado'], 'pendiente')
            r, codigo = correr_api('fila', 'b_2')
        self.assertEqual((r['error'], codigo), ('no_encontrada', 1))

    def test_fila_no_encontrada(self):
        with mock.patch.object(api, 'llamar', side_effect=api.ErrorApi('no_encontrada', 'No encontré la fila.', status=404)):
            r, codigo = correr_api('fila', 'b_9')
        self.assertEqual((r['error'], codigo), ('no_encontrada', 1))

    def test_tomar_reserva_la_proxima(self):
        fila = {'id': 'b_1', 'estado': 'procesando', 'intentos': 2, 'otra': 'x'}
        with mock.patch.object(api, 'llamar', return_value={'filas': [fila], 'quedan': 4}) as llamar:
            r, _ = correr_api('tomar')
        llamar.assert_called_once_with('POST', 'bandeja.tomar', {'limite': 1})
        self.assertEqual((r['filas'][0]['id'], r['filas'][0]['intentos'], r['quedan']), ('b_1', 2, 4))
        self.assertNotIn('otra', r['filas'][0])
        self.assertNotIn('aviso', r)

    def test_tomar_una_fila_por_id(self):
        with mock.patch.object(api, 'llamar', return_value={'filas': [{'id': 'b_9', 'intentos': 1}], 'quedan': 0}) as llamar:
            correr_api('tomar', '--id', 'b_9')
        llamar.assert_called_once_with('POST', 'bandeja.tomar', {'id': 'b_9'})

    def test_tomar_en_dry_run_no_reserva(self):
        with mock.patch.object(api, 'llamar', return_value={'filas': [{'id': 'b_1'}, {'id': 'b_2'}]}) as llamar:
            r, _ = correr_api('tomar', '--dry-run')
        llamar.assert_called_once_with('GET', 'bandeja.pendientes')
        self.assertEqual(([f['id'] for f in r['filas']], r['quedan'], r['dry_run']), (['b_1'], 1, True))

    def test_tomar_con_una_api_vieja(self):
        llamadas = []

        def llamar(metodo, accion, datos=None):
            llamadas.append(accion)
            if accion == 'bandeja.tomar':
                raise api.ErrorApi('accion_desconocida', 'No conozco la acción.', status=404)
            if accion == 'bandeja.pendientes':
                return {'filas': [{'id': 'b_1', 'estado': 'pendiente'}]}
            return {'id': 'b_1', 'estado': 'procesando', 'intentos': 1}
        with mock.patch.object(api, 'llamar', side_effect=llamar):
            r, _ = correr_api('tomar')
        self.assertEqual(llamadas, ['bandeja.tomar', 'bandeja.pendientes', 'bandeja.actualizar'])
        self.assertEqual((r['filas'][0]['estado'], r['filas'][0]['intentos']), ('procesando', 1))
        self.assertIn('desplegarla', r['aviso'])

    def test_tomar_sin_filas(self):
        with mock.patch.object(api, 'llamar', return_value={'filas': [], 'quedan': 0}):
            r, codigo = correr_api('tomar')
        self.assertEqual((r['ok'], r['filas'], codigo), (True, [], 0))

    def test_las_filas_dicen_si_tienen_capturas(self):
        with mock.patch.object(api, 'llamar', return_value={'filas': [{'id': 'b_1', 'url': 'u', 'capturas': 'x,y'}]}):
            r, _ = correr_api('pendientes')
        self.assertEqual(r['filas'][0]['capturas'], 'x,y')

    def test_foto_desde_una_captura(self):
        captura = comun.dir_trabajo('b_foto1') / 'capturas' / '2.jpg'
        captura.parent.mkdir(exist_ok=True)
        captura.write_bytes(b'imagen')

        def convertir(cmd, **_):
            Path(cmd[-1]).write_bytes(b'jpg')
            return subprocess.CompletedProcess(cmd, 0, '', '')

        with mock.patch.object(fetch.subprocess, 'run', side_effect=convertir) as run, \
                contextlib.redirect_stdout(io.StringIO()) as out:
            fetch.main(['foto', 'b_foto1', '--archivo', str(captura)])
        self.assertEqual(json.loads(out.getvalue())['origen'], 'imagen 2.jpg')
        cmd = run.call_args[0][0]
        self.assertEqual(cmd[cmd.index('-i') + 1], str(captura))

        with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()) as out:
            fetch.main(['foto', 'b_foto1', '--archivo', '/no/existe.jpg'])
        self.assertEqual(json.loads(out.getvalue())['error'], 'sin_archivo')


INFO_COMENTARIOS = {
    'id': '3m8wnoPpR-M', 'title': 'Mantequilla de ajo', 'description': '', 'formats': [{'url': 'x'}],
    'comments': [
        {'text': 'Delicioso', 'author_is_uploader': False, 'is_pinned': False},
        {'text': 'MANTEQUILLA DE AJO\n\n- 50 dientes de ajo\n', 'author_is_uploader': True, 'is_pinned': False},
        {'text': 'Receta completa abajo 👇', 'author_is_uploader': True, 'is_pinned': True},
        {'text': 'Fijado por el autor, de otra persona', 'author_is_uploader': False, 'is_pinned': True},
        {'text': '   ', 'author_is_uploader': True},
    ],
}


def correr_fetch(*argv):
    """Corre `fetch <argv>` y devuelve (JSON impreso, código de salida)."""
    codigo = 0
    with contextlib.redirect_stdout(io.StringIO()) as out:
        try:
            fetch.main(list(argv))
        except SystemExit as e:
            codigo = e.code
    return json.loads(out.getvalue()), codigo


class TestComentarios(unittest.TestCase):
    URL = 'https://www.youtube.com/shorts/3m8wnoPpR-M'

    def test_solo_los_del_autor_o_fijados(self):
        r = Resultado(0, stdout=json.dumps(INFO_COMENTARIOS))
        with mock.patch.object(comun, 'correr_ytdlp', return_value=r) as correr:
            datos, codigo = correr_fetch('comentarios', 'b_com01', self.URL)
        self.assertEqual(codigo, 0)
        self.assertEqual(datos['revisados'], 5)
        self.assertEqual([(c['texto'], c['fijado'], c['del_autor']) for c in datos['comentarios']], [
            ('Receta completa abajo 👇', True, True),
            ('Fijado por el autor, de otra persona', True, False),
            ('MANTEQUILLA DE AJO\n\n- 50 dientes de ajo', False, True),
        ])
        self.assertNotIn('formats', json.dumps(datos), 'sin el info.json entero')
        guardado = comun.leer_json(comun.dir_trabajo('b_com01') / 'comentarios.json')
        self.assertEqual(guardado, datos['comentarios'])
        self.assertFalse((comun.dir_trabajo('b_com01') / 'info.json').exists(), 'no pisa el de fetch meta')

        args, plataforma, _ = correr.call_args[0]
        self.assertEqual(plataforma, 'youtube')
        self.assertIn('--write-comments', args)
        self.assertIn('--skip-download', args)
        self.assertEqual(args[args.index('--extractor-args') + 1], 'youtube:max_comments=30,all,0,0;comment_sort=top')
        self.assertEqual(args[-1], self.URL)

    def test_sin_comentarios(self):
        r = Resultado(0, stdout=json.dumps({'id': 'x', 'comments': None}))
        with mock.patch.object(comun, 'correr_ytdlp', return_value=r):
            datos, codigo = correr_fetch('comentarios', 'b_com02', self.URL)
        self.assertEqual((codigo, datos['comentarios'], datos['revisados']), (0, [], 0))

    def test_errores_clasificados_como_en_meta(self):
        error = comun.clasificar_error('ERROR: [youtube] 3m8wnoPpR-M: Video unavailable', 'youtube')
        with mock.patch.object(comun, 'correr_ytdlp', side_effect=error):
            datos, codigo = correr_fetch('comentarios', 'b_com03', self.URL)
        self.assertEqual(codigo, 1)
        self.assertEqual((datos['ok'], datos['error'], datos['id']), (False, 'no_disponible', 'b_com03'))
        self.assertEqual(datos['motivo'], 'El video ya no está disponible.')

    def test_solo_youtube(self):
        with mock.patch.object(comun, 'correr_ytdlp') as correr:
            datos, codigo = correr_fetch('comentarios', 'b_com04', 'https://www.instagram.com/reel/x/')
        self.assertEqual((codigo, datos['error']), (1, 'no_youtube'))
        correr.assert_not_called()


def foto_del_post(n):
    return {'id': f'foto{n}', 'title': 'Video by nutricionsgf', 'description': 'TARTA DE ZANAHORIA',
            'channel': 'nutricionsgf', 'uploader': 'Lic. Sofia', 'extractor_key': 'Instagram',
            'formats': [], 'thumbnail': f'https://cdn.example/foto{n}.jpg'}


# Así llega un post de varias fotos con --ignore-no-formats-error: el caption arriba y una entrada por foto.
INFO_POST_FOTOS = {
    '_type': 'playlist', 'id': 'DdH7W31kem0', 'title': 'Post by nutricionsgf',
    'description': 'TARTA DE ZANAHORIA\n\n150 grs de harina integral', 'channel': 'nutricionsgf',
    'uploader_id': '7779783639', 'uploader': 'Lic. Sofia', 'extractor_key': 'Instagram',
    'webpage_url': 'https://www.instagram.com/p/DdH7W31kem0/',
    'entries': [foto_del_post(1), foto_del_post(2)],
}


class TestMetaInstagram(unittest.TestCase):
    def correr_meta(self, bandeja_id, url, info):
        r = Resultado(0, stdout=json.dumps(info))
        with mock.patch.object(comun, 'args_cookies', return_value=['--cookies', 'c.txt']), \
                mock.patch.object(comun, 'correr_ytdlp', return_value=r) as correr:
            datos, codigo = correr_fetch('meta', bandeja_id, url)
        self.assertEqual(codigo, 0)
        return datos, correr.call_args[0][0]

    def test_post_de_fotos_trae_caption_autor_y_miniatura(self):
        datos, args = self.correr_meta('b_post1', 'https://www.instagram.com/p/DdH7W31kem0/', INFO_POST_FOTOS)
        self.assertIn('--ignore-no-formats-error', args)
        self.assertEqual(datos['descripcion'], 'TARTA DE ZANAHORIA\n\n150 grs de harina integral')
        self.assertEqual(datos['titulo'], 'Post by nutricionsgf')
        self.assertEqual(datos['autor'], {'nombre': 'Lic. Sofia', 'cuenta': '@nutricionsgf'})
        self.assertEqual(datos['miniatura'], 'https://cdn.example/foto1.jpg')
        self.assertTrue(datos['sin_video'])
        # fetch foto lee la miniatura de info.json.
        d = comun.dir_trabajo('b_post1')
        self.assertEqual(fetch.candidatos_foto(d), [('https://cdn.example/foto1.jpg', 'miniatura')])

    def test_reel_sigue_igual(self):
        reel = {**foto_del_post(1), 'title': 'Video by paulinacocina', 'formats': [{'url': 'x'}], 'duration': 41}
        datos, args = self.correr_meta('b_post2', 'https://www.instagram.com/reel/DbT7v9Hh6Or/', reel)
        self.assertIn('--ignore-no-formats-error', args)
        self.assertEqual((datos['titulo'], datos['duracion_s'], datos['sin_video']), ('Video by paulinacocina', 41, False))

    def test_youtube_no_ignora_la_falta_de_formatos(self):
        video = {'id': 'abc', 'title': 'Budín', 'description': '', 'formats': [{'url': 'x'}], 'extractor_key': 'Youtube'}
        with mock.patch.object(fetch, 'bajar_subtitulos', return_value=None):
            datos, args = self.correr_meta('b_post3', 'https://www.youtube.com/watch?v=abc', video)
        self.assertNotIn('--ignore-no-formats-error', args)
        self.assertFalse(datos['sin_video'])


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

    def test_aojo_sin_venv(self):
        # Una copia de aojo en una carpeta sin .venv: así es una máquina sin ./setup.sh (o CI).
        dir_copia = Path(tempfile.mkdtemp())
        copia = dir_copia / 'aojo'
        copia.write_bytes((comun.DIR_PROC / 'aojo').read_bytes())
        copia.chmod(0o755)
        r = subprocess.run([str(copia), 'rm'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn('Uso:', r.stderr)
        r = subprocess.run([str(copia), 'api', 'ping'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(json.loads(r.stdout)['error'], 'sin_setup')


if __name__ == '__main__':
    unittest.main()
