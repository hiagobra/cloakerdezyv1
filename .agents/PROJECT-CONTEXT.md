# Contexto do projeto — Camuflador Zetsu (cloakerdezyv2)

Documento de referência para agentes e desenvolvedores. Resume decisões, mudanças de UI, deploy e infraestrutura discutidas/implementadas neste repositório.

---

## Visão geral

- **Nome do produto (UI):** Camuflador Zetsu
- **Repo local:** `cloakerdezyv2`
- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Supabase + pipeline Python (`audio-encryption-poc/`)
- **Domínio de produção (atual):** `camufladorzetsu.com`
- **Domínios anteriores:** `dezycamouflage.com`, `cloakerdezy.com`
- **Tema visual:** dark (`#0A0A0A`), accent verde limão (`#A8FF00`), referências anime (Zetsu, vídeo Gon)

---

## Estrutura de branding

### Logo

- **Arquivo:** `public/brand/logo-zetsu.png`
- **Uso:** navbar, login, register, app header
- **Referências:**
  - `components/marketing/navbar.tsx`
  - `app/login/page.tsx`
  - `app/register/page.tsx`
  - `components/app/app-header.tsx`

**Histórico:** tentou-se usar `logo-zetsu.webp` (silhueta branca Hisoka em fundo transparente). Houve problemas de cache do Next/Image e aparência de “caixa branca” em alguns contextos. Migrou-se para `logo-zetsu.png`. **Não usar** `?v=2` cache bust em produção — quebrou o carregamento via `next/image`.

### Vídeo hero

- **Arquivos:** `public/brand/gon.webm`, `public/brand/gon.mp4`
- **Uso:** landing page (`app/page.tsx`), badge “cloaking” no canto do player

---

## Landing page (`app/page.tsx`)

### Hero

- Badge: **Modo Zetsu ativo**
- Título: **Camufle seus criativos no** + `TextRotator` alternando `TikTok`, `Google`, `Facebook`
- Subtítulo:
  > Suprima a assinatura dos seus vídeos e burle a detecção das plataformas. Use Zetsu pra ocultar seus anuncios do algoritmo
- CTAs: **Criar conta** (primary) e **Entrar** (outline)
- Bullets abaixo: Aprovação manual · Worker dedicado · Multi-plataforma

### CloakMeter (abaixo do vídeo)

Componente em `components/marketing/landing-motion.tsx` → `CloakMeter`.

**Comportamento animado (loop):**
1. Pausa inicial **2s** com Detectável **100%** / Zetsu **0%**
2. Animação **3,6s** (ease-out cúbico): Detectável cai, Zetsu sobe
3. Pausa final **1,8s** em Detectável **0%** / Zetsu **100%**
4. Reset instantâneo e repete

**Visual (compacto, estilo badge):**
- Esquerda: bolinha pulsando + `Detectável X%` + barra fina cinza
- Direita: pill verde `ZETSU X%` + barra fina verde

Substituiu textos genéricos antigos (`// gon.zetsu`, `SIGNATURE ↴ 0.00%`).

### Feature cards (`FeatureCards`)

| # | Título | Descrição |
|---|--------|-----------|
| 01 | **Uso Gratuito** | Cadastre-se com seus dados e espere um administrador aprovar seu acesso, utilize a plataforma com zero custos |
| 02 | Multi-plataforma | TikTok, Google Ads e Facebook. O mesmo vídeo, várias assinaturas únicas. |
| 03 | Processamento rápido | Worker dedicado, fila em tempo real. Faz upload e acompanha o status. |

Card 01 substituiu “Aprovação manual”.

---

## Correções de UI

### TextRotator — corte do “g” em “Google”

**Arquivo:** `components/ui/text-rotator.tsx`

**Problema:** `overflow-hidden` + `line-height: 0.95` (classe `.text-display`) cortava descenders (ex.: “g” de Google).

**Fix:**
- `leading-[1.12]` e `pb-[0.06em]` no container
- Texto animado com `inset-x-0 top-0` em vez de `inset-0`

---

## Arquivos-chave por área

| Área | Arquivos |
|------|----------|
| Landing | `app/page.tsx`, `components/marketing/landing-motion.tsx`, `components/marketing/navbar.tsx`, `components/marketing/footer.tsx` |
| Auth UI | `app/login/page.tsx`, `app/register/page.tsx` |
| Dashboard | `app/dashboard/page.tsx`, `components/app/app-header.tsx` |
| Estilos globais | `app/globals.css` (`.zetsu-bg`, `.text-display`, `.surface-panel`, `--primary: #A8FF00`) |
| Middleware / auth guard | `proxy.ts`, `lib/security/request-guard.ts` |
| Camuflagem | `lib/camouflage/*`, `scripts/camouflage-worker.ts`, `audio-encryption-poc/` |

