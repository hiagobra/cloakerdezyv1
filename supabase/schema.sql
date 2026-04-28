-- CloakerDezy - schema base para dashboard admin
-- Execute no SQL Editor do Supabase.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  phone text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;

create unique index if not exists profiles_email_unique_idx on public.profiles (email) where email is not null;
create unique index if not exists profiles_phone_unique_idx on public.profiles (phone) where phone is not null;

create table if not exists public.admin_allowlist (
  phone text primary key,
  created_at timestamptz not null default timezone('utc', now())
);

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
  insert into public.profiles (id, email, phone, last_seen_at)
  values (new.id, new.email, new.phone, timezone('utc', now()))
  on conflict (id) do update
    set email = excluded.email,
        phone = excluded.phone,
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
alter table public.admin_allowlist enable row level security;

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
create policy "admins_view_all_profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_allowlist a
    where a.phone = ((select auth.jwt()) ->> 'phone')
  )
);

drop policy if exists "admins_view_allowlist" on public.admin_allowlist;
create policy "admins_view_allowlist"
on public.admin_allowlist
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_allowlist a
    where a.phone = ((select auth.jwt()) ->> 'phone')
  )
);

-- Nao criar policy de INSERT/UPDATE/DELETE na allowlist.
-- A tabela deve ser gerenciada apenas pelo SQL Editor (service role).
