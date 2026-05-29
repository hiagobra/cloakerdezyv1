# Camuflagem — documentação técnica (handoff)

> Contexto completo do sistema de camuflagem do Camuflador Zetsu. Leia antes de mexer na camuflagem.

## Visão geral

Camuflagem roda **100% no navegador** (client-side). Não há worker server-side, Python, whisper nem TTS — tudo isso foi removido. Stack:

- **FFmpeg WASM** (`@ffmpeg/ffmpeg` + `@ffmpeg/core` single-thread) → áudio e metadados. Binários em `public/ffmpeg/ffmpeg-core.{js,wasm}` (servidos em `/ffmpeg`). Single-thread **de propósito**: não exige headers COOP/COEP (sem `SharedArrayBuffer`).
- **Canvas + MediaRecorder** → camuflagem visual de vídeo.
- **Canvas** → camuflagem de imagem.

Objetivo central: **imperceptível pro humano, mas embaralha a impressão digital pra máquinas** (fingerprint de hash, transcrição automática ASR/Gemini/Whisper). Inspirado no maskai.co.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/camouflage/client/ffmpeg.ts` | Loader singleton do FFmpeg WASM, `parseFFmpegError`, `getFfmpegLog`/`clearFfmpegLog`, `preloadFFmpeg`, **`runExclusive` (mutex)** e **`nextFileId`** (nomes únicos) |
| `lib/camouflage/client/audio.ts` | `camouflageAudio(file, mode, onProgress)` + `protectVideoAudio(videoBlob, original, mode, onProgress)`. Modos `leve`/`maximo`. `buildGraph()` parametrizável |
| `lib/camouflage/client/video.ts` | `camouflageVideo(file, {mode, cover, onProgress})`. Canvas+MediaRecorder, **vídeo-only** (sem captura de áudio), watchdog anti-travamento. Modos `leve`/`medio`/`forte` |
| `lib/camouflage/client/image.ts` | `camouflageImage()` blend capa/criativo + ruído adversarial + contraste |
| `lib/camouflage/client/metadata.ts` | `cleanMetadata(file, compression, onProgress)` — strip EXIF/container + compressão |
| `lib/camouflage/client/queue.ts` | hook `useCamouflageQueue(concurrency=3)` — fila de 3 simultâneos |
| `lib/camouflage/client/track.ts` | `trackCamouflage(type)`, `downloadBlob`, `useBeforeUnloadGuard` |
| `components/camouflage/{video,audio,image,metadata}-section.tsx` | UI de cada aba |
| `components/camouflage/shared.tsx` | Dropzone, ModeSelector, JobList, SectionCard, CoverPicker, tipo `CamoResult` |
| `app/dashboard/page.tsx` | Hub com abas (Vídeo/Áudio/Imagem/Metadados) + fundo Gon |
| `app/api/camouflage/track/route.ts` | POST autenticado que insere em `camouflage_logs` (alimenta o total no /admin) |
| `supabase/schema.sql` | tabela `camouflage_logs (id, user_id, type, created_at)` |

## Camuflagem de ÁUDIO (o coração — estilo maskai)

`lib/camouflage/client/audio.ts`. Tudo via `-filter_complex` do FFmpeg WASM. Dois modos em `MODES`:

### Modo `leve` (imperceptível)
Disfarça fingerprint sem mexer na percepção:
- `monoBase: false`, `jitter: 0.5`, `pitchPercent: 0.4`, `notches: false`, `scramblerDb: null`
- `pinkDb: -54`, `brownDb: off`, `hfDb: -50`, `launder: 0`, `stereoOut: false`

### Modo `maximo` (anti-IA, nível maskai)
Faz a transcrição automática falhar mantendo a voz audível pro humano:
- `monoBase: true`, `jitter: 0.4`, `pitchPercent: 1.0`, `notches: true`, `scramblerDb: -8`, `compress: true`
- `pinkDb: -48`, `brownDb: -52`, `hfDb: -44`, `launder: 0.2`, `stereoOut: true`

**Fix definitivo do "som não sai" no maximo — processamento em PASSES (`renderAudioWav`):** o grafo único antigo misturava num só `amix` a voz (streaming), o `areverse` (que só emite no EOF) e fontes de ruído. No WASM isso fazia o `amix` **descartar a voz** e sobrar só o ruído baixo (≈ -48 dB) = "sem áudio" — e passava pela trava antiga. Agora o `maximo` roda em 3 passes com arquivos intermediários:
1. **PASS 1 — voz** (`buildVoiceComplex`): mono → jitter → declick → pitch → launder → notches → `acompressor`. Streaming puro, **sempre tem som**. Vira `cv_*.wav`.
2. **PASS 2 — scrambler** (`scramblerAf` num `-af` sobre o WAV da voz): `areverse,aecho=out_gain=0.6,…,volume=-8dB`. Pré-renderizado num arquivo (`cs_*.wav`), então some o problema do `areverse` "atrasado" dentro do `amix`.
3. **PASS 3 — mix** (`buildMixComplex`): `amix` de voz + scrambler + ruído (TODOS arquivos/streams **finitos**) → `alimiter=limit=0.9`. Como nada chega atrasado, a voz nunca é descartada.

**Rede de segurança em cascata (nunca fica mudo):**
- Se PASS 2/3 falhar ou sair mudo no WASM → `renderAudioWav` devolve a **voz limpa** do PASS 1 (`cv_*.wav`), que tem jitter+pitch+notches (anti-fingerprint) e som garantido.
- Se nem o PASS 1 processar → `camouflageAudio`/`protectVideoAudio` caem no **fallback pitch-shift simples**.
- `meanVolumeDb` (trava de silêncio) agora escreve num **arquivo-sink** (`-f null sink`), porque `-f null -` (stdout) **não funciona no FFmpeg WASM** — era por isso que a trava no vídeo não pegava. Floor = `-45 dB`.

**Técnicas (todas em FFmpeg, sem ML):**
1. **timing jitter** — divide em trechos de ~1s e aplica micro `atempo` (±%) por trecho (PRNG determinístico). Destrói fingerprint de timing. Imperceptível.
2. **pitch sutil** — `asetrate=SR*ratio,aresample=SR,atempo=1/ratio`. Disfarça voiceprint.
3. **notches anti-ASR** (`maximo`) — `bandreject` em 1500/2800/4200 Hz, larguras 220/320/420 (bandas de consoante). Destrói pistas de fonema pra ASR; humano reconstrói por contexto.
4. **scrambler reverso+eco** (`maximo`) — deriva da voz: `areverse, aecho=in_gain=1:out_gain=0.6:delays=80|160:decays=0.4|0.25, highpass=300, lowpass=3400, volume=-8dB`. Mixado **in-phase** com a voz: o **downmix mono que a ASR usa** fica dominado por fala reversa+eco não-transcrevível, mas a voz original **sobrevive no mono** (toca em celular). É isso que reproduz o relato do Gemini ("voz invertida + eco + acelerada, impossível transcrever"). `out_gain` e `volume` foram baixados (vs. 0.85/-6dB) pra não saturar nem cobrir a voz.
5. **compressor na voz** (`maximo`) — `acompressor=threshold=-18dB:ratio=3:makeup=2` deixa a voz densa e dominante sobre o scrambler (o humano entende; a ASR ainda tropeça no overlay).
6. **codec laundering** (`maximo`) — `lowpass` + `acrusher` leve (desloca picos de espectrograma que hashers detectam).
7. **mascaramento** — pink + brown noise (volume baixo) + **poison HF 14-18kHz** (`anoisesrc` pink → `highpass=14000,lowpass=18000` → volume baixo). Sub-audível (>16kHz quase ninguém ouve).
8. **limiter final** — `alimiter=limit=0.9` em toda saída (impede a saturação que zerava o áudio no maximo).
9. **strip de metadados** (`-map_metadata -1`) e saída estéreo dual-mono no `maximo` (`-ac 2`).

**Fallback:** se o `-filter_complex` falhar (`exec != 0`), cai automático no pitch-shift simples (`asetrate,aresample,atempo`). **Nunca fica sem saída.**

**`buildGraph(cfg, duration, audioLabel="[0:a]", lavfiStart=1)`** — parametrizado pra ler o áudio de qualquer input (usado pelo vídeo com `[1:a]`).

## Camuflagem de VÍDEO + remux de áudio (fix importante)

`lib/camouflage/client/video.ts` faz **só o visual** (Canvas+MediaRecorder): micro contraste/brilho via `ctx.filter`, ruído esparso (pattern deslocado por frame), capa opcional em blend leve. Modos `leve`/`medio`/`forte`. Tem **watchdog anti-travamento** (retoma `play()` em stalled/waiting, empurra frames se travar, aborta com erro claro após 20s).

**Por que o vídeo é gravado SEM áudio:** a captura de áudio via `captureStream` com `volume=0` capturava **silêncio** → vídeo saía mudo. Bug corrigido.

**Fluxo atual (em `components/camouflage/video-section.tsx`):**
1. `camouflageVideo(file)` → blob de vídeo **sem áudio** (WebM ou MP4).
2. `protectVideoAudio(visualBlob, originalFile, mode|null)` (em `audio.ts`) → coloca o áudio **da fonte original** dentro do vídeo camuflado, em **2 etapas** (corrige "vídeo fica mudo"):
   - **Etapa 1 — processa o áudio anti-IA pra um WAV STANDALONE** (`buildGraph(..., "[0:a]", 1)` lendo só o áudio original) e mede o `mean_volume` desse WAV. A trava de silêncio é **confiável em áudio puro** — no container de vídeo o `volumedetect` às vezes não media e o mudo passava. Se falhar/sair mudo → usa o áudio original.
   - **Etapa 2 — muxa** o WAV escolhido (ou o original) no vídeo (`-map 0:v:0 -map 1:a:0? -c:v copy`).
   - `mode == null` (proteção off) → muxa direto o áudio original.
   - **fallback** em cascata: WAV anti-IA → áudio original → erro só se nem o original muxar. **Nunca fica mudo.**
   - container: WebM → `libopus`; MP4 → `aac`. Usa `-shortest`.
   - Tudo dentro de `runExclusive` (mutex): a fila roda 3 jobs e a instância WASM é única.

UI da aba Vídeo: toggle **"Proteger áudio contra IA"** (default ligado, modo `maximo`).

**Consequência:** todo vídeo faz 2 passos (visual em tempo real + remux WASM). Mais lento, porém correto.

## COPIA WHITE (técnica real do maskai — anti-transcrição que funciona)

DSP sozinho (reverso/eco/notches) **não engana ASR moderno** (Gemini, AssemblyAi): a transcrição sai praticamente igual. O que o maskai faz de fato é **sobrepor uma fala diferente e LIMPA (“copia white”)** por cima do áudio real:

- a **voz real** é degradada na banda de consoante (notches + compress) → fica difícil pra ASR, mas o humano segue pelo contexto;
- a **copia white** (renda extra, prosperidade, emagrecimento… ou um arquivo do usuário) entra **limpa** na banda de voz (180–6500 Hz), nivelada ~3 dB abaixo da real;
- a ASR, achando a voz real “suja” e a white “limpa”, **transcreve a white** → a transcrição sai coerente porém **errada** (não é o que está sendo falado). Sem white, só DSP, a ASR “ouve silêncio/ruído” e a plataforma **marca** o criativo.

**Implementação (`renderAudioWav` com `whiteName`):**
1. PASS 1 — voz real degradada (notches+compress forçados) → `cv_*.wav`.
2. PASS W — white **loopada** pra cobrir a duração (`-stream_loop -1 -t <dur>`), band-limitada (`highpass=180,lowpass=6500`) e comprimida (`acompressor`) → `ch_*.wav`.
3. nivelamento por medição: `gain = mean(voz) + WHITE_REL_DB(-3) − mean(white)`, clampado [-24, +18] dB.
4. PASS MIX — `buildWhiteMixComplex`: `[voz][white·gain][ruído…]amix → alimiter`.
5. fallbacks: white falhou → scrambler reverso; tudo falhou → voz limpa; nunca fica mudo.

**UI:** `WhiteCopyPicker` (em `shared.tsx`) nas abas **Áudio** e **Vídeo** (dentro de “Proteger áudio contra IA”). Aceita áudio **ou vídeo** como fonte da copia. Aplicada a todos os arquivos da fila. Recomendado com modo **Máximo**.

**Copias prontas (embutidas):** quatro MP3 em `public/camouflage/whitecopy/` (`renda-extra`, `emagrecimento`, `prosperidade`, `generico`) — falas neutras/“white” de ~40s geradas com vozes neurais pt-BR (edge-tts: Francisca/Antonio). O `WhiteCopyPicker` mostra chips de preset que dão `fetch` no MP3 e o convertem em `File`. O usuário ainda pode subir o próprio áudio/vídeo. Pra regenerar: `python -m edge_tts --file <txt> --voice pt-BR-FranciscaNeural --write-media <out.mp3>`.

> Sem copia white o sistema cai no scrambler reverso (DSP), que embaralha mas **não garante** enganar ASR robusto — é esperado a transcrição às vezes sair parecida. A copia white é o que reproduz o resultado do maskai.

## Camuflagem de IMAGEM e METADADOS

- **Imagem** (`image.ts`): canvas, blend capa/criativo (slider 0-20 → gamma) + ruído adversarial checkerboard 2x2 + pixel randomization + shift de contraste/brilho. PRNG xorshift.
- **Metadados** (`metadata.ts`): `-map_metadata -1` + compressão opcional (CRF 23/28/32 via libx264) pra vídeo; strip de EXIF pra imagem.

## Programas de referência estudados (gitignored)

Estão na raiz mas **fora do git** (`.gitignore`): `camouflageads-master/`, `Cloaker-de-Audio-e-Video-main/`, `smudge-audio-master/`, `thorn-main/`.

| Programa | O que é | O que foi aproveitado |
|---|---|---|
| **camouflageads-master** | SaaS Vite/React, camuflagem no browser (WebCodecs + ffmpeg WASM + canvas) | Base da arquitetura client-side; algoritmos de vídeo (capa+ruído), áudio (pitch), imagem (blend+ruído) |
| **smudge-audio-master** | App Electron, `audio-processor.js` — cadeia FFmpeg riquíssima | **Principal fonte** da cadeia de áudio: timing jitter, notches anti-ASR, camada reversa, mascaramento pink/brown, codec laundering |
| **Cloaker-de-Audio-e-Video-main** | Python (Flask + TTS + DSP), `backend/dsp.py` | Truque **phase-stereo/phase-cancel** + camadas de ruído HF. Phase-cancel original depende de TTS; aqui usamos a ideia sem TTS |
| **thorn-main** | Cloaking adversarial ML estilo Fawkes (Python + modelo) | Só os **princípios** (ruído sub-audível, perturbação espectral). Código não portável |

## Por que NÃO usamos ML adversarial (decisão registrada)

ML adversarial (estilo papers "psychoacoustic hiding"/"Muting Whisper") seria imperceptível + eficaz EM TESE, mas foi descartado:
- **Não roda client-side**: runtimes de browser (ONNX Runtime Web, transformers.js) são inferência-only, **sem autograd** → não dá pra otimizar a perturbação. Whisper tiny ~75MB+.
- **Específico por modelo**: perturbação treinada contra Whisper frequentemente **não transfere pro Gemini** (que é onde o usuário testa).
- **Frágil à recompressão**: plataformas re-encodam o áudio e matam a perturbação sutil. DSP pesado (reverso/eco/notches) **sobrevive**.
- Exigiria reintroduzir servidor Python+GPU (a infra que foi removida).
- O próprio maskai usa DSP audível (o Gemini *ouve* o eco/reverso), não ML invisível.

## Calibração (onde mexer)

Tudo em `MODES.maximo` de `lib/camouflage/client/audio.ts`:
- **IA ainda transcreve?** → scrambler mais alto (`scramblerDb: -8 → -5`), eco mais denso (`decays` maiores / mais `delays`), notches mais largos (`w`). O `alimiter` segura o clipping, então dá pra subir o scrambler sem saturar.
- **Artefato audível demais pro humano?** → scrambler mais baixo (`-8 → -11`), menos eco, notches mais estreitos, `acompressor makeup` maior (voz dominando mais).
- **Som sumindo / mudo?** → não deveria mais acontecer (limiter + trava de silêncio). Se acontecer, conferir `SILENCE_FLOOR_DB` e o log do `volumedetect`.
- O grafo é montado em `buildGraph()`. Pra adicionar etapas, lembrar de alocar índices lavfi corretamente (`lavfiStart`).

> **Limite do DSP puro:** camuflagem *100% imperceptível* + anti-ASR robusta exige perturbação adversarial otimizada por gradiente (HarmonyCloak / "Muting Whisper"), que **não roda client-side** (runtimes de browser são inferência-only, sem autograd). Com FFmpeg sempre há trade-off: o overlay reverso é audível como leve eco. A calibração atual prioriza voz dominante/inteligível + quebra de ASR; pra ficar mais imperceptível, baixe o scrambler (perde um pouco de eficácia anti-IA).

## Verificação

1. **Grafo nativo**: validar `-filter_complex` no ffmpeg nativo (8.1 instalado na máquina de dev) — mesmos filtros do WASM. Filtros confirmados no WASM: `areverse, aecho, bandreject, pan, join, extrastereo, stereotools, channelsplit, acompressor, alimiter, afftdn, atempo, asetrate, anoisesrc, acrusher, adeclick`. **NÃO existem**: `rubberband`, `compand`, `amerge` (usar substitutos). Codecs OK: `aac, libopus, libmp3lame, libvorbis, pcm_s16le`.
2. `npx tsc --noEmit` + `npm run build` limpos.
3. **Teste anti-IA definitivo (manual)**: baixar resultado → subir no Gemini/transcritor → deve falhar a transcrição. **Critério de sucesso.** Não dá pra rodar Gemini/Whisper localmente.
4. **Perceptual**: ouvir — voz entendível com leve eco no `maximo`.
5. **Mono/celular**: confirmar que a voz não some em player mono.

## Concorrência (CRÍTICO — causa de travamento/mudo)

A fila (`useCamouflageQueue`) roda **3 jobs simultâneos**, mas existe **UMA só** instância do FFmpeg WASM (single-thread). Rodar `exec`/`writeFile` de jobs concorrentes na mesma instância **corrompe o FS virtual e trava**. Além disso, nomes de arquivo fixos (`input.mp4`, `output.mp4`…) faziam jobs sobrescreverem uns aos outros.

**Fix:** todo job que usa FFmpeg roda dentro de `runExclusive(task)` (mutex que serializa) e usa **nomes únicos por job** (`nextFileId()`). Vale pra `camouflageAudio`, `protectVideoAudio` e `cleanMetadata`. A parte visual do vídeo (Canvas+MediaRecorder) **não** usa FFmpeg, então roda em paralelo normalmente; só o remux de áudio serializa.

## Armadilhas conhecidas / a vigiar

- `maximo` introduz leve eco/voz-reversa audível — trade-off inerente (sem ML não dá 100% limpo + anti-IA). Por isso há o modo `leve`.
- Vídeo faz 2 passos WASM → mais lento; cuidado com memória em arquivos grandes.
- **Fontes de ruído (`anoisesrc`) DEVEM ser finitas** (`:duration=`). Infinitas + `areverse` + `amix=duration=first` podiam **travar** o WASM (a primeira entrada do amix chega só no EOF e as infinitas seguem gerando). `lavfiInput(color, duration)` já bound.
- `areverse` no WASM bufferiza o áudio inteiro → memória pra áudios/vídeos longos. **Guard:** `effectiveCfg()` desativa o scrambler automaticamente quando `duration > REVERSE_MAX_SECONDS` (150s).
- Vídeo processa em **tempo real** (MediaRecorder): vídeo de 60s leva ~60s.
- WebM do MediaRecorder às vezes não reporta `duration` → `getDurationFromFile` retorna 0 e o jitter é pulado (ok).
- Possível drift de sync A/V no remux do vídeo (mitigado por `-shortest`).
- WebCodecs não é usado (optamos por MediaRecorder, mais compatível).

## Deploy (resumo)

VPS: pasta real do PM2 = `/var/www/cloakerdzy`, app PM2 = `cloakerdezy`. Ciclo:
```bash
cd /var/www/cloakerdzy
git fetch --all && git reset --hard origin/main
rm -rf .next && npm install && npm run build
pm2 restart cloakerdezy
```
`public/ffmpeg/ffmpeg-core.wasm` (31MB) vai junto no git. Migration `camouflage_logs` no Supabase (SQL em `supabase/schema.sql`). Detalhes/armadilhas de deploy em `.agents/PROJECT-CONTEXT.md`.

---
*Último estado: camuflagem client-side com áudio anti-IA modo `maximo` (nível maskai) + remux de áudio no vídeo. Calibração final do anti-IA pende de teste real no Gemini.*
