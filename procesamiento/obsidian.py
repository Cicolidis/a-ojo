"""Exporta las recetas de A ojo a una carpeta de Obsidian: una nota .md por receta.

Uso (por medio de procesamiento/aojo):
  obsidian [--carpeta RUTA] [--dry-run]

La carpeta sale de --carpeta o de A_OJO_OBSIDIAN en el .env. Cada nota lleva en sus
propiedades el id de la receta (a_ojo_id): así, si cambia el título, la nota se renombra
en lugar de duplicarse. Las notas se reescriben en cada exportación (solo si cambió algo),
así que no conviene editarlas a mano. Las recetas descartadas no se exportan; si ya había
una nota de una receta que después se descartó, queda como está.
Solo biblioteca estándar. Imprime una línea de JSON, como los demás scripts.
"""
import argparse
import json
import math
import os
import re
from pathlib import Path

import api
import comun
from comun import fallar, salida

ROLES = ('principal', 'condimento', 'opcional', 'utensilio')
SIN_SECCION = '-'
# Lo que repite a app/js/formato.js e ingredientes.js tiene sus casos en tests/fixtures/formato.json,
# que leen los tests de los dos lados: si se cambia algo acá, se cambia también allá.
# Cómo se muestra cada valor de `quien` (como NOMBRES de app/js/formato.js).
NOMBRES = {'camilo': 'Camilo', 'pareja': 'Laura'}
PLURALES = {'cda': 'cdas', 'cdita': 'cditas', 'taza': 'tazas', 'pizca': 'pizcas', 'lata': 'latas',
            'paquete': 'paquetes', 'diente': 'dientes', 'ramo': 'ramos'}
FRACCIONES = ((1 / 4, '¼'), (1 / 3, '⅓'), (1 / 2, '½'), (2 / 3, '⅔'), (3 / 4, '¾'))
CAPAS = {'descripcion': 'la descripción del video', 'subtitulos': 'los subtítulos', 'web': 'la receta de la web',
         'audio': 'lo que se dice en el audio', 'frames': 'el texto que aparece en el video',
         'capturas': 'las capturas que mandaron'}
CONFIANZA = {'alta': 'Los datos están completos: salieron del texto, los subtítulos o un audio claro.',
             'media': 'Hubo que estimar algunos pasos o completar algo por contexto.',
             'baja': 'Faltan cantidades importantes: mirá el video antes de empezar.'}
ESTADOS = {'para_probar': 'para probar', 'probada': 'probada', 'favorita': 'favorita', 'descartada': 'descartada'}
AVISO = '> [!info] Exportada de A ojo\n> Esta nota se reescribe cada vez que se exporta: lo que cambies acá se pierde. Editá la receta en la app.'


# Formato (como app/js/formato.js e ingredientes.js)

def redondear(x):
    """Como Math.round de JS: los .5 van para arriba (round() de Python los lleva al par)."""
    return math.floor(x + 0.5)


def numero_js(x):
    """Como String(x) de JS para un número: 3.0 → «3», 2.5 → «2.5»."""
    return str(int(x)) if x == int(x) else repr(x)


def rol_de(ing):
    rol = ing.get('rol_usuario') or ing.get('rol')
    return rol if rol in ROLES else 'principal'


def seccion_de(ing):
    if ing.get('seccion_usuario') == SIN_SECCION:
        return ''
    return str(ing.get('seccion_usuario') or ing.get('seccion') or '').strip()


def a_numero(valor):
    """Como Number() de JS, pero NaN si no es un número finito ('' y None también)."""
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return math.nan
    return n if math.isfinite(n) else math.nan


def numero(n, fracciones=True):
    """formatearNumero: 1.5 → «1 ½», 0.25 → «¼»; si no es una fracción común, con coma decimal."""
    entero = math.floor(n)
    resto = n - entero
    if resto < 0.01:
        return str(entero)
    if fracciones:
        for valor, simbolo in FRACCIONES:
            if abs(resto - valor) < 0.02:
                return f'{entero} {simbolo}' if entero else simbolo
    return numero_js(redondear(n * 100) / 100).replace('.', ',')


def formatear_cantidad(cantidad, unidad):
    """formatearCantidad: «200 g», «2 cdas», «½ taza», «3» o «a ojo»."""
    n = a_numero(cantidad)
    if unidad == 'a ojo' or math.isnan(n) or n <= 0:
        return 'a ojo'
    texto = numero(n, fracciones=unidad not in ('g', 'ml'))
    if unidad in ('u', '', None):
        return texto
    return f'{texto} {PLURALES.get(unidad, unidad) if n > 1 else unidad}'


def cantidad(ing):
    """La cantidad de un ingrediente, o '' si es «a ojo» (en la nota no se dice)."""
    texto = formatear_cantidad(ing.get('cantidad'), ing.get('unidad'))
    return '' if texto == 'a ojo' else texto