---

## Git — fluxo de atualização

```bash
git status
git add .
git commit -m "feat: descrição da mudança"
git push -u origin main   # primeira vez
git push                  # depois
```

**Erro comum:** `fatal: The current branch main has no upstream branch`  
→ `git push -u origin main`

---

## Deploy na VPS (Hostinger)

### Caminhos encontrados no servidor

| Caminho | Função provável |
|---------|-----------------|
| `/root/cloakerdezyv1` | Código fonte (git pull aqui) |
| `/opt/cloakerdezy` | App instalado |
| `/var/www/cloakerdzy` | Pasta web |
| `/tmp/cloakerdezy-storage` | Storage temporário |

### PM2

- **Nome atual do app:** `cloakerdezy` (com "e"). O antigo `cloakerdzy` (sem "e") foi deletado em 2026-05-27 porque travava a porta 3000 e impedia o app novo de subir (`EADDRINUSE`). **Confirmar sempre com `pm2 list`** antes de assumir o nome.
- **`exec cwd` real (pasta que o PM2 roda):** `/var/www/cloakerdzy` — confirmado por `pm2 describe cloakerdezy`. É essa a pasta onde `git pull` + `npm run build` precisam acontecer.

```bash
pm2 list                                              # confirma o nome ativo
pm2 describe cloakerdezy | grep "exec cwd"            # confirma a pasta
pm2 logs cloakerdezy --lines 50
pm2 restart cloakerdezy
```

### Atualizar código na VPS — sequência canônica

```bash
cd /var/www/cloakerdzy                                # pasta REAL do PM2
git checkout main                                     # garante que NÃO está em HEAD detached
git fetch --all
git reset --hard origin/main                          # sincroniza com remoto (descarta locais)
git log -1 --oneline                                  # confirma o commit certo

rm -rf .next node_modules
npm install                                           # CRÍTICO se package.json mudou
npm run build

pm2 restart cloakerdezy
pm2 save                                              # persiste pra reboot
pm2 logs cloakerdezy --lines 30                       # confirma sem EADDRINUSE

curl -s http://localhost:3000/login | grep -oE "Camuflador Zetsu|CloakerDezy" | head -1
# Saída esperada: "Camuflador Zetsu"
```

Se mudou só frontend, pode pular a parte Python. Se mudou pipeline:

```bash
cd audio-encryption-poc
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
deactivate
```

---

## Nginx + domínio

### Config ativa (estado desejado)

Só **`camufladorzetsu`** em `/etc/nginx/sites-enabled/`:

```
camufladorzetsu -> /etc/nginx/sites-available/camufladorzetsu
```

### Configs que existiam (conflitos resolvidos)

| Arquivo em `sites-available` | `server_name` |
|------------------------------|---------------|
| `dezycamouflage` | dezycamouflage.com |
| `cloakerdezy` | dezycamouflage.com **e** cloakerdezy.com |
| `camufladorzetsu` | camufladorzetsu.com |

**Problema:** `dezycamouflage.com` duplicado em 2 configs → `conflicting server name ... ignored`.

**Solução:** remover symlinks antigos de `sites-enabled`:

```bash
rm /etc/nginx/sites-enabled/cloakerdezy   # atenção: cloakerdezy, não cloakerdzy
nginx -t
systemctl reload nginx
```

### SSL (Certbot)

```bash
certbot --nginx -d camufladorzetsu.com
```

**Erro comum:** `NXDOMAIN` para `www.camufladorzetsu.com` — DNS do `www` não configurado.  
→ Certbot só com domínio raiz, ou criar registro A para `www` no painel DNS.

### Trocar domínio — checklist

1. DNS: registro **A** `@` → IP da VPS
2. Nginx: `server_name` com domínio novo
3. Certbot: SSL pro domínio novo
4. Supabase: Site URL + Redirect URLs
5. VPS: `git pull` + `npm run build` + `pm2 restart cloakerdezy`

**Não basta** só mudar DNS no painel Hostinger.

---

## Supabase (produção)

Em **Authentication → URL Configuration**:

- **Site URL:** `https://camufladorzetsu.com`
- **Redirect URLs:** `https://camufladorzetsu.com/**`

