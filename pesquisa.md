# Camuflagem de Áudio e Vídeo contra Máquinas e IA: Pesquisa Completa

> Pesquisa sobre técnicas, artigos e métodos usados para criar áudios e vídeos que humanos percebem de uma forma e máquinas/IAs interpretam de outra (adversarial examples, camuflagem perceptual, evasão de detectores).

---

## 1. Introdução: o que é "camuflagem" para máquinas

Esse tipo de ataque tem nome técnico: **adversarial examples** (exemplos adversariais). A ideia central é que sistemas de aprendizado profundo (deep learning) — especialmente redes neurais convolucionais para imagem e modelos de reconhecimento de fala — são vulneráveis a perturbações pequenas, calculadas com matemática (gradientes), que mudam a saída do modelo sem alterar visivelmente/audivelmente o conteúdo para humanos.

O paper fundador é de **Goodfellow, Shlens e Szegedy (2014/2015) — "Explaining and Harnessing Adversarial Examples"**, que mostrou que essa vulnerabilidade vem da natureza linear das redes neurais e introduziu o **FGSM (Fast Gradient Sign Method)** — uma fórmula simples: `adv_x = x + ε * sign(∇_xJ(θ, x, y))`. Variações iterativas como o **PGD (Projected Gradient Descent)** se tornaram o padrão para gerar ataques mais fortes.

A partir desse pilar, a pesquisa explodiu em duas frentes principais que o usuário pediu: **áudio** (humano ouve som normal, máquina transcreve outra coisa) e **imagem/vídeo** (humano vê uma coisa, máquina classifica como outra).

---

## 2. Ataques Adversariais em Áudio

### 2.1 Carlini & Wagner — Targeted Attacks on Speech-to-Text (2018)

O trabalho de referência para áudio adversarial. **Nicholas Carlini e David Wagner** mostraram que é possível pegar qualquer áudio (uma pessoa falando, música) e adicionar uma perturbação imperceptível para que sistemas de speech-to-text (DeepSpeech, da Mozilla) transcrevam **qualquer frase escolhida pelo atacante**, a até 50 caracteres por segundo, com 100% de sucesso em ambiente digital.

A técnica usa uma loss function baseada em **CTC Loss**: você passa o áudio e a transcrição-alvo desejada; o algoritmo minimiza a perda iterativamente via gradient descent, alterando levemente o waveform.

