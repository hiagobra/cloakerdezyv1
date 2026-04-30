# CloakerDezy

App Next.js 16 com cadastro/login Supabase, fluxo de aprovação manual pelo admin e dashboard com upload e camuflagem de vídeos.

> Produção: [https://cloakerdezyv1.vercel.app](https://cloakerdezyv1.vercel.app)

## Stack

- Next.js 16 (App Router) + TypeScript
- Supabase Auth, Postgres, RLS
- Service Role para criar contas (sem rate limit de email)
- Pipeline Python multimodal (cloak) com 4 camadas de evasão contra moderadores tipo Gemini

## Camuflagem multimodal (cloak)

A pipeline Python em `audio-encryption-poc/` empilha 4 camadas para fazer um
moderador multimodal (Gemini, GPT-4o, etc.) classificar o vídeo em um tópico-alvo
diferente do real:

1. **Áudio**: TTS underlay com sidechain duck e (opcional) ataque adversarial PGD em Whisper.
2. **Visual**: overlay de texto via `ffmpeg drawtext`, steganografia downscale, patch CLIP opcional.
3. **Track**: faixa de legenda SRT injetada como soft subtitle + metadata MP4 (title/comment/keywords).
4. **Verify**: re-classificação via Whisper/YAMNet local ou via Gemini API (`google-generativeai`).

O dashboard expõe duas dimensões:

- **Intensidade** (`leve` / `medio` / `forte` -> profile `minimal` / `standard` / `aggressive`).
- **Tópico-alvo** (financas_pt, tecnologia_pt, culinaria_pt, finance_en, fitness_en).

**Expectativa realista:** não existe “100% invisível para qualquer máquina”. O que a
stack faz é **empilhar sinais fortes do tópico-alvo** (texto em frame, legenda,
metadata, áudio sintético) para que modelos como o Gemini **priorizem** esse
contexto em vez do conteúdo original. Os **pixels** da cena (comida, pessoa,
etc.) continuam lá; se o modelo der muito peso a visão pura, ainda pode haver
resíduo do tópico real. Quanto mais alta a intensidade (`medio`/`forte`), mais
agressivos são overlay e âncora de legenda — maior chance de classificação
errada para o alvo, porém mais óbvio visualmente para humanos.

Detalhes técnicos completos em [audio-encryption-poc/README.md](audio-encryption-poc/README.md).

## Fluxo do produto

1. Usuário cria conta em `/register` (email, senha, telefone).
2. O cadastro fica `pending` em `public.profiles`.
3. Admin (`hiagobrambatti@gmail.com`) entra em `/admin` e aprova ou recusa.
4. Apenas usuários `approved` conseguem usar `/dashboard`.

## 1) Rodar localmente

```bash
npm.cmd install
npm.cmd run dev
```

Acesse `http://localhost:3000`.

### Variáveis necessárias em `.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_ALLOWED_EMAILS=hiagobrambatti@gmail.com
DOWNLOAD_TOKEN_SECRET=troque-por-um-segredo-longo

# Apenas para uso local com worker e Python
AUDIO_POC_PATH=C:/Users/hiago/Downloads/www.maskai.co/audio-encryption-poc
CAMOUFLAGE_STORAGE_DIR=C:/Users/hiago/Desktop/cloakerdezy/.runtime-storage
```

> Importante: `SUPABASE_SERVICE_ROLE_KEY` é segredo. Nunca exponha no cliente nem comite no Git.

### Worker de camuflagem (opcional, local)

Em outra aba:

```bash
npm.cmd run worker:camouflage
```

O worker só faz sentido local (com Python e ffmpeg instalados). Em produção/Vercel a camuflagem usa fallback inline e marca o job como `failed` se a pipeline não estiver disponível.

### Setup da pipeline Python (uma vez)

```bash
cd audio-encryption-poc
python -m venv .venv
# Linux/macOS: source .venv/bin/activate    Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -e .
```

Extras opcionais (instale conforme o profile desejado):

```bash
pip install -e .[whisper]   # PGD direcionado em Whisper (profile aggressive)
pip install -e .[gemini]    # verify Gemini via CLI
pip install -e .[all]       # tudo (inclui torch + tensorflow)
```

Sistema requer:

- `ffmpeg` e `ffprobe` no PATH (obrigatório).
- Em Linux, para que a camada `audio_tts` funcione: `sudo apt install espeak-ng`.
  Sem isso a camada falha graciosamente; as outras 3 (overlay/SRT/metadata) seguem funcionando.

## 2) Configurar Supabase

1. Crie projeto em [Supabase Dashboard](https://supabase.com/dashboard).
2. Em **Project Settings > API** copie:
   - `Project URL`
   - `Publishable key` (`sb_publishable_...`)
   - `Service Role Key`
3. Aplique o schema:

```bash
npm.cmd run supabase:db:push
```

Ou cole o conteúdo de `supabase/schema.sql` no SQL Editor.

4. Verifique:

```bash
npm.cmd run supabase:db:verify-rls
```

## 3) Promover você como admin existente

Se você já tinha cadastro com seu email admin, garanta `status = 'approved'`:

```sql
update public.profiles
set status = 'approved', approved_at = timezone('utc', now())
where email = 'hiagobrambatti@gmail.com';
```

## 4) Deploy na Vercel

Configure em **Project Settings > Environment Variables (Production)**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_ALLOWED_EMAILS`
- `DOWNLOAD_TOKEN_SECRET`

E faça `Redeploy`.

Subir local com CLI:

```bash
npx.cmd vercel --prod --yes
```

## 5) Sobre o `email rate limit`

Resolvido na origem:

- Cadastro usa `auth.admin.createUser` (Service Role) com `email_confirm: true`.
- Nenhum email é enviado pelo Supabase no cadastro, então o limite de SMTP nunca dispara.
- Login também não envia email (apenas `signInWithPassword`).

Boa prática extra: em **Auth > Providers > Email** desative confirmação obrigatória.

## 6) Estrutura principal

- `app/register/page.tsx`: cadastro com retorno "aguarde aprovação".
- `app/login/page.tsx`: login com mensagens claras de pendente/recusado.
- `app/admin/page.tsx`: painel admin com aprovar/recusar.
- `app/dashboard/page.tsx`: upload, processamento e download.
- `app/api/auth/register/route.ts`: cria via Service Role + profile pending.
- `app/api/auth/login/route.ts`: bloqueia se `status != approved`.
- `app/api/admin/profiles/[id]/approve|reject/route.ts`: ações admin.
- `lib/auth/admin.ts`: identificação por email via `ADMIN_ALLOWED_EMAILS`.
- `lib/supabase/admin.ts`: cliente server-only com Service Role.
- `proxy.ts`: protege `/admin`, `/dashboard`, `/api/admin/*`, `/api/camouflage/*`.
- `supabase/schema.sql`: profiles + status + RLS.

## 7) Solução rápida de problemas

- **"Cadastro pendente de aprovação"**: aprove em `/admin`.
- **"Origem nao autorizada"**: garanta que está acessando o domínio configurado.
- **Camuflagem `failed`**: pipeline Python não disponível neste ambiente. Verifique se `AUDIO_POC_PATH` aponta para a pasta `audio-encryption-poc/` correta e se `pip install -e .` foi rodado dentro dela.
- **Camada `audio_tts` falhou em Linux**: instale `espeak-ng` (`sudo apt install espeak-ng`).
- **Login dá 401**: senha incorreta ou usuário ainda não criado.

## 8) Deploy de atualização (resumo)

Local:

```bash
git add -A
git commit -m "feat: <descrição>"
git push origin main
```

Na VPS:

```bash
cd /CAMINHO/cloakerdezyv1
git pull origin main
cd audio-encryption-poc
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
deactivate
cd ..
npm ci
npm run build
pm2 restart NOME_DO_APP
```