Variáveis de ambiente (VPS e/ou Vercel):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_ALLOWED_EMAILS`
- `DOWNLOAD_TOKEN_SECRET`

O app valida origem dinamicamente (`lib/security/request-guard.ts`: `origin.host === host`). Não há domínio hardcoded no código.

---

## Camuflagem server-side híbrida (fila + worker Python)

> A camuflagem de **Áudio** e **Vídeo** saiu do navegador e virou um pipeline
> server-side (upload → fila → worker Python → download). FFmpeg no navegador
> não engana ASR moderno; o motor real é o `audio-encryption-poc/`.
> As abas **Imagem/Metadados continuam client-side** (não precisam de ML).

### Fluxo

1. UI faz `POST /api/camouflage/jobs` (multipart) → grava input em disco e cria job `queued`.
2. UI faz poll de `GET /api/camouflage/jobs` (lista) enquanto houver job ativo.
3. Worker (`scripts/camouflage-worker.ts`, sob PM2) chama o RPC `claim_camouflage_job()` (atômico, `FOR UPDATE SKIP LOCKED`), roda o Python, atualiza progresso/status.
4. UI baixa via `GET /api/camouflage/jobs/[id]/download` (rota fora do guard de auth do middleware — ela própria checa o dono).

### Modos (híbrido)

- **Rápido (`fast`, default, CPU sem torch):** vídeo → `cloak --profile standard`; áudio → `cloak-audio --mode fast` (TTS underlay + injection bed + DSP + psicoacústica). ~segundos/arquivo. Desloca o "tópico" que a IA percebe.
- **Máximo (`max`, opt-in, fila lenta):** vídeo → `cloak --profile aggressive` (Whisper-tiny PGD); áudio → `cloak-audio --mode max` (PGD Whisper). Imperceptível + transcrição vira lixo. Minutos/arquivo na CPU; precisa de torch+whisper.

O **tópico-alvo** (`--target-preset`) é escolhido na UI (`WHITE_SCRIPT_PRESETS` em `lib/camouflage/jobs-config.ts`, casa 1:1 com `TOPIC_TARGETS` em `audio_poc.cloak.targets`).

### Banco

- Tabela `public.camouflage_jobs` + RLS (dono lê/insere/deleta os próprios) + RPC `claim_camouflage_job()` (SECURITY DEFINER, só `service_role` executa). Tudo em `supabase/schema.sql`.
- Aplicar (rodar o `schema.sql` no SQL Editor do Supabase, ou via CLI linkada). É idempotente (`if not exists` / `create or replace`).

### Envs novas (VPS)

- `CAMOUFLAGE_STORAGE_DIR` — diretório de input/output por job (ex.: `/tmp/cloakerdezy-storage`). Default: `os.tmpdir()/cloakerdezy-storage`.
- `AUDIO_POC_DIR` — caminho do `audio-encryption-poc` (default `audio-encryption-poc`).
- `AUDIO_POC_PYTHON` — python do venv (ex.: `audio-encryption-poc/.venv/bin/python`).
- (já existentes) `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — o worker usa service role.

### Deploy do worker (PM2)

```bash
# 1) dependências de sistema
apt install -y ffmpeg espeak-ng

# 2) venv do pipeline Python
cd /var/www/cloakerdzy/audio-encryption-poc
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
pip install -e ".[whisper]"     # SÓ se for usar o modo Máximo (baixa torch+whisper, ~GB)
deactivate

# 3) subir o worker além do app
cd /var/www/cloakerdzy
pm2 start npm --name cloakerdezy-worker -- run worker:camouflage
pm2 save
pm2 logs cloakerdezy-worker --lines 30   # deve logar "[worker] iniciado. Aguardando jobs..."
```

O worker lê `.env.local`/`.env` do `cwd`. Garanta que as envs acima estejam lá
(ou passe via `pm2 start ... --env`). Concorrência 1 no v1; VPS é CPU-only, então
o modo Máximo é fila lenta (minutos/arquivo). GPU depois acelera ~10x.

---

## Problemas conhecidos / armadilhas

