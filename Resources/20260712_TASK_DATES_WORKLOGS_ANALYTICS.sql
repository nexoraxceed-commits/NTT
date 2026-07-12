alter table public."PROJECTS"
add column if not exists stakeholder_id uuid;

alter table public."TASKS"
add column if not exists start_date timestamptz;

alter table public."TASKS"
add column if not exists end_date date;

update public."TASKS"
set end_date = coalesce(end_date, current_date)
where end_date is null;

alter table public."TASKS"
alter column end_date set not null;

create table if not exists public."TASK_WORK_LOGS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  logged_by uuid not null,
  work_date date not null default current_date,
  hours numeric(5, 2),
  work_note text not null
);

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

create index if not exists idx_projects_stakeholder_id
on public."PROJECTS" (stakeholder_id);

create index if not exists idx_tasks_start_date
on public."TASKS" (start_date);

create index if not exists idx_tasks_end_date
on public."TASKS" (end_date);

create index if not exists idx_task_work_logs_task_date
on public."TASK_WORK_LOGS" (task_id, work_date desc);

create index if not exists idx_task_work_logs_logged_by
on public."TASK_WORK_LOGS" (logged_by);

create index if not exists idx_task_access_log_task_created
on public."TASK_ACCESS_LOG" (task_id, created_at desc);

create index if not exists idx_task_access_log_project_created
on public."TASK_ACCESS_LOG" (project_id, created_at desc);

create index if not exists idx_task_access_log_event_type
on public."TASK_ACCESS_LOG" (event_type);

notify pgrst, 'reload schema';
