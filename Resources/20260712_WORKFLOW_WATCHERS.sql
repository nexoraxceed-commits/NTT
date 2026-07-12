alter table public."PROJECTS"
add column if not exists assigned_to uuid;

alter table public."PROJECTS"
add column if not exists document_name text;

alter table public."PROJECTS"
add column if not exists document_url text;

alter table public."TASKS"
add column if not exists stakeholder_id uuid;

alter table public."TASKS"
alter column status set default 'OPEN';

update public."PROJECTS" p
set assigned_to = pm.user_id
from public."PROJECT_MEMBERS" pm
where p.assigned_to is null
  and pm.project_id = p.id
  and pm.role = 'OWNER'
  and pm.status = 'ACTIVE';

update public."TASKS"
set status = 'OPEN'
where status is null or status = 'TODO';

create table if not exists public."PROJECT_WATCHERS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  project_id bigint not null references public."PROJECTS"(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'ACTIVE',
  unique(project_id, user_id)
);

create table if not exists public."TASK_WATCHERS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'ACTIVE',
  unique(task_id, user_id)
);

create table if not exists public."NOTIFICATION_LOG" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  recipient_user_id uuid not null,
  recipient_email text,
  subject text not null,
  body text,
  status text not null default 'PENDING',
  source_type text not null,
  source_id bigint not null
);

create index if not exists idx_projects_assigned_to
on public."PROJECTS" (assigned_to);

create index if not exists idx_project_watchers_project_status
on public."PROJECT_WATCHERS" (project_id, status);

create index if not exists idx_project_watchers_user_status
on public."PROJECT_WATCHERS" (user_id, status);

create index if not exists idx_tasks_stakeholder_id
on public."TASKS" (stakeholder_id);

create index if not exists idx_task_watchers_task_status
on public."TASK_WATCHERS" (task_id, status);

create index if not exists idx_task_watchers_user_status
on public."TASK_WATCHERS" (user_id, status);

create index if not exists idx_notification_log_recipient_status
on public."NOTIFICATION_LOG" (recipient_user_id, status);
