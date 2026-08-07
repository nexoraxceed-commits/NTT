/*
  Prevent browser/public Supabase clients from reading or modifying REF_USERS.

  The FastAPI backend uses the server-only Supabase secret/service role and
  therefore remains able to manage this table after enforcing ADMIN access.
*/

begin;

alter table public."REF_USERS" enable row level security;

/* Remove any policies that could have granted browser access previously. */
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'REF_USERS'
  loop
    execute format(
      'drop policy if exists %I on public."REF_USERS"',
      policy_record.policyname
    );
  end loop;
end
$$;

/*
  Defense in depth: even if a permissive RLS policy is added accidentally,
  public browser roles still have no table privilege with which to use it.
*/
revoke all privileges on table public."REF_USERS" from anon;
revoke all privileges on table public."REF_USERS" from authenticated;

/* Preserve explicit access for the trusted backend role. */
grant select, insert, update, delete on table public."REF_USERS" to service_role;

commit;

notify pgrst, 'reload schema';
