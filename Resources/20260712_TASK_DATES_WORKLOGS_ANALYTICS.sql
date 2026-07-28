alter table public."PROJECTS"
add column if not exists stakeholder_id uuid;

alter table public."PROJECTS"
add column if not exists status text not null default 'ACTIVE';

update public."PROJECTS"
set status = 'ACTIVE'
where status is null;

alter table public."PROJECTS"
drop constraint if exists projects_status_check;

alter table public."PROJECTS"
add constraint projects_status_check
check (status in ('ACTIVE', 'DELETED'));

alter table public."TASKS"
add column if not exists start_date timestamptz;

alter table public."TASKS"
add column if not exists end_date date;

alter table public."TASKS"
add column if not exists close_requested_at timestamptz;

update public."TASKS"
set end_date = coalesce(end_date, current_date)
where end_date is null;

alter table public."TASKS"
alter column end_date set not null;

alter table public."TASKS"
drop constraint if exists tasks_status_check;

alter table public."TASKS"
alter column status set default 'OPEN';

update public."TASKS"
set status = 'OPEN'
where status is null
   or status not in ('OPEN', 'IN PROGRESS', 'CLOSE REQUESTED', 'CLOSED');

alter table public."TASKS"
add constraint tasks_status_check
check (status in ('OPEN', 'IN PROGRESS', 'CLOSE REQUESTED', 'CLOSED'));

create table if not exists public."TASK_COMMENTS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  commented_by uuid not null,
  comment_text text not null,
  deliverable_url text,
  parent_comment_id bigint references public."TASK_COMMENTS"(id) on delete cascade
);

alter table public."TASK_COMMENTS"
add column if not exists parent_comment_id bigint references public."TASK_COMMENTS"(id) on delete cascade;

alter table public."TASK_COMMENTS"
add column if not exists updated_at timestamptz;

alter table public."TASK_COMMENTS"
add column if not exists deleted_at timestamptz;

alter table public."TASK_COMMENTS"
add column if not exists deleted_by uuid;

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
where hours is null;

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

create table if not exists public."TASK_REMINDER_LOG" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  task_id bigint not null references public."TASKS"(id) on delete cascade,
  project_id bigint not null references public."PROJECTS"(id) on delete cascade,
  recipient_user_id uuid not null,
  recipient_email text,
  reminder_type text not null,
  sent_for_date date not null,
  status text not null default 'SENT',
  unique(task_id, recipient_user_id, reminder_type, sent_for_date)
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
  target_url text,
  read_at timestamptz
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

create index if not exists idx_projects_status
on public."PROJECTS" (status);

create index if not exists idx_projects_stakeholder_id
on public."PROJECTS" (stakeholder_id);

create index if not exists idx_tasks_project_status
on public."TASKS" (project_id, status);

create index if not exists idx_tasks_assigned_status
on public."TASKS" (assigned_to, status);

create index if not exists idx_tasks_status_end_date
on public."TASKS" (status, end_date);

create index if not exists idx_tasks_start_date
on public."TASKS" (start_date);

create index if not exists idx_tasks_end_date
on public."TASKS" (end_date);

create index if not exists idx_tasks_close_requested_at
on public."TASKS" (close_requested_at);

create index if not exists idx_task_comments_task_created
on public."TASK_COMMENTS" (task_id, created_at);

create index if not exists idx_task_comments_deleted_at
on public."TASK_COMMENTS" (deleted_at);

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

create index if not exists idx_task_access_log_created_at
on public."TASK_ACCESS_LOG" (created_at desc, task_id);

create index if not exists idx_task_reminder_log_task_date
on public."TASK_REMINDER_LOG" (task_id, sent_for_date);

create index if not exists idx_task_reminder_log_recipient_date
on public."TASK_REMINDER_LOG" (recipient_user_id, sent_for_date desc);

create index if not exists idx_notification_log_recipient_status
on public."NOTIFICATION_LOG" (recipient_user_id, status);

notify pgrst, 'reload schema';
