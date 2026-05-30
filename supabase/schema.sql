-- CloakerDezy - schema com aprovacao manual de cadastros
-- Execute no SQL Editor do Supabase ou via supabase db push.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  phone text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists status text not null default 'pending';
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create unique index if not exists profiles_email_unique_idx on public.profiles (email) where email is not null;
create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_phone_idx on public.profiles (phone);

-- Remove unique constraint herdada do schema antigo: telefone nao deve ser unico.
alter table public.profiles drop constraint if exists profiles_phone_key;

drop policy if exists "admins_view_all_profiles" on public.profiles;
drop table if exists public.admin_allowlist cascade;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, phone, status, last_seen_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'phone', new.phone),
    'pending',
    timezone('utc', now())
  )
  on conflict (id) do update
    set email = excluded.email,
        phone = coalesce(public.profiles.phone, excluded.phone),
        last_seen_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.handle_updated_at() from public;
revoke execute on function public.handle_updated_at() from anon;
revoke execute on function public.handle_updated_at() from authenticated;

alter table public.profiles enable row level security;

drop policy if exists "users_view_own_profile" on public.profiles;
create policy "users_view_own_profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "users_insert_own_profile" on public.profiles;
create policy "users_insert_own_profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "admins_view_all_profiles" on public.profiles;
drop policy if exists "admins_update_status" on public.profiles;
drop policy if exists "admins_view_allowlist" on public.profiles;

-- Operacoes administrativas (ver todos / atualizar status) sao feitas pelo
-- backend usando a Service Role Key, que ja bypass RLS. Por isso nao criamos
-- policy de admin aqui - mantemos a tabela 100% protegida para clientes.

-- ============================================================
-- camouflage_logs: registro de cada camuflagem concluida.
-- A camuflagem roda 100% no browser; o cliente reporta cada sucesso aqui
-- para alimentar a metrica de total processado no painel admin.
-- ============================================================

create table if not exists public.camouflage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  type text not null check (type in ('video', 'audio', 'image', 'metadata')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists camouflage_logs_user_idx on public.camouflage_logs (user_id);
create index if not exists camouflage_logs_created_idx on public.camouflage_logs (created_at);
create index if not exists camouflage_logs_type_idx on public.camouflage_logs (type);

alter table public.camouflage_logs enable row level security;

drop policy if exists "users_insert_own_logs" on public.camouflage_logs;
create policy "users_insert_own_logs"
on public.camouflage_logs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users_view_own_logs" on public.camouflage_logs;
create policy "users_view_own_logs"
on public.camouflage_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Leitura agregada (total da plataforma) e feita pelo backend com Service Role,
-- que bypassa RLS - nao expomos contagem global para clientes.

-- ============================================================
-- camouflage_jobs: fila de processamento server-side.
-- O cliente faz upload (cria job 'queued'), o worker dedicado (Service Role)
-- pega 1 job atomico via claim_camouflage_job(), roda o pipeline Python e
-- atualiza status/output. O cliente faz poll e baixa o resultado.
-- ============================================================

create table if not exists public.camouflage_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('audio', 'video', 'filter')),
  mode text not null default 'fast' check (mode in ('fast', 'max')),
  target_preset text,
  cover_path text,
  cover_name text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'error')),
  progress int not null default 0,
  message text,
  input_path text not null,
  input_name text not null,
  output_path text,
  output_name text,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz
);

-- Migracoes idempotentes para bancos ja existentes (create table if not exists
-- nao re-aplica colunas/checks novos).
alter table public.camouflage_jobs add column if not exists cover_path text;
alter table public.camouflage_jobs add column if not exists cover_name text;

-- Recria o check do kind para incluir 'filter' (aba Filtros / desmark).
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'camouflage_jobs_kind_check'
  ) then
    alter table public.camouflage_jobs drop constraint camouflage_jobs_kind_check;
  end if;
  alter table public.camouflage_jobs
    add constraint camouflage_jobs_kind_check
    check (kind in ('audio', 'video', 'filter'));
end $$;

create index if not exists camouflage_jobs_user_idx on public.camouflage_jobs (user_id);
create index if not exists camouflage_jobs_status_idx on public.camouflage_jobs (status);
create index if not exists camouflage_jobs_created_idx on public.camouflage_jobs (created_at);

drop trigger if exists camouflage_jobs_set_updated_at on public.camouflage_jobs;
create trigger camouflage_jobs_set_updated_at
before update on public.camouflage_jobs
for each row
execute function public.handle_updated_at();

alter table public.camouflage_jobs enable row level security;

drop policy if exists "users_insert_own_jobs" on public.camouflage_jobs;
create policy "users_insert_own_jobs"
on public.camouflage_jobs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users_view_own_jobs" on public.camouflage_jobs;
create policy "users_view_own_jobs"
on public.camouflage_jobs
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users_delete_own_jobs" on public.camouflage_jobs;
create policy "users_delete_own_jobs"
on public.camouflage_jobs
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Atualizacao de status/output/progress e feita SOMENTE pelo worker via Service
-- Role (bypassa RLS). Por isso nao criamos policy de update para clientes.

-- claim_camouflage_job(): pega o job 'queued' mais antigo e marca como
-- 'processing' de forma atomica (FOR UPDATE SKIP LOCKED), evitando que dois
-- workers peguem o mesmo job. Retorna o job reivindicado ou NULL se a fila
-- estiver vazia. So o Service Role pode executar.
create or replace function public.claim_camouflage_job()
returns public.camouflage_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.camouflage_jobs;
begin
  select * into claimed
  from public.camouflage_jobs
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.camouflage_jobs
  set status = 'processing',
      started_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

revoke execute on function public.claim_camouflage_job() from public;
revoke execute on function public.claim_camouflage_job() from anon;
revoke execute on function public.claim_camouflage_job() from authenticated;
grant execute on function public.claim_camouflage_job() to service_role;
