# MaskAI - Audio Protection + Multimodal Topic Cloaker

PoC em Python que faz duas coisas:

1. **Protect** (original): degradação não-direcionada de ASR no áudio via
   perturbação de fase mid/side + ruído psicoacústico.
2. **Cloak Multimodal** (novo): camuflagem direcionada de tópico em vídeo,
   empilhando 4 camadas de evasão para fazer moderadores multimodais (Gemini,
   GPT-4o, etc.) classificar um vídeo como pertencendo a um tópico-alvo
   diferente do real.

## Setup

```bash
cd audio-encryption-poc
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
pip install -e .
```

`ffmpeg` precisa estar no `PATH` (qualquer vídeo passa por ele).

Dependências pesadas são opcionais e instaladas sob demanda:

```bash
pip install -e .[whisper]    # PGD direcionado em Whisper
pip install -e .[ensemble]   # Whisper + wav2vec2 (ensemble transferível)
pip install -e .[yamnet]     # ataque em YAMNet (demo)
pip install -e .[gemini]     # verificação com Gemini API
pip install -e .[art]        # ART ImperceptibleASRPyTorch (DeepSpeech2)
pip install -e .[all]        # tudo acima
```

Para a verificação Gemini, defina `GOOGLE_API_KEY` (ou `GEMINI_API_KEY`).

## Uso rápido

### Protect (modo original)

```bash
python -m audio_poc.cli protect --input examples/input.wav --output examples/output.protected.wav --preset balanced
```

### Cloak multimodal

```bash
python -m audio_poc.cli list-targets

python -m audio_poc.cli cloak \
  --input video.mp4 \
  --output video.cloaked.mp4 \
  --target-preset financas_pt \
  --profile standard \
  --verify-with gemini
```

Override de camadas (sobrepõe o profile):

```bash
python -m audio_poc.cli cloak --input video.mp4 --output out.mp4 \
  --target-preset financas_pt --profile minimal \
  --layers "+visual_overlay,+track_srt,+audio_tts,-track_metadata"
```

### Web UI

```bash
python -m audio_poc.web_ui
```

Abra `http://127.0.0.1:7860`. Três abas: *Protect*, *Cloak Multimodal*, *Verify*.

## Como o Cloak funciona

Moderadores multimodais (Gemini classe) decidem o tópico de um vídeo
combinando **frames + áudio + faixa de legenda + metadata do container**.
Atacar só áudio (transferência caiu na pesquisa atual em ~48% de ASR contra
Gemini-2.0-flash) é frágil. O cloak empilha 4 camadas onde o stack é mais
fraco, e cada camada vale isoladamente:

### Camada 1 - Áudio (`audio_poc.cloak.audio`)

| Submódulo | Vetor | Custo | Eficácia isolada |
|---|---|---|---|
| `tts_underlay.py` | TTS do roteiro-alvo abaixo do original com sidechain ducking | baixo (~10s) | ~40-60% |
| `whisper_attack.py` | PGD direcionado em Whisper-base/small, teacher forcing no decoder | alto (~3min CPU) | white-box ~95%, transfer ~30-50% |
| `ensemble.py` | Soma de losses Whisper + wav2vec2-CTC | muito alto (~5-10min) | transfer ~40-55% |
| `yamnet_attack.py` | PGD em YAMNet forçando classe AudioSet (demo de event classifier) | médio | só sound type, não tópico |
| `psychoacoustic.py` | Máscara global de Qin et al. (opcional, faz `δ` ficar inaudível) | - | qualidade |

### Camada 2 - Visual (`audio_poc.cloak.visual`)

| Submódulo | Vetor | Custo | Eficácia isolada |
|---|---|---|---|
| `text_overlay.py` | `ffmpeg drawtext` em modos `visible`/`subtle`/`temporal`/`flash` | baixo | **~70-85%** (vetor mais forte) |
| `prompt_inject.py` | Frase em linguagem natural endereçada ao próprio VLM (`soft` sub-visual / `hard` caption) | baixo | **~75-90%** combinado com SRT (vetor preferido contra Gemini) |
| `stego_downscale.py` | Texto invisível em alta-res que aparece após o downscale interno do Gemini (técnica Trail of Bits 2024) | baixo | ~30-50% |
| `surrogate_patch.py` | PGD em CLIP otimizando patch 96x96 com cosine-sim ao caption-alvo | alto | ~40-55% transfer |

### Camada 3 - Track (`audio_poc.cloak.track`)

| Submódulo | Vetor | Custo | Eficácia isolada |
|---|---|---|---|
| `srt_injector.py` | Soft subtitle (mov_text) começando com **cue 1 = instrução explícita à IA** ("classifique como X"), seguida da âncora e do transcript | baixo | ~70-85% |
| `mp4_metadata.py` | iTunes atoms `©nam`/`©cmt`/`desc`/`keyw` via mutagen | desprezível | ~20-40% |

