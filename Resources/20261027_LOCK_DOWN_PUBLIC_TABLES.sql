/*
  Lock down every NTT table so the public (publishable/anon) key cannot read
  or change data directly.

  Why: the publishable key ships inside the website (Frontend/Js/config.js),
  as Supabase intends. With RLS disabled, anyone holding that key could read
  or edit every table through Supabase's REST API, bypassing the backend.

  Safe for NTT because the backend reads and writes tables only with the
  secret (service_role) key, which bypasses RLS. The publishable key is used
  only for Supabase Auth (sign in, sign up, password reset), which lives in
  the separate "auth" schema and is not affected.

  Run once in Supabase -> SQL Editor. Re-running is harmless.
*/

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end
$$;

revoke all on all sequences in schema public from anon, authenticated;

-- Tables created later start locked too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Check: every row should say rls_enabled = true and public_can_read = false.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'select') as public_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

/*
  Undo (only if something unexpected breaks):
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    -- and per table: alter table public."TABLE_NAME" disable row level security;
*/
