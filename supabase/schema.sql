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
