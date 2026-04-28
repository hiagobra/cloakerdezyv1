-- Verificacao rapida apos aplicar schema.sql
-- Execute manualmente no SQL Editor do Supabase ou via supabase:db:verify-rls.

-- 1) RLS ativo em profiles
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'profiles';

-- 2) Policies ativas
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'profiles'
order by policyname;

-- 3) Cadastros recentes e status
select id, email, phone, status, approved_at, last_seen_at
from public.profiles
order by created_at desc
limit 20;

-- 4) Fila de aprovacoes pendentes
select id, email, phone, created_at
from public.profiles
where status = 'pending'
order by created_at asc
limit 20;
