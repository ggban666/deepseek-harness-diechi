# -*- coding: utf-8 -*-
"""蝶翅 ASR 常驻子进程：faster-whisper 转写 wav -> 文本。
启动时加载一次模型，之后通过 stdin/stdout 按行 JSON 收发任务，避免每次调用重复冷启动。
协议（每行一个 JSON）：
  req : {"id": <int>, "wav": "<base64 16k 单声道 wav>"}
  resp: {"id": <int>, "text": "<识别文本>"}
失败或无声时 text 为空串，进程继续存活。
"""
import base64
import json
import os
import sys
import tempfile

os.environ['PATH'] = (r'D:\桌面\振翅新科\models\llama.cpp-cuda' + os.pathsep
                      + os.environ.get('PATH', ''))

def _utf8_stdio():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except Exception:
            pass

def _load():
    from faster_whisper import WhisperModel
    try:
        return WhisperModel('small', device='cuda', compute_type='float16')
    except Exception as exc:
        sys.stderr.write('asr worker cuda load failed: %s\n' % exc)
        return WhisperModel('small', device='cpu', compute_type='int8')

def main():
    _utf8_stdio()
    model = _load()
    sys.stderr.write('asr worker ready\n')
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            job_id = req.get('id')
            wav = base64.b64decode(req.get('wav') or '')
            if not wav:
                sys.stdout.write(json.dumps({'id': job_id, 'text': ''}, ensure_ascii=False) + '\n')
                sys.stdout.flush()
                continue
            tmp = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                    f.write(wav)
                    tmp = f.name
                segments, _info = model.transcribe(tmp, language=None, vad_filter=True)
                parts = [seg.text.strip() for seg in segments]
                text = ' '.join(p for p in parts if p)
            finally:
                if tmp:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
            sys.stdout.write(json.dumps({'id': job_id, 'text': text}, ensure_ascii=False) + '\n')
            sys.stdout.flush()
        except Exception as exc:
            sys.stderr.write('asr worker job error: %s\n' % exc)
            sys.stderr.flush()
            try:
                sys.stdout.write(json.dumps({'id': req.get('id'), 'text': ''}, ensure_ascii=False) + '\n')
                sys.stdout.flush()
            except Exception:
                pass

if __name__ == '__main__':
    main()