1. **Site mostra versão antiga (login CloakerDezy):** código não atualizado na pasta REAL do PM2. Veja armadilhas 7-9 abaixo, todas dão esse sintoma.
2. **Logo com fundo branco / cache:** usar `logo-zetsu.png`; evitar cache bust quebrado no `next/image`. Em caso de teimosia, manter `unoptimized` na prop do `<Image>` (já está nos 4 lugares).
3. **Nginx `conflicting server name`:** múltiplos arquivos com mesmo `server_name` em `sites-enabled`.
4. **Naming PM2 vs Nginx:** historicamente o PM2 tinha o app `cloakerdzy` (sem "e") e o nginx referenciava `cloakerdezy` (com "e"). Hoje o app PM2 ativo é `cloakerdezy`. **Sempre confirmar com `pm2 list` antes de qualquer comando** — o nome muda.
5. **Certbot www:** precisa de registro DNS para `www` antes de incluir `-d www.dominio.com`.
6. **README** ainda cita produção Vercel (`cloakerdezyv1.vercel.app`) — VPS é o deploy principal com domínio custom.
7. **HEAD detached em `/var/www/cloakerdzy`:** se em algum momento alguém deu `git checkout <hash>` em vez de `git checkout main`, qualquer `git pull` futuro vira no-op silencioso — git só puxa em branch nomeada. Sintoma: deploy aparentemente passa mas site segue na versão velha. **Fix:** `git checkout main && git fetch --all && git reset --hard origin/main`. Verificar com `git branch` (se aparecer `* (HEAD detached from <hash>)`, é o problema).
8. **Dois apps PM2 na mesma porta 3000:** já apareceu `cloakerdzy` (legado, id 0) e `cloakerdezy` (novo, id 1) rodando juntos. O legado ocupa :3000, o novo entra em crash-loop com `Error: listen EADDRINUSE: address already in use :::3000`. PM2 reporta o novo como "online" mesmo crashando por causa do auto-restart — confiar só em `pm2 logs <name> --lines 30`. **Fix:** `pm2 delete <nome-antigo>` ANTES de subir o novo. Sempre `pm2 list` antes de qualquer deploy.
9. **Pasta usada pelo PM2 ≠ pasta onde foi feito git pull:** sintoma idêntico ao item 7. Confirmar com `pm2 describe <app> | grep "exec cwd"`. Se for diferente da pasta que recebeu o pull, o build não chega no app rodando. Hoje a pasta real é `/var/www/cloakerdzy`.
10. **`npm run build` sozinho não basta:** Next carrega o build em memória no start. Sem `pm2 restart`, ele segue servindo o build antigo mesmo com `.next/` novo no disco.
11. **`ls .next/static/css/` falha após build válido com Next 16 + Turbopack:** o CSS pode estar empacotado nos chunks de JS em vez de gerar arquivos `.css` separados. Não é erro — verificar com `find .next -name "*.css"` e checar se `.next/BUILD_ID` existe.
12. **PowerShell ExecutionPolicy bloqueia `npm.ps1`** (Windows dev local): primeira vez dá `UnauthorizedAccess`. Fix permanente: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Alternativa: usar `npm.cmd`.
13. **`ffmpeg -c:v libwebp -lossless 0` perde canal alpha** quando convertendo PNG transparente. Sai como `yuv420p` (VP8 lossy sem alpha). Pra preservar transparência usar `-lossless 1 -compression_level 6`. Resultado correto: pix_fmt `argb`.

---

## Comandos úteis de diagnóstico

```bash
# DNS
nslookup camufladorzetsu.com

# Nginx
grep -r "server_name" /etc/nginx/sites-enabled/
nginx -t

# App
pm2 list
pm2 describe cloakerdezy
pm2 describe cloakerdezy | grep "exec cwd"            # qual pasta o PM2 usa
pm2 logs cloakerdezy --lines 30                       # confirma sem EADDRINUSE

# Sanidade: o Node tá servindo o código novo?
curl -s http://localhost:3000/login | grep -oE "Camuflador Zetsu|CloakerDezy" | head -1

# Git na VPS (pasta real do PM2)
cd /var/www/cloakerdzy && git log -1 --oneline && git branch
```

---

## Histórico de sessão (resumo)

1. Logo Zetsu — troubleshooting webp/cache → migração para PNG
2. Landing — novo copy, hero Zetsu, vídeo Gon
3. Fix corte do "g" no TextRotator (Google)
4. Feature card 01 → "Uso Gratuito"
5. CloakMeter animado (Detectável ↓ / Zetsu ↑)
6. Git push + deploy VPS + migração domínio para `camufladorzetsu.com`
7. Nginx — remoção de configs duplicados (`cloakerdezy`, `dezycamouflage`)
8. **Deploy travado por HEAD detached em `/var/www/cloakerdzy`** — pasta em commit antigo (`0c129c5`), `git pull` no-op. Resolvido com `git checkout main && git reset --hard origin/main`.
9. **Conflito de apps PM2** — `cloakerdzy` (legado) ocupando :3000, `cloakerdezy` (novo) em crash-loop por `EADDRINUSE`. Resolvido com `pm2 delete cloakerdzy`. App ativo agora é `cloakerdezy` rodando de `/var/www/cloakerdzy`.

---

*Última atualização: 2026-05-27 — atualizado com sequência canônica de deploy e armadilhas 7-13.*