def minutos(m):
    """formatearMinutos: 45 → «45 min», 60 → «1 h», 75 → «1 h 15 min»."""
    m = a_numero(m)
    if math.isnan(m):
        return ''
    m = redondear(m)
    if m <= 0:
        return ''
    if m < 60:
        return f'{m} min'
    return f'{m // 60} h' + (f' {m % 60} min' if m % 60 else '')


def unir_con_y(partes):
    partes = list(partes)
    return ', '.join(partes[:-1]) + ' y ' + partes[-1] if len(partes) > 1 else ''.join(partes)


def capitalizar(texto):
    texto = str(texto or '')
    return texto[:1].upper() + texto[1:]


def lista_texto(valor):
    return [x.strip() for x in str(valor or '').split(',') if x.strip()]


def texto_origen(origen):
    """textoOrigen: «descripcion,subtitulos» → «la descripción del video y los subtítulos»."""
    return unir_con_y(CAPAS.get(c, c) for c in lista_texto(origen))


def detalle(ing):
    partes = [x for x in (cantidad(ing), str(ing.get('nota') or '').strip()) if x]
    return f' ({", ".join(partes)})' if partes else ''


def fecha(iso):
    """«2026-09-12T…» → «12/9/2026»."""
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    return f'{int(m[3])}/{int(m[2])}/{m[1]}' if m else ''


# Una receta como nota de Obsidian

def yaml(valor):
    """Un valor de frontmatter: texto entre comillas si hace falta, listas en una línea."""
    if isinstance(valor, list):
        return '[' + ', '.join(yaml(v) for v in valor) + ']'
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return f'{valor:g}'
    return json.dumps(str(valor), ensure_ascii=False)


def nota_markdown(receta, ingredientes, pasos, notas):
    """El texto de la nota: propiedades, ingredientes por sección y rol, pasos, nuestras notas y «Cómo se armó»."""
    propiedades = {
        'a_ojo_id': receta['id'],
        'tipo': receta.get('tipo'),
        'etiquetas': lista_texto(receta.get('etiquetas')),
        'estado': ESTADOS.get(receta.get('estado'), receta.get('estado')),
        'valoracion': receta.get('valoracion') or None,
        'porciones': receta.get('porciones'),
        'tiempo': minutos(receta.get('tiempo_min')),
        'molde': receta.get('molde'),
        'autor': receta.get('autor'),
        'fuente': receta.get('fuente_url'),
        'foto': receta.get('foto_url'),
        'confianza': receta.get('confianza'),
        'tags': ['receta'],
    }
    lineas = ['---'] + [f'{k}: {yaml(v)}' for k, v in propiedades.items() if v not in (None, '', [])] + ['---', '', AVISO, '']

    if receta.get('foto_url'):
        lineas += [f'![{receta.get("titulo", "")}]({receta["foto_url"]})', '']
    datos = [x for x in (f'Para {receta["porciones"]:g} porciones' if receta.get('porciones') else '',
                         minutos(receta.get('tiempo_min')),
                         f'Molde {receta["molde"]}' if receta.get('molde') else '') if x]
    fuente = receta.get('fuente_url') or ''
    if fuente.startswith(('http://', 'https://')):
        datos.append(f'[Ver el video]({fuente})' + (f' de {receta["autor"]}' if receta.get('autor') else ''))
    if datos:
        lineas += [' · '.join(datos), '']

    # Ingredientes: por sección (en orden de aparición) y, dentro, principales, condimentos y opcionales.
    secciones, utensilios = {}, []
    for ing in sorted(ingredientes, key=lambda i: i.get('orden') or 0):
        if rol_de(ing) == 'utensilio':
            utensilios.append(ing)
            continue
        s = secciones.setdefault(seccion_de(ing), {'principal': [], 'condimento': [], 'opcional': []})
        s[rol_de(ing)].append(ing)
    if '' in secciones:
        secciones = {'': secciones.pop(''), **secciones}
    lineas.append('## Ingredientes')
    for nombre, s in secciones.items():
        if nombre and len(secciones) > 1:
            lineas += ['', f'### {nombre}']
        for ing in s['principal']:
            lineas.append(f'- {capitalizar(ing.get("nombre"))}' + (f': {cantidad(ing)}' if cantidad(ing) else '')
                          + (f' ({ing["nota"].strip()})' if str(ing.get('nota') or '').strip() else ''))
        if s['condimento']:
            lineas.append('- ' + capitalizar(unir_con_y(i.get('nombre', '') + detalle(i) for i in s['condimento'])))
        for ing in s['opcional']:
            lineas.append(f'- {capitalizar(ing.get("nombre"))}' + (f': {cantidad(ing)}' if cantidad(ing) else '') + ' *(opcional)*')
    if utensilios:
        lineas += ['', 'También vas a necesitar: ' + unir_con_y(i.get('nombre', '') + detalle(i) for i in utensilios) + '.']

    lineas += ['', '## Pasos']
    for n, paso in enumerate(sorted(pasos, key=lambda p: p.get('orden') or 0), 1):
        lineas.append(f'{n}. {str(paso.get("texto") or "").strip()}')
        if str(paso.get('tip') or '').strip():
            lineas.append(f'    *{paso["tip"].strip()}*')

    vivas = sorted((x for x in notas if not x.get('borrada')), key=lambda x: str(x.get('fecha') or ''), reverse=True)
    if vivas:
        lineas += ['', '## Nuestras notas']
        for x in vivas:
            quien = NOMBRES.get(str(x.get('quien') or '').lower(), 'Nuestra nota')
            texto = str(x.get('texto') or '').strip().replace('\n', ' ')
            lineas.append(f'- **{quien} · {fecha(x.get("fecha"))}:** {texto}')

    origen = texto_origen(receta.get('origen_datos'))
    armado = [x for x in (f'Salió de {origen}.' if origen else '', CONFIANZA.get(receta.get('confianza'), ''),
                          str(receta.get('notas_proceso') or '').strip()) if x]
    if armado:
        lineas += ['', '## Cómo se armó', '', '\n\n'.join(armado)]
    return '\n'.join(lineas) + '\n'


