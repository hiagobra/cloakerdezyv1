# CloakerDezy

Dashboard de upload/camuflagem de videos com autenticacao via Supabase (email+senha), persistencia de perfil (email+telefone) e download protegido por token assinado.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Supabase (Auth + schema + RLS)
- Pipeline de camuflagem em Python (`audio-encryption-poc`) + ffmpeg

## 1) Rodar localmente

### 1.1 Instalar dependencias

```bash
npm.cmd install
```

### 1.2 Criar `.env.local`

Use `.env.local.example` como base e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
ADMIN_ALLOWED_PHONES=+5511999999999

# Segredo de download assinado
DOWNLOAD_TOKEN_SECRET=troque-por-outro-segredo-longo

# Pipeline de camuflagem
AUDIO_POC_PATH=C:/Users/hiago/Downloads/www.maskai.co/audio-encryption-poc
CAMOUFLAGE_STORAGE_DIR=C:/Users/hiago/Desktop/cloakerdezy/.runtime-storage
```

### 1.3 Subir app e worker (dois terminais)

Terminal 1 (web):

```bash
npm.cmd run dev
```

Terminal 2 (worker):

```bash
npm.cmd run worker:camouflage
```

Abra [http://localhost:3000](http://localhost:3000).

Observacao:
- local/dev: pode usar worker dedicado (`worker:camouflage`).
- producao em Vercel: o status endpoint faz fallback para processar/encerrar job e evitar `processing` infinito.

## 2) Configurar Supabase do zero

1. Crie um projeto em [Supabase Dashboard](https://supabase.com/dashboard/projects).
2. Em **Project Settings > API**, copie:
   - `Project URL`
   - `Publishable key` (`sb_publishable_...`)
3. Execute no SQL Editor:
   - `supabase/schema.sql`
4. Valide RLS e policies com:
   - `supabase/verify-rls.sql`
5. (Opcional) Popule admins na allowlist, caso queira visao administrativa por telefone:

```sql
insert into public.admin_allowlist (phone)
values ('+5511999999999')
on conflict (phone) do nothing;
```

## 3) Fluxo atual da aplicacao

- `/login`: login/cadastro por email+senha via Supabase Auth e captura telefone.
- `public.profiles`: registra `email`, `phone` e `last_seen_at`.
- `/dashboard`: upload de videos, cria job e acompanha status.
- `/api/camouflage/[jobId]`: se necessario, conclui job em fallback e impede loop infinito.
- download usa URL assinada com expiracao curta.

## 4) Deploy no Vercel (passo a passo simples)

1. Suba o repo no GitHub.
2. Importe o repo no Vercel.
3. Em **Project Settings > Environment Variables**, adicione:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `ADMIN_ALLOWED_PHONES`
   - `DOWNLOAD_TOKEN_SECRET`
   - `AUDIO_POC_PATH`
   - `CAMOUFLAGE_STORAGE_DIR`
4. Faça deploy.
5. Valide em producao:
   - login/cadastro por email+senha
   - upload de video
   - processamento finalizando em `done` ou `failed` (nunca preso infinito)
   - download do arquivo camuflado

## 5) Hardening (anti-clone realista)

Nenhum bypass impede clone 100%, mas isso dificulta muito:

1. Mantenha segredo e logica critica no servidor/worker (nao no frontend).
2. Exija sessao Supabase para `/dashboard` e `/api/camouflage*`.
3. Use rate limit em login e APIs sensiveis.
4. Gere downloads com token assinado e expiracao curta.
5. Deixe source maps desativados em producao.
6. Ative WAF/Bot Protection no provedor de borda.
7. Assine contratos/licenca e tenha revogacao por conta/chave.

## 6) Estrutura principal

- `app/login/page.tsx`: tela de login/cadastro Supabase.
- `app/dashboard/page.tsx`: dashboard de fila/processamento/download.
- `app/api/auth/*`: login/logout via Supabase Auth.
- `app/api/camouflage/*`: enqueue/status/download assinado.
- `lib/camouflage/*`: fila, processamento e worker loop.
- `scripts/camouflage-worker.ts`: worker dedicado.
- `supabase/schema.sql`: schema base + RLS.
- `supabase/verify-rls.sql`: validacao de RLS/policies.
