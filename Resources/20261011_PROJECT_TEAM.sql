/*
  Project team and supervisors (October 2026 redesign).

  Run once in Supabase: SQL Editor -> New query -> paste -> Run.
  Safe to run twice. It only adds a table and indexes, and copies existing
  stakeholders in as supervisors. Nothing is deleted.

  PROJECT_TEAM holds who works on each project:
    SUPERVISOR - seniors who review and close the project's tasks
    TEAM       - people who work on the project (usually juniors)
  Watchers stay in PROJECT_WATCHERS as before.
*/

create table if not exists public."PROJECT_TEAM" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  project_id bigint not null references public."PROJECTS"(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('TEAM', 'SUPERVISOR')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  unique (project_id, user_id, role)
);

create index if not exists project_team_project_status_idx
on public."PROJECT_TEAM" (project_id, status);

create index if not exists project_team_user_status_idx
on public."PROJECT_TEAM" (user_id, status);

-- The backend uses the service key; keep the table closed to browser clients.
alter table public."PROJECT_TEAM" enable row level security;

-- Every existing project's stakeholder becomes its first supervisor.
insert into public."PROJECT_TEAM" (project_id, user_id, role)
select p.id, p.stakeholder_id, 'SUPERVISOR'
from public."PROJECTS" p
where p.stakeholder_id is not null
on conflict (project_id, user_id, role) do nothing;

-- Everyone currently assigned a task in a project joins that project's team.
insert into public."PROJECT_TEAM" (project_id, user_id, role)
select distinct t.project_id, t.assigned_to, 'TEAM'
from public."TASKS" t
where t.assigned_to is not null
  and not exists (
    select 1 from public."PROJECT_TEAM" pt
    where pt.project_id = t.project_id
      and pt.user_id = t.assigned_to
      and pt.role = 'SUPERVISOR'
  )
on conflict (project_id, user_id, role) do nothing;

-- Faster dashboard: work logs and history are read newest first per task.
create index if not exists task_work_logs_task_date_idx
on public."TASK_WORK_LOGS" (task_id, work_date desc);
