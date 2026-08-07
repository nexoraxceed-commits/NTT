-- Nullable reporting fields: existing records remain truthful and display
-- "Not yet captured" until management supplies data.
alter table public."PROJECTS"
  add column if not exists normalized_name text,
  add column if not exists strategic_objective text,
  add column if not exists project_category text,
  add column if not exists priority_tier text,
  add column if not exists executive_sponsor_id uuid,
  add column if not exists accountable_owner_id uuid,
  add column if not exists intended_outcome text,
  add column if not exists success_measure text,
  add column if not exists beneficiary text,
  add column if not exists expected_benefit text,
  add column if not exists realized_outcome text,
  add column if not exists outcome_evidence text,
  add column if not exists health text,
  add column if not exists next_milestone text,
  add column if not exists archived_at timestamptz;

update public."PROJECTS"
set normalized_name = trim(regexp_replace(lower(project_name), '[^a-z0-9]+', ' ', 'g'))
where normalized_name is null;

create or replace function public.set_project_normalized_name()
returns trigger
language plpgsql
as $$
begin
  new.normalized_name := trim(
    regexp_replace(lower(new.project_name), '[^a-z0-9]+', ' ', 'g')
  );
  return new;
end;
$$;

drop trigger if exists trg_projects_normalized_name on public."PROJECTS";
create trigger trg_projects_normalized_name
before insert or update of project_name on public."PROJECTS"
for each row execute function public.set_project_normalized_name();

alter table public."TASKS"
  add column if not exists weekly_committed_outcome text,
  add column if not exists definition_of_done text,
  add column if not exists acceptance_owner_id uuid,
  add column if not exists priority text,
  add column if not exists original_due_date date,
  add column if not exists current_forecast_date date,
  add column if not exists blocker text,
  add column if not exists blocker_owner_id uuid,
  add column if not exists dependency text,
  add column if not exists dependency_owner_id uuid,
  add column if not exists expected_resolution_date date,
  add column if not exists next_action text,
  add column if not exists completion_evidence text,
  add column if not exists outcome_learning text,
  add column if not exists confidence_level text;

update public."TASKS"
set original_due_date = end_date,
    current_forecast_date = end_date
where original_due_date is null;

create index if not exists idx_projects_normalized_name
on public."PROJECTS" (normalized_name);

create index if not exists idx_projects_archived_at
on public."PROJECTS" (archived_at);

create index if not exists idx_tasks_status_end_date
on public."TASKS" (status, end_date);

create index if not exists idx_tasks_project_status_end_date
on public."TASKS" (project_id, status, end_date);

do $$
begin
  if to_regclass('public."TASK_ACCESS_LOG"') is not null then
    execute 'create index if not exists idx_task_access_log_task_event_created '
      'on public."TASK_ACCESS_LOG" (task_id, event_type, created_at desc)';
    execute 'create index if not exists idx_task_access_log_project_created '
      'on public."TASK_ACCESS_LOG" (project_id, created_at desc)';
  end if;
end;
$$;

notify pgrst, 'reload schema';
