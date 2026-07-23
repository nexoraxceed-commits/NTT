/*
  NEXORA FULL DATA RESET
  ======================

  Purpose:
    Remove all application transaction data and all user data while preserving
    tables, columns, constraints, indexes, functions, and migrations.

  WARNING:
    This operation is destructive and cannot be undone unless a database backup
    or point-in-time recovery is available.

  Before running:
    1. Take and verify a Supabase backup.
    2. Stop the backend or place the application in maintenance mode.
    3. Confirm that no production environment was selected accidentally.
    4. Change confirmed below from false to true.

  Scope:
    - Projects and tasks
    - Comments and replies
    - Work logs and task access/audit events
    - Project/task watcher and legacy membership records
    - Notifications and push subscriptions
    - REF_USERS application user/allow-list records
    - Supabase Auth users, identities, sessions, refresh tokens, and related
      Auth rows that cascade from auth.users

  Not cleared:
    - Database schema and migrations
    - Configuration and secrets
    - Supabase Storage objects (the reviewed application stores document URLs,
      not managed uploads)
*/

begin;

do $reset$
declare
  confirmed boolean := false; -- CHANGE TO true ONLY WHEN A FULL RESET IS INTENDED.
  target_table text;
  deleted_auth_users bigint := 0;
  application_tables constant text[] := array[
    -- Child/transaction tables first.
    'PUSH_SUBSCRIPTIONS',
    'NOTIFICATION_LOG',
    'TASK_ACCESS_LOG',
    'TASK_WORK_LOGS',
    'TASK_COMMENTS',
    'TASK_WATCHERS',       -- Legacy table; retained for compatible resets.
    'PROJECT_WATCHERS',
    'PROJECT_MEMBERS',     -- Legacy table; retained for compatible resets.
    'TASKS',
    'PROJECTS',
    -- Application user directory / signup allow-list.
    'REF_USERS'
  ];
begin
  if not confirmed then
    raise exception using
      message = 'Nexora data reset aborted: confirmation flag is false.',
      hint = 'Review the script and backup, then change confirmed to true.';
  end if;

  /*
    Each table is checked before truncation so the same reset works against
    both the current role model and installations that still have legacy
    PROJECT_MEMBERS or TASK_WATCHERS tables.
  */
  foreach target_table in array application_tables
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format(
        'truncate table public.%I restart identity cascade',
        target_table
      );
      raise notice 'Cleared public.%', target_table;
    else
      raise notice 'Skipped missing table public.%', target_table;
    end if;
  end loop;

  /*
    Deleting auth.users is the supported relational operation here rather than
    truncating Auth schema tables independently. Supabase-managed foreign keys
    cascade the deletion into identities, sessions, refresh tokens, MFA data,
    and other user-owned Auth rows.
  */
  if to_regclass('auth.users') is not null then
    delete from auth.users;
    get diagnostics deleted_auth_users = row_count;
    raise notice 'Deleted % Supabase Auth user(s).', deleted_auth_users;
  else
    raise exception 'Expected Supabase table auth.users was not found.';
  end if;
end
$reset$;

commit;

/*
  Post-reset verification (run separately after the transaction succeeds):

  select 'PROJECTS' as table_name, count(*) as remaining_rows
  from public."PROJECTS"
  union all
  select 'TASKS', count(*) from public."TASKS"
  union all
  select 'TASK_COMMENTS', count(*) from public."TASK_COMMENTS"
  union all
  select 'TASK_WORK_LOGS', count(*) from public."TASK_WORK_LOGS"
  union all
  select 'TASK_ACCESS_LOG', count(*) from public."TASK_ACCESS_LOG"
  union all
  select 'PROJECT_WATCHERS', count(*) from public."PROJECT_WATCHERS"
  union all
  select 'NOTIFICATION_LOG', count(*) from public."NOTIFICATION_LOG"
  union all
  select 'PUSH_SUBSCRIPTIONS', count(*) from public."PUSH_SUBSCRIPTIONS"
  union all
  select 'REF_USERS', count(*) from public."REF_USERS"
  union all
  select 'auth.users', count(*) from auth.users;
*/