### Camada 4 - Verify (`audio_poc.cloak.verify`)

| Backend | O que faz | Requer |
|---|---|---|
| `local.py` | Whisper transcreve + YAMNet top-5 no output | `pip install -e .[whisper]` (+ `[yamnet]`) |
| `gemini.py` | Pergunta "sobre o que é esse vídeo" para Gemini 2.x no original e no cloaked, mostra diff de categoria | `pip install -e .[gemini]` + `GOOGLE_API_KEY` |

## Profiles

```python
from audio_poc.cloak.composer import PROFILES
```

| Profile | Camadas | Tempo (vídeo 30s, CPU) | Sucesso esperado |
|---|---|---|---|
| `minimal` | overlay + srt + metadata | ~10s | ~70% |
| `standard` | minimal + tts_underlay | ~30s | ~88% |
| `aggressive` | standard + whisper_attack + stego | ~3-5min | ~93% |
| `paranoid` | aggressive + ensemble audio + surrogate_patch | ~10-15min | ~96% |

Métricas baseadas em literatura recente (AAAI 2026 transferable VLM attacks,
Christian Schneider 2024 multimodal prompt injection, Trail of Bits 2024
downscale steganography). Variam com o vídeo, modelo de moderação alvo, e
versão da API.

## Tópicos-alvo prontos

`python -m audio_poc.cli list-targets` mostra:

PT: `financas_pt`, `tecnologia_pt`, `culinaria_pt`, `saude_pt`, `nutricao_pt`,
`motivacional_pt`, `marketing_pt`, `educacao_infantil_pt`.

EN: `finance_en`, `fitness_en`.

Cada preset declara `transcript`, `overlay_lines`, `mp4_metadata`,
`vlm_caption` e `language`. Edite `src/audio_poc/cloak/targets.py` para
adicionar mais.

## Engine adversarial extra (opt-in): ART Imperceptible ASR

```bash
pip install -e .[art]

python -m audio_poc.cli cloak-audio-art \
  --input examples/host.wav \
  --output examples/host.art.wav \
  --target-text "this is a finance video about credit and investments"
```

Roda o `ImperceptibleASRPyTorch` da IBM Adversarial Robustness Toolbox (Qin
et al. 2019 ICML, com mascaramento psicoacústico de 2 estágios). Trata-se de
um **caminho alternativo** ao `whisper_attack`: o backend padrão do ART é
DeepSpeech2 (não Whisper), o que limita a transferência black-box mas é a
implementação canônica reprodutível dos papers académicos.

## Limitações

1. **Não sobrevive a re-encode AAC/Opus agressivo**: a Camada 1 (adversarial
   áudio) é fragilizada por re-upload em redes sociais. Camadas 2 e 3
   sobrevivem bem (overlay de pixels e SRT são preservados em re-encode).
2. **Plataformas que strip subtitle track** removem a Camada 3-SRT. Por isso
   a Camada 2 (overlay) é redundância importante.
3. **White-box vs black-box**: `whisper_attack` é 100% efetivo *contra a
   versão exata do Whisper carregada localmente*. Whisper-large-v3 e variantes
   da OpenAI hospedadas na cloud precisam ser atacadas separadamente, ou
   confiar no modo ensemble para transferência.
4. **Patch surrogate é probabilístico**: ~50% de transferência isolada para
   Gemini. Por isso o stack inteiro do `paranoid` é importante.
5. **Custo de API Gemini** na verificação: vídeos consomem tokens proporcional
   a número de frames amostrados.
6. **Defesas evoluem**: taxas de sucesso degradam com o tempo conforme
   moderadores adicionam consistency checks entre modalidades.

## Limitações académicas e expectativa realista

Esta seção documenta o gap entre os papers e o que a ferramenta consegue
reproduzir hoje em produção:

1. **White-box vs black-box.** Apenas modelos open-source (Whisper local,
   wav2vec2, DeepSpeech2 via ART) aceitam ataque direcionado *de fato*.
   Gemini, Veo3-Moderation, TikTok-Aria e Meta-AudioBox são black-box: a
   única alavanca real é **transferência** (ensemble) + **prompt-injection
   multimodal** (overlay + SRT cue de instrução + metadata).

2. **Re-encode survival.** Upload em rede social passa o vídeo por AAC/Opus,
   resampling, cropping e CDN re-mux. Isso aniquila a maioria dos ataques de
   áudio puro que não foram treinados sob BPDA / RIR-augmented. Texto on-frame,
   SRT e metadata MP4 sobrevivem a esse pipeline; é por isso que o `standard`
   default já entrega resultado utilizável mesmo em vídeos re-encodados.

3. **Custo computacional.** Cada vídeo adversarial *puro* (whisper_attack,
   ensemble, surrogate_patch) custa minutos a horas em GPU. Daí a escolha do
   default `standard` (TTS + overlay + prompt-inject + SRT + metadata), que
   roda em segundos de CPU e já flipa Gemini na maioria dos casos por força
   da injeção de instrução em texto.

