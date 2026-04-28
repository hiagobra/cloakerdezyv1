-- Verificacao rapida de RLS apos aplicar schema.sql
-- Execute manualmente no SQL Editor do Supabase.

-- 1) Confirmar tabelas com RLS ativo
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'admin_allowlist')
order by tablename;

-- 2) Confirmar policies criadas
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'admin_allowlist')
order by tablename, policyname;

-- 3) Conferir allowlist atual
select phone, created_at
from public.admin_allowlist
order by created_at desc;

-- 4) Conferir dados de perfil (email + telefone)
select id, email, phone, last_seen_at, created_at
from public.profiles
order by created_at desc
limit 20;

