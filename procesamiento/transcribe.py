"""Capa 4 de /recetas: transcribe el audio con faster-whisper.

Uso: transcribe <bandeja_id> [--idioma es]
Lee audio.* de ~/.a-ojo/trabajo/<bandeja_id>/ y deja transcripcion.txt con
líneas "[mm:ss] texto". Imprime una línea de JSON con el idioma y el texto.
"""
import argparse
import os
import subprocess
import time

import comun
from comun import fallar, log, salida

MODELO = os.environ.get('A_OJO_WHISPER_MODELO', 'small')


def main(argv=None):
    p = argparse.ArgumentParser(prog='transcribe')
    p.add_argument('bandeja_id')
    p.add_argument('--idioma', help='forzar el idioma (si no, se detecta solo)')
    args = p.parse_args(argv)

    d = comun.dir_trabajo(args.bandeja_id)
    audios = [a for a in d.glob('audio.*') if not a.name.endswith('.part')]
    if not audios:
        fallar('sin_audio', 'Primero corré «fetch audio» para esta fila.')

    import numpy as np
    from faster_whisper import WhisperModel  # tarda en importar: solo cuando hace falta

    inicio = time.time()
    # El audio se decodifica con ffmpeg (16 kHz, mono) y no con PyAV: las versiones
    # nuevas de PyAV rompen la decodificación interna de faster-whisper.
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(audios[0]), '-f', 's16le', '-ac', '1',
                        '-ar', '16000', '-'], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        fallar('ffmpeg', 'No pude leer el audio.', detalle=r.stderr.decode('utf-8', 'replace')[-300:])
    muestras = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0

    modelo = WhisperModel(MODELO, device='cpu', compute_type='int8')
    segmentos, info = modelo.transcribe(
        muestras,
        language=args.idioma,
        vad_filter=True,  # saltea la música sin voz
        beam_size=5,
        condition_on_previous_text=False,  # evita que repita frases en bucle
    )
    lineas = []
    for s in segmentos:
        texto = s.text.strip()
        if texto:
            seg = int(s.start)
            lineas.append(f'[{seg // 60:02d}:{seg % 60:02d}] {texto}')
    texto = '\n'.join(lineas)
    (d / 'transcripcion.txt').write_text(texto, encoding='utf-8')

    segundos = round(time.time() - inicio, 1)
    log(args.bandeja_id, 'transcribe', f'{info.language} ({info.language_probability:.2f}), '
                                      f'{len(lineas)} segmentos, {segundos} s')
    salida({
        'ok': True,
        'id': args.bandeja_id,
        'idioma': info.language,
        'probabilidad': round(info.language_probability, 2),
        'duracion_s': round(info.duration),
        'sin_voz': not lineas,
        'texto': texto,
        'archivo': str(d / 'transcripcion.txt'),
    })


if __name__ == '__main__':
    main()