- Paper: [arXiv:1801.01944](https://arxiv.org/abs/1801.01944)
- Código: [GitHub - carlini/audio_adversarial_examples](https://github.com/carlini/audio_adversarial_examples)
- Site do autor: [nicholas.carlini.com](https://nicholas.carlini.com/code/audio_adversarial_examples)

### 2.2 DolphinAttack — Comandos de Voz Inaudíveis (Zhang et al., CCS 2017)

Talvez o ataque mais famoso na área de assistentes de voz. Pesquisadores da **Universidade de Zhejiang** descobriram que microfones MEMS (usados em quase todos os smartphones e smart speakers) têm uma **não-linearidade no circuito** que demodula sinais ultrassônicos (>20 kHz) de volta para o espectro audível. O resultado:

- Você modula um comando de voz num portador ultrassônico inaudível para humanos.
- O microfone "ouve" esse sinal e o sistema demodula.
- Siri, Google Now, Alexa, Cortana, S Voice, HiVoice, e até o sistema de navegação de um Audi obedeceram comandos.

Demonstrações famosas: ativar FaceTime, colocar o telefone em modo avião, manipular navegação automotiva — tudo sem som audível na sala.

- Paper: [arXiv:1708.09537](https://arxiv.org/abs/1708.09537)
- Repositório oficial: [GitHub - USSLab/DolphinAttack](https://github.com/USSLab/DolphinAttack)
- PDF (CCS): [acmccs.github.io](https://acmccs.github.io/papers/p103-zhangAemb.pdf)

### 2.3 CommanderSong — Esconder Comandos em Música (USENIX Security 2018)

Yuan et al. levaram o conceito mais longe: **embutir comandos de voz dentro de músicas**. Quando a música toca (rádio, YouTube, Spotify), o ASR detecta o comando, mas humanos só ouvem a música. Os autores conseguiram quase 100% de sucesso, e o ataque sobrevive em over-the-air com ruído.

- Paper: [arXiv:1801.08535](https://arxiv.org/abs/1801.08535)
- USENIX: [usenix.org/conference/usenixsecurity18](https://www.usenix.org/conference/usenixsecurity18/presentation/yuan-xuejing)

### 2.4 Psychoacoustic Hiding (Schönherr et al., NDSS 2019)

Lea Schönherr e equipe (Ruhr University Bochum) usaram **modelos psicoacústicos** (os mesmos usados em codecs MP3 para descartar frequências mascaradas pelo ouvido humano) para esconder a perturbação adversarial **abaixo do limiar de percepção humana**. Conseguiram 98% de sucesso com áudios onde nenhum ouvinte detectou a manipulação.

- Paper: [arXiv:1808.05665](https://arxiv.org/abs/1808.05665)
- NDSS: [ndss-symposium.org](https://www.ndss-symposium.org/ndss-paper/adversarial-attacks-against-automatic-speech-recognition-systems-via-psychoacoustic-hiding/)
- Site demonstração: [adversarial-attacks.net](https://adversarial-attacks.net/)

### 2.5 Imperceptible, Robust and Targeted (Qin et al., ICML 2019)

Estendeu a ideia psicoacústica para gerar exemplos que sobrevivem em **over-the-air** (tocando num alto-falante e captando por microfone). Combinou frequency masking + simulação de impulse response da sala.

- Paper: [proceedings.mlr.press/v97/qin19a](https://proceedings.mlr.press/v97/qin19a/qin19a.pdf)

### 2.6 Houdini (Cisse et al., NIPS 2017)

Loss surrogate que permite atacar tarefas com perdas não-diferenciáveis (segmentação semântica, ASR, pose estimation). Foi o estado-da-arte antes do Carlini & Wagner para áudio. Hoje é referência para ataques transferíveis black-box.

### 2.7 Light Commands — Laser nos Microfones (Sugawara et al., USENIX 2020)

Ataque hardware: **microfones MEMS reagem a luz como se fossem som**. Modulando um laser na intensidade equivalente a um waveform de áudio, atacantes injetaram comandos em Alexa, Siri, Google Assistant — a **110 metros de distância através de janelas**. Custo da prova de conceito: ~US$ 400.

- Site: [lightcommands.com](https://lightcommands.com/)
- USENIX: [usenix.org/conference/usenixsecurity20/presentation/sugawara](https://www.usenix.org/conference/usenixsecurity20/presentation/sugawara)
- Paper: [arXiv:2006.11946](https://arxiv.org/pdf/2006.11946)

### 2.8 SurfingAttack (NDSS 2020)

Explora **ondas ultrassônicas guiadas em superfícies sólidas** (mesa, balcão). Um transdutor piezo de US$ 5 colado embaixo de uma mesa transmite comandos pela superfície até o smartphone do alvo, sem precisar de linha de visão.

- Paper: [surfingattack.github.io](https://surfingattack.github.io/papers/NDSS-surfingattack.pdf)

### 2.9 Ataques contra Whisper (OpenAI)

Modelos modernos como o Whisper são robustos a ruído natural mas continuam vulneráveis a ataques adversariais:

- **"Fooling Whisper with adversarial examples"** (Olivier & Raj, 2022) — perturbações com SNR 35-45 dB degradam transcrição. [arXiv:2210.17316](https://arxiv.org/abs/2210.17316)
- **"Muting Whisper"** — segmento universal de 0,64 s que silencia a saída em 97% dos casos. [arXiv:2405.06134](https://arxiv.org/html/2405.06134v1)
- **"Controlling Whisper"** — segmento universal que faz o modelo executar a tarefa errada (traduzir em vez de transcrever, etc.). [arXiv:2407.04482](https://arxiv.org/html/2407.04482v1)

### 2.10 Equalization-based Psychoacoustic Attacks (Abdullah et al., ICML 2021)

Versão black-box que ataca ASRs comerciais sem precisar do modelo, manipulando equalização e formantes que o ouvido humano descarta.

- [proceedings.mlr.press/v157/abdullah21a](https://proceedings.mlr.press/v157/abdullah21a/abdullah21a.pdf)

### 2.11 Esteganografia de Áudio com Deep Learning

Não é exatamente "ataque", mas é técnica usada para esconder mensagens dentro de áudio que IA/ouvinte humano não notam, com intenção semelhante:

- **Hide and Speak (Kreuk et al., 2019)** — redes neurais como funções esteganográficas. [arXiv:1902.03083](https://arxiv.org/abs/1902.03083)
- **Coverless Audio Steganography com GAN** (2023) — modelo gerativo que sintetiza o áudio carregando a mensagem semanticamente. [MDPI Electronics](https://www.mdpi.com/2079-9292/12/5/1253)

---

## 3. Ataques Adversariais em Imagem e Vídeo

### 3.1 Fundamentos: FGSM, PGD, DeepFool

- **FGSM** (Goodfellow et al., 2014) — um único passo de gradiente. Ataque mais rápido. [arXiv:1412.6572](https://arxiv.org/abs/1412.6572)
- **PGD** (Madry et al., 2017) — múltiplos passos, projetando de volta na bola ε-limitada. Padrão atual.
- **DeepFool** (Moosavi-Dezfooli et al., 2015) — busca a perturbação mínima.
- **Carlini-Wagner (C&W)** — ataque por otimização que hoje é benchmark de força.

Tutorial PyTorch: [pytorch.org/tutorials/beginner/fgsm_tutorial](https://docs.pytorch.org/tutorials/beginner/fgsm_tutorial.html)

### 3.2 Universal Adversarial Perturbations (Moosavi-Dezfooli, CVPR 2017)

Um **único padrão** de pixels que, quando somado a *quase qualquer imagem*, faz a CNN errar. Funciona cross-arquitetura (transfer entre VGG, ResNet, GoogLeNet). Mostrou que decision boundaries de redes profundas têm correlações geométricas exploráveis.

- Paper: [arXiv:1610.08401](https://arxiv.org/abs/1610.08401)
- CVPR PDF: [openaccess.thecvf.com](https://openaccess.thecvf.com/content_cvpr_2017/papers/Moosavi-Dezfooli_Universal_Adversarial_Perturbations_CVPR_2017_paper.pdf)

### 3.3 Adversarial Patch (Brown et al., NeurIPS 2017)

Adesivos circulares impressos que, quando colocados em qualquer cena, fazem o classificador escolher a classe que o atacante quiser. Universal, robusto, e visível ao olho humano (não tenta ser imperceptível, abre mão disso para sobreviver no mundo físico).

- Paper: [arXiv:1712.09665](https://arxiv.org/pdf/1712.09665)

### 3.4 Robust Physical-World Attacks (Eykholt et al., CVPR 2018) — Stop Signs

Um dos trabalhos mais citados do mundo. Algoritmo **RP2 (Robust Physical Perturbations)** que gera adesivos pretos e brancos (imitando graffiti) para colar em placas de Pare. Resultado:

- 100% de sucesso em laboratório
- 84,8% em vídeo capturado de carro em movimento
- Carros autônomos classificavam o stop sign como placa de limite de velocidade

Referência crítica para discussões de segurança de carros autônomos.

- Paper: [arXiv:1707.08945](https://arxiv.org/abs/1707.08945)
- CVPR PDF: [openaccess.thecvf.com](https://openaccess.thecvf.com/content_cvpr_2018/papers_backup/Eykholt_Robust_Physical-World_Attacks_CVPR_2018_paper.pdf)
- Blog Berkeley AI: [bair.berkeley.edu](https://bair.berkeley.edu/blog/2017/12/30/yolo-attack/)

### 3.5 Synthesizing Robust Adversarial Examples — EOT (Athalye et al., ICML 2018)

A famosa **tartaruga 3D que parece um rifle**. Athalye, Engstrom, Ilyas e Kwok (MIT) introduziram **EOT (Expectation Over Transformation)** — otimizar a perturbação esperando sobre uma distribuição de transformações (rotação, escala, iluminação, distância). Resultado: objetos físicos 3D classificados de forma errada de qualquer ângulo.

- Tartaruga classificada como rifle 82% do tempo, corretamente apenas 2%.
- Bola de baseball classificada como espresso 59%.

Paper: [arXiv:1707.07397](https://arxiv.org/abs/1707.07397)
Cobertura: [Science.org](https://www.science.org/content/article/turtle-or-rifle-hackers-easily-fool-ais-seeing-wrong-thing) | [MIT News](https://news.mit.edu/2019/why-did-my-classifier-mistake-turtle-for-rifle-computer-vision-0731)

### 3.6 Accessorize to a Crime / Adversarial Eyeglasses (Sharif et al., CCS 2016)

Mahmood Sharif e equipe (CMU) criaram **óculos com armações adversariais** que, ao serem usados, fazem o sistema de reconhecimento facial:

- Não identificar a pessoa (dodging)
- Identificar a pessoa como outra escolhida (impersonation, ex.: passar como Milla Jovovich)

A versão posterior (2018) usou redes generativas (AGN) para tornar os óculos visualmente naturais.

- Paper original: [users.ece.cmu.edu/~lbauer/papers/2016/ccs2016-face-recognition.pdf](https://users.ece.cmu.edu/~lbauer/papers/2016/ccs2016-face-recognition.pdf)
- Survey de ataques físicos contra FR: [arXiv:2410.16317](https://arxiv.org/html/2410.16317v1)

### 3.7 Adversarial T-shirt (Xu et al., ECCV 2020)

Camiseta com padrão impresso que **engana detectores de pessoas (YOLO, Faster R-CNN)** mesmo com a roupa deformando enquanto a pessoa anda. Inovação: usaram **Thin Plate Spline mapping** para modelar deformação não-rígida durante o treinamento da perturbação.

- Sucesso: 74% digital, 57% físico.
- Paper: [arXiv:1910.11099](https://arxiv.org/abs/1910.11099)
- ECCV PDF: [ecva.net](https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123500647.pdf)

### 3.8 Invisibility Cloak (Wu et al., ECCV 2020)

Trabalho da Universidade de Maryland. Treinaram padrões impressos em **pôsteres e roupas** para suprimir os "objectness scores" de detectores. O slogan: "make a real-life invisibility cloak". Em condições reais, pessoas vestindo a estampa eram ignoradas pelo YOLOv2 em vários ângulos.

- Paper: [arXiv:1910.14667](https://arxiv.org/abs/1910.14667)
- Site projeto: [cs.umd.edu/~tomg/projects/invisible](https://www.cs.umd.edu/~tomg/projects/invisible/)

### 3.9 Adversarial Camera Stickers (Li et al., ICLR 2019)

Em vez de modificar o objeto, **modificam a câmera**: um adesivo translúcido na lente cria uma perturbação universal em todas as imagens captadas. Funcionário malicioso, vigilância cega, etc.

- Paper: [proceedings.mlr.press/v97/li19j](http://proceedings.mlr.press/v97/li19j/li19j.pdf)
- Versão arXiv: [arXiv:1904.00759](https://ar5iv.labs.arxiv.org/html/1904.00759)

### 3.10 MVPatch e patches recentes contra YOLO (2023-2024)

- **MVPatch** — patches "vivos" que parecem naturais (logos, estampas) mas enganam detectores. [arXiv:2312.17431](https://arxiv.org/html/2312.17431v2)
- **Adversarial YOLO** (defesa) — [arXiv:2103.08860](https://arxiv.org/abs/2103.08860)
- **AdvReal** (2025) — framework de avaliação. [arXiv:2505.16402](https://arxiv.org/html/2505.16402v1)
- **Lista mantida**: [GitHub - inspire-group/adv-patch-paper-list](https://github.com/inspire-group/adv-patch-paper-list)

### 3.11 Adv-Makeup e DiffAM — Maquiagem como Ataque

- **Adv-Makeup (Yin et al., IJCAI 2021)** — Aplicar **sombra de olho adversarial** sintetizada por GAN que parece maquiagem normal mas engana reconhecimento facial. Black-box, transferível. [arXiv:2105.03162](https://arxiv.org/abs/2105.03162) | [GitHub Tencent](https://github.com/TencentYoutuResearch/Adv-Makeup)
- **DiffAM (Sun et al., CVPR 2024)** — Usa **modelos de difusão** para transferir maquiagem adversarial de fotos de referência. Resultado é mais natural visualmente. [arXiv:2405.09882](https://arxiv.org/abs/2405.09882) | [CVPR PDF](https://openaccess.thecvf.com/content/CVPR2024/papers/Sun_DiffAM_Diffusion-based_Adversarial_Makeup_Transfer_for_Facial_Privacy_Protection_CVPR_2024_paper.pdf)

### 3.12 ProjAttacker (CVPR 2025)

Usa **projetor para iluminar o rosto da pessoa** com padrão adversarial calculado em tempo real. Configurável — pode atacar diferentes sistemas de FR. [openaccess.thecvf.com — ProjAttacker](https://openaccess.thecvf.com/content/CVPR2025/papers/Liu_ProjAttacker_A_Configurable_Physical_Adversarial_Attack_for_Face_Recognition_via_CVPR_2025_paper.pdf)

### 3.13 Camuflagem Naturalística para Veículos e Drones

- **Naturalistic camouflage via differentiable rendering + style learning** (2025) — texturas adversariais aplicadas em modelos 3D de veículos. [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0031320325012841)
- **Stealthy Vehicle Adversarial Camouflage via Neural Style Transfer** (2024) — [MDPI Entropy](https://www.mdpi.com/1099-4300/26/11/903)
- **Rust-Style Patch** — patches que parecem ferrugem em imagens de sensoriamento remoto. [MDPI Remote Sensing](https://www.mdpi.com/2072-4292/15/4/885)
- **AI-Driven Adaptive Camouflage Pattern Generation for Helicopter Detection Evasion** (2025) — Stable Diffusion + YOLOv8 para gerar camuflagem. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13029914/)

### 3.14 Ataques Adversariais em Vídeo

Vídeo soma desafio temporal. Principais trabalhos:

- **Houdini** (Cisse et al., 2017) — primeiro a tratar segmentação e tarefas estruturadas.
- **Sparse adversarial perturbations for videos** (Wei et al., AAAI 2019) — ataca apenas key-frames. [DOI](https://dl.acm.org/doi/10.1609/aaai.v33i01.33018973)
- **Stealthy Adversarial Perturbations Against Real-Time Video Classification** (Li et al., NDSS 2019) — [PDF](https://www.ndss-symposium.org/wp-content/uploads/2019/02/ndss2019_03A-3_Li_paper.pdf)
- **DeepSAVA** — ataque adversarial sparse temporal.
- **v3a — Video Augmentation Adversarial Attack** — [MDPI](https://www.mdpi.com/2076-3417/13/3/1914)

---

## 4. Camuflagem Anti-Reconhecimento Facial (Privacidade)

Aqui a motivação é defensiva: proteger pessoas de vigilância e scraping.

### 4.1 Fawkes (USENIX Security 2020 — SAND Lab UChicago)

Ferramenta open-source que faz **"image cloaking"**: pega suas fotos e aplica perturbação imperceptível antes de você postar online. Modelos de FR treinados em fotos cloakeadas aprendem uma representação errada do seu rosto. Foi 100% efetivo contra Microsoft Azure Face, Amazon Rekognition e Face++ no momento da publicação.

- Site oficial: [sandlab.cs.uchicago.edu/fawkes](https://sandlab.cs.uchicago.edu/fawkes/)
- Código: [GitHub - Shawn-Shan/fawkes](https://github.com/Shawn-Shan/fawkes)
- Paper: [usenix.org/system/files/sec20-shan.pdf](https://www.usenix.org/system/files/sec20-shan.pdf)

### 4.2 Glaze e Nightshade (SAND Lab UChicago)

Para **artistas** se protegerem contra modelos de IA generativa que treinam em suas obras:

- **Glaze** (USENIX Security 2023) — defensivo. Adiciona perturbação que mascara o **estilo** do artista, fazendo modelos de mimetismo aprenderem estilo diferente.
- **Nightshade** (S&P 2024) — ofensivo. **Envenena** o modelo: imagens da Nightshade fazem o modelo aprender associações erradas (gato vira cachorro, etc.). Acumulado com muitas imagens, derruba acurácia do modelo.
- **Limitação**: papers recentes (2025) mostram que **LightShed** consegue remover a proteção com 99,98% de precisão. [MIT Technology Review](https://www.technologyreview.com/2025/07/10/1119937/tool-strips-away-anti-ai-protections-from-digital-art/)

Site: [nightshade.cs.uchicago.edu](https://nightshade.cs.uchicago.edu/whatis.html) | Cobertura: [MIT Tech Review](https://www.technologyreview.com/2023/10/23/1082189/data-poisoning-artists-fight-generative-ai/)

### 4.3 CV Dazzle (Adam Harvey, 2010)

Pioneiro. Maquiagem assimétrica + mechas de cabelo cobrindo features faciais (testa, ponte do nariz). Inspirado nas pinturas Dazzle de navios da 1ª Guerra. **Funcionou bem contra Viola-Jones e algoritmos antigos**. Hoje, contra CNNs profundas, é em grande parte ineficaz — o próprio Harvey diz isso publicamente.

- Site do projeto: [adam.harvey.studio/cvdazzle](https://adam.harvey.studio/cvdazzle/)
- Wikipedia: [Computer Vision Dazzle](https://en.wikipedia.org/wiki/Computer_vision_dazzle)
- Análise crítica: [Digital Trends](https://www.digitaltrends.com/trash/cv-dazzle-makeup-facial-recognition-protests/)

### 4.4 Hardware: IR LEDs e Reflectacles

- **Reflectacles** — óculos comerciais com **lentes que bloqueiam IR** (defendem contra escaneamento 3D estilo Face ID/Iris) e armações reflexivas. [reflectacles.com](https://www.reflectacles.com/)
- **Camera Shy Hoodie** (Mac Pierce) — moletom DIY com 12 LEDs IR de alta potência. Cega câmeras com night vision em ambientes escuros. [macpierce.com](https://www.macpierce.com/the-camera-shy-hoodie)
- **Hat com IR LEDs** (Yamada et al.) — boné com LEDs IR ao redor da face. [phys.org](https://phys.org/news/2013-01-near-infrared-glasses-thwart-recognition.html)
- **Hacker Hoodie**: [PetaPixel](https://petapixel.com/2023/03/01/hacker-hoodie-blinds-surveillance-cameras-with-infrared-light/)

### 4.5 Roupas Adversariais Comerciais

- **Adversarial Fashion** (Kate Rose) — camisetas/jaquetas com padrões que disparam falsos positivos em ALPRs (leitores automáticos de placas). [adversarialfashion.com](https://adversarialfashion.com/) (mencionada em [SCMP](https://www.scmp.com/lifestyle/fashion-beauty/article/3037354))

---

## 5. Evasão Prática de Moderação Automática

Foco do usuário: técnicas que pessoas comuns usam para enganar sistemas de IA.

### 5.1 Algospeak (TikTok, Instagram, YouTube)

Linguagem codificada cuja função é exatamente **evadir classificadores automáticos** que rodam pré e pós-upload. Não é ataque adversarial gradiente, é **evasão linguística** — mas o objetivo é o mesmo: humano entende, máquina não bloqueia.

Vocabulário comum:
- "unalive" → kill / suicide
- "seggs" → sex
- "corn" / 🌽 → porn
- "panini" / "panorama" → pandemic
- "le$bian", "le$" → lesbian
- "leg booty" → LGBTQ
- "mascara" → agressão sexual (uso recente)
- "clock app" → TikTok (referindo-se à própria plataforma)

Estratégias adicionais:
- Imagem ou caption diz "fake body" para conteúdo com pouca roupa.
- Uso de emojis e gestos (linguagem não-textual que classificadores tradicionais demoram a aprender).
- Trocar formato (texto → imagem com texto → áudio falado) porque pipelines de moderação têm latências diferentes para cada modalidade.
- Desviar termos sensíveis para outros idiomas, gírias regionais.

Estudos:
- **Steen, Yurechko & Klug (2023) — "You Can (Not) Say What You Want: Algospeak on TikTok"**. [Sage Journals](https://journals.sagepub.com/doi/10.1177/20563051231194586) | [PDF NSF](https://par.nsf.gov/servlets/purl/10480449)
- **Wikipedia — Algospeak**: [en.wikipedia.org/wiki/Algospeak](https://en.wikipedia.org/wiki/Algospeak)
- Análise prática: [GetStream blog](https://getstream.io/blog/moderation-circumvention-tactics/)

### 5.2 Evasão de Content ID (YouTube)

Conjunto de truques que pessoas tentam (com efetividade variável):

| Técnica | Sobrevive? |
|--------|------------|
| Espelhar vídeo (flip horizontal) | Em parte — Content ID detecta reflexões |
| Pitch shifting (-1, -2 semitons) | Não — fingerprint robusto a transposições leves |
| Speed up / slow down 1-3% | Pouco efetivo |
| Picture-in-picture com webcam | Mais efetivo (modificação espacial significativa) |
| Recortar topo/base e reescalar | Frequentemente bypassa em compilações |
| Adicionar ruído/filtro de áudio | Ineficaz em geral |
| Reaction com fala falando por cima | Mais eficaz que só áudio limpo |

YouTube usa **fingerprint perceptual** (estilo Shazam para áudio + hash visual robusto). É um campo em constante evolução; o que funciona hoje pode não funcionar amanhã.

Discussões: [BlackHatWorld threads](https://www.blackhatworld.com/seo/how-can-i-bypass-audio-visual-content-copyright-on-youtube.484465/) | [Quora](https://www.quora.com/Do-videos-with-reversed-image-frames-avoid-watermark-detection-by-YouTubes-copyright-identification-system)

### 5.3 Bypass de Filtros NSFW

- **Trocar saturação/contraste** — antigas heurísticas falhavam em imagens monocromáticas, mas modelos modernos (NudeNet, OpenAI moderation) já tratam isso.
- **Watermarks/overlays grandes** sobre regiões sensíveis confundem alguns classificadores.
- **Stickers/emoji digital** parcialmente bloqueando — mesma lógica.
- **Remover face para evitar matching** — separar conteúdo da identidade.

---

## 6. Deepfakes e Camuflagem Contra Detectores

Tema importante e crescente. Aqui a "camuflagem" é fazer um deepfake **passar despercebido** por detectores forenses de IA.

### 6.1 Adversarial Deepfakes (Neekhara et al., WACV 2021)

Mostrou que **detectores de deepfake são extremamente vulneráveis a perturbações adversariais**. Adicionando ruído quase imperceptível ao deepfake, a probabilidade de detecção cai abaixo de 5%.

- Paper: [cseweb.ucsd.edu/~jmcauley/pdfs/wacv21.pdf](https://cseweb.ucsd.edu/~jmcauley/pdfs/wacv21.pdf)
- CVPR Workshop versão prática: [openaccess.thecvf.com](https://openaccess.thecvf.com/content/CVPR2021W/WMF/papers/Neekhara_Adversarial_Threats_to_DeepFake_Detection_A_Practical_Perspective_CVPR_2021_paper.pdf)
- Código: [GitHub - paarthneekhara/AdversarialDeepFakes](https://github.com/paarthneekhara/AdversarialDeepFakes)

### 6.2 Statistical Consistency Evasion (Hou et al., CVPR 2023)

Faz o deepfake ter **estatísticas (espectrais, ruído de sensor) consistentes com imagens reais**, derrotando detectores baseados em features estatísticas.

- [openaccess.thecvf.com — Hou et al.](https://openaccess.thecvf.com/content/CVPR2023/papers/Hou_Evading_DeepFake_Detectors_via_Adversarial_Statistical_Consistency_CVPR_2023_paper.pdf)

### 6.3 Restricted Black-Box Attack on Face Swapping

- [arXiv:2204.12347](https://arxiv.org/abs/2204.12347)

### 6.4 DeepEvader (2025)

Ferramenta de "facial distraction" black-box transferível entre detectores. [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0952197625002763)

### 6.5 Survey: Proactive Deepfake Defense (ACM Computing Surveys 2024)

Visão geral das duas grandes linhas: **disruption** (perturbar a foto fonte para que o deepfake gere artefatos) e **watermarking** (marca d'água que indica autenticidade).

- [dl.acm.org/doi/10.1145/3771296](https://dl.acm.org/doi/10.1145/3771296)

---

## 7. Surveys e Recursos para Aprofundamento

### 7.1 Surveys gerais de adversarial machine learning

- **"How Deep Learning Sees the World: A Survey on Adversarial Attacks & Defenses"** (2023) — [arXiv:2305.10862](https://arxiv.org/abs/2305.10862)
- **"A meta-survey of adversarial attacks against artificial intelligence algorithms, including diffusion models"** (2025) — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0925231225019034)
- **"A Survey of Robustness and Safety of 2D and 3D Deep Learning Models"** — [ACM Computing Surveys](https://dl.acm.org/doi/10.1145/3636551)
- **"Deep learning adversarial attacks and defenses in autonomous vehicles"** (2024) — [Springer](https://link.springer.com/article/10.1007/s10462-024-11014-8)
- **"A Comprehensive Review of Adversarial Attacks and Defense Strategies in DNNs"** (2025) — [MDPI Technologies](https://www.mdpi.com/2227-7080/13/5/202)

### 7.2 Surveys específicas para reconhecimento facial

- **"A Survey on Physical Adversarial Attacks against Face Recognition Systems"** (2024) — [arXiv:2410.16317](https://arxiv.org/html/2410.16317v1) — cobre 40 papers de 2016 a 2024.
- **"Adversarial Attacks against Face Recognition: A Comprehensive Study"** — [arXiv:2007.11709](https://arxiv.org/pdf/2007.11709)

### 7.3 Tutoriais práticos e código

- **Adversarial ML Tutorial** (Kolter & Madry) — [adversarial-ml-tutorial.org](https://adversarial-ml-tutorial.org/adversarial_examples/)
- **TensorFlow FGSM tutorial** — [tensorflow.org/tutorials/generative/adversarial_fgsm](https://www.tensorflow.org/tutorials/generative/adversarial_fgsm)
- **PyTorch FGSM** — [pytorch.org tutorial](https://docs.pytorch.org/tutorials/beginner/fgsm_tutorial.html)
- **CleverHans** (Goodfellow lab) — biblioteca de ataques: github.com/cleverhans-lab/cleverhans
- **Foolbox** — github.com/bethgelab/foolbox
- **Adversarial Robustness Toolbox (IBM)** — github.com/Trusted-AI/adversarial-robustness-toolbox

### 7.4 Listas curadas

- **adv-patch-paper-list** — [GitHub - inspire-group/adv-patch-paper-list](https://github.com/inspire-group/adv-patch-paper-list)
- **awesome-camouflaged-object-detection** — [GitHub - visionxiang](https://github.com/visionxiang/awesome-camouflaged-object-detection)
- **Adversarial Audio Attack toolkit** — [GitHub - Repello-AI/Adversarial-Audio-Attack](https://github.com/Repello-AI/Adversarial-Audio-Attack)

---

## 8. Resumo Conceitual: Por que isso funciona

Para a sua pesquisa, vale ter clareza de **por que** áudio/imagem podem ser percebidos diferente por humanos e máquinas:

1. **Redes neurais aprendem features que não correspondem totalmente à percepção humana**. Elas se baseiam em padrões de pixels ou frequências sutis que humanos descartam.
2. **Espaços de alta dimensão têm "buracos"**: pequenas perturbações em direções específicas atravessam fronteiras de decisão.
3. **Não-linearidades de hardware** (microfones, câmeras, sensores) criam canais de injeção que atacantes usam (DolphinAttack, Light Commands).
4. **Mascaramento perceptual humano** (psychoacoustic masking, contrast masking) cria espaço para esconder informação.
5. **Pipelines de moderação são modulares e lentos** — algospeak explora o desencontro entre o que o classificador de texto e o de imagem capturam.
6. **Modelos generalizam mal fora da distribuição de treinamento** — patches "naturais" exploram isso.

---

## 9. Tendências de Pesquisa (2024-2026)

- **Difusão e ataques generativos**: usar Stable Diffusion para gerar perturbações que parecem naturais (DiffAM, AdvReal).
- **Ataques contra LLMs multimodais e ASR foundation models** (Whisper, LLaVA, GPT-4V).
- **Defesas baseadas em watermarking proativo** que sobrevivem a JPEG e re-encoding.
- **Quebra das defesas anti-AI artist** (LightShed quebrou Glaze/Nightshade — corrida armamentista).
- **Camuflagem 3D fotorealística** via differentiable rendering.
- **Ataques transferíveis black-box** que não exigem acesso ao modelo alvo.

---

## 10. Lista Bibliográfica Consolidada (papers chave para citar)

1. Goodfellow, Shlens, Szegedy. *Explaining and Harnessing Adversarial Examples.* ICLR 2015. arXiv:1412.6572.
2. Carlini, Wagner. *Audio Adversarial Examples: Targeted Attacks on Speech-to-Text.* DLS 2018. arXiv:1801.01944.
3. Zhang et al. *DolphinAttack: Inaudible Voice Commands.* CCS 2017. arXiv:1708.09537.
4. Yuan et al. *CommanderSong.* USENIX Security 2018. arXiv:1801.08535.
5. Schönherr et al. *Adversarial Attacks via Psychoacoustic Hiding.* NDSS 2019. arXiv:1808.05665.
6. Sugawara et al. *Light Commands: Laser-Based Audio Injection.* USENIX 2020. arXiv:2006.11946.
7. Yan et al. *SurfingAttack.* NDSS 2020.
8. Olivier & Raj. *Fooling Whisper with adversarial examples.* arXiv:2210.17316.
9. Moosavi-Dezfooli et al. *Universal Adversarial Perturbations.* CVPR 2017. arXiv:1610.08401.
10. Brown et al. *Adversarial Patch.* NeurIPS 2017. arXiv:1712.09665.
11. Eykholt et al. *Robust Physical-World Attacks on Deep Learning Models.* CVPR 2018. arXiv:1707.08945.
12. Athalye et al. *Synthesizing Robust Adversarial Examples.* ICML 2018. arXiv:1707.07397.
13. Sharif et al. *Accessorize to a Crime.* CCS 2016.
14. Xu et al. *Adversarial T-Shirt.* ECCV 2020. arXiv:1910.11099.
15. Wu et al. *Making an Invisibility Cloak.* ECCV 2020. arXiv:1910.14667.
16. Li et al. *Adversarial Camera Stickers.* ICLR 2019. arXiv:1904.00759.
17. Yin et al. *Adv-Makeup.* IJCAI 2021. arXiv:2105.03162.
18. Sun et al. *DiffAM.* CVPR 2024. arXiv:2405.09882.
19. Shan et al. *Fawkes: Protecting Privacy against Unauthorized Deep Learning Models.* USENIX 2020.
20. Shan et al. *Glaze.* USENIX 2023. *Nightshade.* IEEE S&P 2024.
21. Steen, Yurechko, Klug. *You Can (Not) Say What You Want: Algospeak on TikTok.* 2023.
22. Neekhara et al. *Adversarial Deepfakes.* WACV 2021.
23. Cisse et al. *Houdini: Fooling Deep Structured Prediction Models.* NIPS 2017.
24. Qin et al. *Imperceptible, Robust and Targeted Adversarial Examples for ASR.* ICML 2019.