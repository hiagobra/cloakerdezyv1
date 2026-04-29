# Web Demo

Interface web para testar rapido o pipeline de protecao de audio com upload de video/audio.

## Rodar

No diretorio `audio-encryption-poc`:

```bash
pip install -r requirements.txt
pip install -e .
python -m audio_poc.web_ui
```

Abra no navegador:

- `http://127.0.0.1:7860`

## Como funciona

- Upload de video (`.mp4`, `.mov`, `.avi`, `.webm`, `.mkv`) ou audio (`.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.aac`)
- Escolha preset `light`, `balanced` ou `aggressive`
- O app gera o arquivo protegido e libera download
- Os resultados ficam em `web-demo/outputs`

## Requisito para video

Para processar video, precisa do `ffmpeg` instalado e visivel no `PATH`.
