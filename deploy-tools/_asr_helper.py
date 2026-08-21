# -*- coding: utf-8 -*-
"""蝶翅 ASR 独立子进程：faster-whisper 转写 wav -> 文本。
独立进程隔离 ctranslate2 与 torch 的 CUDA 上下文，避免共存拖慢视觉推理。"""
import os
import sys

os.environ['PATH'] = (r'D:\桌面\振翅新科\models\llama.cpp-cuda' + os.pathsep
                      + os.environ.get('PATH', ''))

def main():
    wav_path, out_path = sys.argv[1], sys.argv[2]
    text = ''
    try:
        from faster_whisper import WhisperModel
        try:
            model = WhisperModel('small', device='cuda', compute_type='float16')
        except Exception:
            model = WhisperModel('small', device='cpu', compute_type='int8')
        segments, _info = model.transcribe(wav_path, language=None, vad_filter=True)
        parts = [s.text.strip() for s in segments]
        text = ' '.join(p for p in parts if p)
    except Exception as exc:
        sys.stderr.write('asr helper error: %s\n' % exc)
    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(text or '')
    except Exception:
        pass

if __name__ == '__main__':
    main()
