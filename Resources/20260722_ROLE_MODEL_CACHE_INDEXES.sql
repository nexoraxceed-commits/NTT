alter table public."PROJECTS"
add column if not exists stakeholder_id uuid;

alter table public."REF_USERS"
add column if not exists auth_uid uuid;

alter table public."PROJECTS"
add column if not exists document_name text;

alter table public."PROJECTS"
add column if not exists document_url text;

alter table public."TASKS"
add column if not exists start_date timestamptz;

alter table public."TASKS"
add column if not exists end_date date;

update public."TASKS"
set end_date = coalesce(end_date, current_date)
where end_date is null;

alter table public."TASKS"
alter column end_date set not null;

alter table public."TASKS"
alter column status set default 'OPEN';

alter table public."TASKS"
drop constraint if exists tasks_status_check;

update public."TASKS"
set status = 'OPEN'
where status is null
   or status not in ('OPEN', 'IN PROGRESS', 'CLOSE REQUESTED', 'CLOSED');

alter table public."TASKS"
add constraint tasks_status_check
check (status in ('OPEN', 'IN PROGRESS', 'CLOSE REQUESTED', 'CLOSED'));

create table if not exists public."PROJECT_WATCHERS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  project_id bigint not null references public."PROJECTS"(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'ACTIVE',
  unique(project_id, user_id)
);

create table if not exists public."TASK_WORK_LOGS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  logged_by uuid not null,
  work_date date not null default current_date,
  hours numeric(5, 2) not null,
  work_note text not null
);

update public."TASK_WORK_LOGS"
set hours = 0.25
where hours is null or hours <= 0;

alter table public."TASK_WORK_LOGS"
alter column hours set not null;

alter table public."TASK_WORK_LOGS"
drop constraint if exists task_work_logs_hours_check;

alter table public."TASK_WORK_LOGS"
add constraint task_work_logs_hours_check
check (hours > 0 and hours <= 24);

create table if not exists public."TASK_ACCESS_LOG" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  project_id bigint not null references public."PROJECTS"(id) on delete cascade,
  actor_user_id uuid,
  event_type text not null,
  previous_status text,
  new_status text,
  previous_assignee_id uuid,
  new_assignee_id uuid,
  event_note text
);

create table if not exists public."NOTIFICATION_LOG" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  recipient_user_id uuid not null,
  recipient_email text,
  subject text not null,
  body text,
  description text,
  status text not null default 'UNREAD',
  source_type text not null,
  source_id bigint not null,
  target_url text
);

alter table public."NOTIFICATION_LOG"
add column if not exists description text;

alter table public."NOTIFICATION_LOG"
add column if not exists target_url text;

alter table public."NOTIFICATION_LOG"
add column if not exists read_at timestamptz;

alter table public."NOTIFICATION_LOG"
alter column status set default 'UNREAD';

update public."NOTIFICATION_LOG"
set status = 'UNREAD'
where status is null
   or status = 'PENDING';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'PROJECTS'
      and column_name = 'assigned_to'
  ) then
    execute '
      insert into public."PROJECT_WATCHERS" (project_id, user_id, status)
      select id, assigned_to, ''ACTIVE''
      from public."PROJECTS"
      where assigned_to is not null
      on conflict (project_id, user_id)
      do update set status = ''ACTIVE''
    ';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'TASKS'
      and column_name = 'stakeholder_id'
  ) then
    execute '
      update public."PROJECTS" p
      set stakeholder_id = t.stakeholder_id
      from public."TASKS" t
      where p.id = t.project_id
        and p.stakeholder_id is null
        and t.stakeholder_id is not null
    ';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'TASK_WATCHERS'
  ) then
    execute '
      insert into public."PROJECT_WATCHERS" (project_id, user_id, status)
      select distinct t.project_id, tw.user_id, ''ACTIVE''
      from public."TASK_WATCHERS" tw
      join public."TASKS" t on t.id = tw.task_id
      where tw.status = ''ACTIVE''
      on conflict (project_id, user_id)
      do update set status = ''ACTIVE''
    ';
  end if;
end $$;

insert into public."TASK_ACCESS_LOG" (
  task_id,
  project_id,
  actor_user_id,
  event_type,
  new_status,
  new_assignee_id,
  event_note,
  created_at
)
select
  t.id,
  t.project_id,
  t.created_by,
  'TASK_CREATED',
  t.status,
  t.assigned_to,
  'Backfilled from existing task record.',
  t.created_at
from public."TASKS" t
where not exists (
  select 1
  from public."TASK_ACCESS_LOG" al
  where al.task_id = t.id
    and al.event_type = 'TASK_CREATED'
);

create index if not exists idx_ref_users_auth_status
on public."REF_USERS" (auth_uid, status);

create index if not exists idx_ref_users_email_status
on public."REF_USERS" (lower(user_id), status);

create index if not exists idx_projects_status_created
on public."PROJECTS" (status, created_at desc);

create index if not exists idx_projects_stakeholder_status
on public."PROJECTS" (stakeholder_id, status);

create index if not exists idx_project_watchers_project_status_user
on public."PROJECT_WATCHERS" (project_id, status, user_id);

create index if not exists idx_project_watchers_user_status_project
on public."PROJECT_WATCHERS" (user_id, status, project_id);

create index if not exists idx_tasks_project_status_end
on public."TASKS" (project_id, status, end_date);

create index if not exists idx_tasks_assigned_status_end
on public."TASKS" (assigned_to, status, end_date);

create index if not exists idx_tasks_project_created
on public."TASKS" (project_id, created_at desc);

create index if not exists idx_task_work_logs_task_date
on public."TASK_WORK_LOGS" (task_id, work_date desc);

create index if not exists idx_task_work_logs_logged_by_date
on public."TASK_WORK_LOGS" (logged_by, work_date desc);

create index if not exists idx_task_access_log_task_created_at
on public."TASK_ACCESS_LOG" (task_id, created_at desc);

create index if not exists idx_task_access_log_project_created_at
on public."TASK_ACCESS_LOG" (project_id, created_at desc);

create index if not exists idx_task_access_log_event_type
on public."TASK_ACCESS_LOG" (event_type);

create index if not exists idx_notification_log_recipient_status_created
on public."NOTIFICATION_LOG" (recipient_user_id, status, created_at desc);

create index if not exists idx_notification_log_source
on public."NOTIFICATION_LOG" (source_type, source_id);

notify pgrst, 'reload schema';
