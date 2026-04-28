# CloakerDezy

App Next.js 16 com cadastro/login Supabase, fluxo de aprovação manual pelo admin e dashboard com upload e camuflagem de vídeos.

> Produção: [https://cloakerdezyv1.vercel.app](https://cloakerdezyv1.vercel.app)

## Stack

- Next.js 16 (App Router) + TypeScript
- Supabase Auth, Postgres, RLS
- Service Role para criar contas (sem rate limit de email)
- Pipeline Python opcional para camuflagem (uso local)

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
- **Camuflagem `failed`**: pipeline Python não disponível neste ambiente. Use local.
- **Login dá 401**: senha incorreta ou usuário ainda não criado.
