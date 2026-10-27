/*
  Profile details for every NTT user (juniors fill them in on the welcome
  screen; seniors can fill them too). All columns are optional at database
  level; the welcome form asks juniors for vertical and roll number.

  Run once in Supabase -> SQL Editor. Re-running is harmless.
*/

alter table public."REF_USERS" add column if not exists vertical text;
alter table public."REF_USERS" add column if not exists roll_no text;
alter table public."REF_USERS" add column if not exists phone text;
alter table public."REF_USERS" add column if not exists linkedin_url text;
alter table public."REF_USERS" add column if not exists skills text;
alter table public."REF_USERS" add column if not exists onboarded_at timestamptz;

alter table public."REF_USERS" drop constraint if exists ref_users_vertical_check;
alter table public."REF_USERS"
add constraint ref_users_vertical_check
check (vertical is null or vertical in ('PSO', 'VAD', 'IPR', 'VOC'));

-- Keep the table locked to the public key (see 20261027_LOCK_DOWN_PUBLIC_TABLES.sql).
alter table public."REF_USERS" enable row level security;
revoke all on table public."REF_USERS" from anon, authenticated;

-- Check: should list the six new columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'REF_USERS'
  and column_name in ('vertical', 'roll_no', 'phone', 'linkedin_url', 'skills', 'onboarded_at')
order by column_name;
