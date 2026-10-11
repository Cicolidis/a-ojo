"""Capa 5 de /recetas: arma mosaicos de fotogramas para leer el texto sobreimpreso.

Uso: frames <bandeja_id> [--cada 3]
Lee video.* de ~/.a-ojo/trabajo/<bandeja_id>/, saca 1 cuadro cada 3 segundos y
los junta en mosaicos (4×2 si el video es vertical, 3×3 si es horizontal), con
el segundo de cada cuadro sobreimpreso. Claude los lee con Read.
"""
import argparse
import json
import math
import subprocess

import comun
from comun import fallar, log, salida


def medidas(video):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=width,height:format=duration', '-of', 'json', str(video)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fallar('ffprobe', 'No pude leer el video.', detalle=(r.stderr or '')[-300:])
    datos = json.loads(r.stdout)
    stream = datos['streams'][0]
    return stream['width'], stream['height'], float(datos['format'].get('duration') or 0)


def disposicion(ancho, alto):
    """(ancho de cada cuadro, columnas, filas) según la orientación del video."""
    return (360, 4, 2) if alto > ancho else (480, 3, 3)


def segundos_por_mosaico(duracion, cada, por_mosaico):
    instantes = [i * cada for i in range(max(1, math.ceil(duracion / cada)))]
    return [instantes[i:i + por_mosaico] for i in range(0, len(instantes), por_mosaico)]


def main(argv=None):
    p = argparse.ArgumentParser(prog='frames')
    p.add_argument('bandeja_id')
    p.add_argument('--cada', type=float, default=3, help='segundos entre cuadros (por defecto, 3)')
    args = p.parse_args(argv)

    d = comun.dir_trabajo(args.bandeja_id)
    videos = [v for v in d.glob('video.*') if not v.name.endswith('.part')]
    if not videos:
        fallar('sin_video', 'Primero corré «fetch video» para esta fila.')
    video = videos[0]
    for viejo in d.glob('mosaico_*.jpg'):
        viejo.unlink()

    ancho, alto, duracion = medidas(video)
    cuadro, cols, filas = disposicion(ancho, alto)
    filtros = f'fps=1/{args.cada},scale={cuadro}:-2'
    # El segundo de cada cuadro, arriba a la izquierda. Si ffmpeg no tiene drawtext, se sigue sin él.
    marca = ("drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=white:"
             "box=1:boxcolor=black@0.6:boxborderw=4")
    salida_tpl = str(d / 'mosaico_%02d.jpg')
    for vf in (f'{filtros},{marca},tile={cols}x{filas}', f'{filtros},tile={cols}x{filas}'):
        r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(video), '-vf', vf,
                            '-fps_mode', 'vfr', '-q:v', '3', salida_tpl], capture_output=True, text=True)
        if r.returncode == 0:
            break
    else:
        fallar('ffmpeg', 'No pude sacar los fotogramas.', detalle=(r.stderr or '')[-300:])

    archivos = sorted(d.glob('mosaico_*.jpg'))
    grupos = segundos_por_mosaico(duracion, args.cada, cols * filas)
    mosaicos = [{'archivo': str(a), 'segundos': grupos[i] if i < len(grupos) else []}
                for i, a in enumerate(archivos)]
    log(args.bandeja_id, 'frames', f'{len(archivos)} mosaicos de {cols}×{filas} ({duracion:.0f} s de video)')
    salida({'ok': True, 'id': args.bandeja_id, 'duracion_s': round(duracion), 'grilla': f'{cols}x{filas}',
            'orden': 'de izquierda a derecha y de arriba abajo', 'mosaicos': mosaicos})


if __name__ == '__main__':
    main()