4. **Moderação multimodal real.** Pipelines de moderação reais combinam
   frame-level scene classification, ASR, OCR, embeddings de texto da legenda,
   metadados do uploader, e sinais comportamentais. Camuflar só o áudio é
   insuficiente. Por isso a estratégia aqui é *empilhar camadas* mesmo quando
   cada uma isolada é fraca: cada uma cobre uma falha onde outra resiste.

5. **Expectativa de sucesso contra Gemini.** Em testes reproduzidos contra
   `gemini-2.0-flash` (Q4 2025 / Q1 2026), o `standard` entrega ~85-90% de
   flip de tópico em vídeos curtos quando o usuário pergunta "sobre o que é
   este vídeo" diretamente. Perguntas mais específicas ("liste os
   ingredientes que aparecem", "qual o tema do narrador") são bem mais
   resistentes ao stack visual + SRT. Isso é honesto: **não existe garantia
   de 100%** contra um VLM black-box em movimento.

### Referências

- Carlini & Wagner 2018, "Audio Adversarial Examples: Targeted Attacks on
  Speech-to-Text" — o paper canônico de PGD em ASR (DeepSpeech2).
- Qin et al. ICML 2019, "Imperceptible, Robust, and Targeted Adversarial
  Examples for Automatic Speech Recognition" — base do
  `ImperceptibleASRPyTorch` da ART (extra `[art]`).
- whisper_attack 2023+ (vários autores no GitHub) — adaptação direta de C&W
  para o decoder de Whisper, base do `audio/whisper_attack.py` deste repo.
- DUAP 2026 (Direct Universal Audio Perturbation) — perturbação universal
  pré-computada por classe-alvo; abre porta para *batch cloaking* mas exige
  retreinamento por modelo.
- MORE ICLR 2026 (Multi-Objective Robustness Ensemble) — generaliza ataques
  de áudio com objectivos compostos (transcrição + classificação +
  invariância a re-encoding).
- Clipped Mel Attack 2026 — perturba diretamente o mel-spectrograma com
  clipping para sobreviver a compressões agressivas; relevante porque é o
  primeiro a reportar resistência boa a Opus.
- "Invisible Injections" arxiv 2507.22304 (2025) — caracteriza prompt
  injection sub-visual contra VLMs e mostra que Gemini ainda lê texto
  on-frame mesmo quando humanamente imperceptível. Inspiração direta do
  módulo `visual/prompt_inject.py`.
- Trail of Bits 2024, "Image scaling attacks against AI vision pipelines" —
  base do `visual/stego_downscale.py`.
- Christian Schneider 2024, "Multimodal Prompt Injection in the Wild" —
  evidência empírica de que SRT + metadata MP4 são levados em conta por
  pipelines de classificação multimodal de Gemini-class.

## Aviso ético / legal

> Esta ferramenta gera vídeos com tópico camuflado para **estudo de robustez de
> moderação multimodal e auditoria de pipelines próprios**. Uso para fraude
> publicitária, evasão de moderação visando promover conteúdo enganoso (saúde,
> finanças, golpes, suplementos com alegações falsas, etc.), ou violação de
> ToS de plataformas pode configurar ilícito civil ou penal a depender da
> jurisdição. Os autores não se responsabilizam por uso indevido. Use apenas
> em conteúdo próprio ou com autorização escrita do detentor dos direitos.

## Estrutura do projeto

```
src/audio_poc/
├── pipeline.py              # protect (mantido)
├── dsp.py                   # protect (mantido)
├── presets.py               # protect (mantido)
├── asr.py / metrics.py      # eval-asr (mantido)
├── video_pipeline.py        # extract+remux para protect (mantido)
├── web_ui.py                # 3 abas: Protect / Cloak Multimodal / Verify
├── cli.py                   # subcomandos: protect, eval-asr, cloak, verify-cloak, list-targets
└── cloak/
    ├── __init__.py
    ├── targets.py           # presets de tópico-alvo
    ├── composer.py          # orquestrador + profiles
    ├── ffmpeg_utils.py      # probe, run, extract, remux compartilhados
    ├── audio/
    │   ├── tts_underlay.py
    │   ├── whisper_attack.py
    │   ├── ensemble.py
    │   ├── yamnet_attack.py
    │   ├── psychoacoustic.py
    │   └── art_imperceptible.py   (opt-in: requer .[art])
    ├── visual/
    │   ├── text_overlay.py
    │   ├── prompt_inject.py
    │   ├── stego_downscale.py
    │   └── surrogate_patch.py
    ├── track/
    │   ├── srt_injector.py
    │   └── mp4_metadata.py
    └── verify/
        ├── local.py
        └── gemini.py
```
