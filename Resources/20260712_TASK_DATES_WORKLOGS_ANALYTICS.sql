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
