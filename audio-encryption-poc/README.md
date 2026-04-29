# Audio Encryption PoC (Phase-Stereo)

PoC local em Python para reproduzir uma protecao de audio no estilo "phase-stereo + camadas inaudiveis" com foco em degradar ASR.

## O que este PoC faz

- Aplica perturbacao de fase no dominio mid/side (estereo)
- Injeta ruido dinamico filtrado por banda (foco em faixa de fala)
- Ajusta loudness/peak para reduzir artefatos
- Permite comparar impacto de transcricao (baseline vs protegido)

## Setup

```bash
cd audio-encryption-poc
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
pip install -e .
```

Opcional para avaliacao ASR via Whisper:

```bash
pip install openai-whisper
```

## Uso rapido

Gerar arquivo protegido:

```bash
python -m audio_poc.cli protect --input "examples/input.wav" --output "examples/output.protected.wav" --preset balanced
```

Avaliar impacto no ASR (sem transcript de referencia, modo proxy):

```bash
python -m audio_poc.cli eval-asr --original "examples/input.wav" --protected "examples/output.protected.wav" --model base --language pt
```

Benchmark em lote com relatorio:

```bash
python scripts/benchmark.py --input-dir "examples/batch_in" --output-dir "examples/batch_out" --presets light balanced aggressive
```

## Interface web (upload de video/audio)

Rode a interface:

```bash
python -m audio_poc.web_ui
```

Depois abra `http://127.0.0.1:7860`.

Detalhes da interface em `web-demo/README.md`.

## Presets

- `light`: alteracao mais leve
- `balanced`: equilibrio entre mascaramento e naturalidade
- `aggressive`: maior degradacao esperada de ASR, com mais risco de artefato

## Limitacoes

- PoC, nao sistema anti-fraude definitivo
- Melhor suporte para `.wav`/`.flac` no fluxo padrao
- Medicao ASR sem ground-truth usa comparacao proxy (texto original vs protegido)
