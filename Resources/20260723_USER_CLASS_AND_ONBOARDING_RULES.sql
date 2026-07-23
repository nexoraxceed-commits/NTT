/*
  Nexora user classes and onboarding invariants.

  ADMIN  - full application access, user administration, board report.
  SENIOR - project/task management and assignee participation.
  JUNIOR - task-assignee participation only.
*/

alter table public."REF_USERS"
add column if not exists user_class text;

update public."REF_USERS"
set
  status = upper(status),
  user_class = coalesce(upper(user_class), 'SENIOR');

alter table public."REF_USERS"
alter column status set default 'PENDING';

alter table public."REF_USERS"
alter column status set not null;

alter table public."REF_USERS"
alter column user_class set not null;

alter table public."REF_USERS"
drop constraint if exists ref_users_status_check;

alter table public."REF_USERS"
add constraint ref_users_status_check
check (status in ('PENDING', 'NORMAL'));

alter table public."REF_USERS"
drop constraint if exists ref_users_user_class_check;

alter table public."REF_USERS"
add constraint ref_users_user_class_check
check (user_class in ('ADMIN', 'SENIOR', 'JUNIOR'));

/*
  A pending application user must not be linked to Auth. An active user must
  have the exact Supabase Auth UID written by the backend activation flow.
*/
alter table public."REF_USERS"
drop constraint if exists ref_users_onboarding_state_check;

alter table public."REF_USERS"
add constraint ref_users_onboarding_state_check
check (
  (status = 'PENDING' and auth_uid is null)
  or
  (status = 'NORMAL' and auth_uid is not null)
);

create unique index if not exists uq_ref_users_email_lower
on public."REF_USERS" (lower(user_id));

create unique index if not exists uq_ref_users_auth_uid
on public."REF_USERS" (auth_uid)
where auth_uid is not null;

create index if not exists idx_ref_users_class_status
on public."REF_USERS" (user_class, status);

notify pgrst, 'reload schema';