# Archivos

PROHIBIDOS = re.compile(r'[\\/:*?"<>|#^\[\]]')


def nombre_archivo(titulo):
    """El título como nombre de archivo válido en Obsidian (sin / : # ^ [ ] …)."""
    limpio = re.sub(r'\s+', ' ', PROHIBIDOS.sub(' ', str(titulo or ''))).strip(' .')
    return (limpio or 'Receta sin título')[:120]


def id_de_nota(ruta):
    """El a_ojo_id de las propiedades de una nota, o None."""
    try:
        with open(ruta, encoding='utf-8') as f:
            cabeza = f.read(2000)
    except OSError:
        return None
    m = re.match(r'---\n(.*?)\n---', cabeza, re.S)
    if not m:
        return None
    m = re.search(r'^a_ojo_id:\s*"?([\w-]+)"?\s*$', m[1], re.M)
    return m[1] if m else None


def exportar(todo, carpeta, dry_run=False):
    """Escribe una nota por receta (no descartada) en `carpeta`. Devuelve el resumen."""
    carpeta = Path(carpeta).expanduser()
    if not dry_run:
        carpeta.mkdir(parents=True, exist_ok=True)
    existentes = {}
    if carpeta.is_dir():
        for ruta in carpeta.glob('*.md'):
            rid = id_de_nota(ruta)
            if rid:
                existentes[rid] = ruta

    def de(clave, rid):
        return [x for x in todo.get(clave) or [] if x.get('receta_id') == rid]

    resumen = {'escritas': 0, 'sin_cambios': 0, 'renombradas': 0, 'descartadas': 0}
    usados = set()
    for receta in sorted(todo.get('recetas') or [], key=lambda r: str(r.get('creado') or '')):
        if receta.get('estado') == 'descartada':
            resumen['descartadas'] += 1
            continue
        base = nombre_archivo(receta.get('titulo'))
        nombre, n = base, 2
        while nombre.lower() in usados:
            nombre, n = f'{base} ({n})', n + 1
        usados.add(nombre.lower())
        destino = carpeta / f'{nombre}.md'
        texto = nota_markdown(receta, de('ingredientes', receta['id']), de('pasos', receta['id']), de('notas', receta['id']))

        # Nunca se pisa una nota que no es de esta receta (otra receta o una nota tuya con ese nombre).
        if destino.exists() and id_de_nota(destino) != receta['id']:
            fallar('nombre_ocupado', f'Ya hay una nota «{destino.name}» que no es de esta receta: no la toco. '
                   'Renombrala o mové la exportación a otra carpeta.')
        anterior = existentes.get(receta['id'])
        if anterior and anterior != destino:
            resumen['renombradas'] += 1
            if not dry_run:
                os.replace(anterior, destino)
        actual = destino.read_text(encoding='utf-8') if destino.exists() else None
        if actual == texto:
            resumen['sin_cambios'] += 1
            continue
        resumen['escritas'] += 1
        if not dry_run:
            destino.write_text(texto, encoding='utf-8')
    return {'carpeta': str(carpeta), **resumen}


def main(argv=None):
    p = argparse.ArgumentParser(prog='obsidian')
    p.add_argument('--carpeta', help='carpeta de la bóveda (si no, A_OJO_OBSIDIAN del .env)')
    p.add_argument('--dry-run', action='store_true', help='no escribe nada: solo cuenta')
    args = p.parse_args(argv)
    carpeta = args.carpeta or os.environ.get('A_OJO_OBSIDIAN', '').strip()
    if not carpeta:
        fallar('sin_carpeta', 'Falta la carpeta: pasá --carpeta o poné A_OJO_OBSIDIAN en el .env.')
    resumen = exportar(api.llamar('GET', 'todo'), carpeta, dry_run=args.dry_run)
    comun.log('obsidian', 'exportar', json.dumps(resumen, ensure_ascii=False))
    salida({'ok': True, 'dry_run': args.dry_run, **resumen})


if __name__ == '__main__':
    main()
