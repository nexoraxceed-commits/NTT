/*
  Gives every active junior a starter task in an "NTT onboarding" project:
  "Get started on NTT: finish onboarding and read the live projects".

  - Creates the project once (reviewers: Joy and Saumya), due in 3 days.
  - Adds every active junior to its team and gives each one task.
  - Safe to re-run: nobody gets a second project, team row or task.
  Juniors who join later get the same task automatically on their first
  sign-in (handled by the backend).

  Run once in Supabase -> SQL Editor.
*/

do $$
declare
  reviewer_main uuid;
  reviewer_second uuid;
  onboarding_project bigint;
  due date := ((now() at time zone 'Asia/Kolkata')::date + 3);
  junior record;
  new_task bigint;
begin
  select auth_uid into reviewer_main from public."REF_USERS"
  where lower(user_id) = 'b25182@astra.xlri.ac.in' and status = 'NORMAL';
  select auth_uid into reviewer_second from public."REF_USERS"
  where lower(user_id) = 'h25167@astra.xlri.ac.in' and status = 'NORMAL';

  if reviewer_main is null then
    raise exception 'Reviewer account (b25182) not found or not active.';
  end if;

  select id into onboarding_project from public."PROJECTS"
  where project_name = 'NTT onboarding' and coalesce(upper(status), 'OPEN') <> 'DELETED'
  order by id limit 1;

  if onboarding_project is null then
    insert into public."PROJECTS" (project_name, description, created_by, stakeholder_id, status, priority, target_date)
    values (
      'NTT onboarding',
      'Getting every junior set up on NTT: account, profile, phone app, and a first read of the live projects and tasks.',
      reviewer_main, reviewer_main, 'OPEN', 'HIGH', due
    )
    returning id into onboarding_project;
  end if;

  insert into public."PROJECT_TEAM" (project_id, user_id, role, status)
  values (onboarding_project, reviewer_main, 'SUPERVISOR', 'ACTIVE')
  on conflict (project_id, user_id, role) do update set status = 'ACTIVE';
  if reviewer_second is not null then
    insert into public."PROJECT_TEAM" (project_id, user_id, role, status)
    values (onboarding_project, reviewer_second, 'SUPERVISOR', 'ACTIVE')
    on conflict (project_id, user_id, role) do update set status = 'ACTIVE';
  end if;

  for junior in
    select auth_uid, user_name from public."REF_USERS"
    where upper(user_class) = 'JUNIOR' and status = 'NORMAL' and auth_uid is not null
  loop
    insert into public."PROJECT_TEAM" (project_id, user_id, role, status)
    values (onboarding_project, junior.auth_uid, 'TEAM', 'ACTIVE')
    on conflict (project_id, user_id, role) do update set status = 'ACTIVE';

    if not exists (
      select 1 from public."TASKS"
      where project_id = onboarding_project and assigned_to = junior.auth_uid
    ) then
      insert into public."TASKS" (project_id, task_title, task_details, assigned_to, created_by, status, end_date)
      values (
        onboarding_project,
        'Get started on NTT: finish onboarding and read the live projects',
        E'1. Finish the welcome in NTT and add your roll number.\n'
        '2. Install NTT on your phone and allow notifications.\n'
        '3. Open Projects and read every project you are on: what it is, the next task due and who reviews it.\n'
        '4. Open Tasks → My tasks and check your tasks and their due dates.\n'
        '5. Log the time you spent on this (Hours → 30m is fine), post a one-line update with any questions, then tap Send for review.',
        junior.auth_uid, reviewer_main, 'OPEN', due
      )
      returning id into new_task;

      insert into public."TASK_ACCESS_LOG" (task_id, project_id, actor_user_id, event_type, new_status, new_assignee_id, event_note)
      values (new_task, onboarding_project, reviewer_main, 'TASK_CREATED', 'OPEN', junior.auth_uid, 'Task was created.');
    end if;
  end loop;
end
$$;

-- Check: one row per junior with their onboarding task.
select u.user_name, u.user_id, t.id as task_id, t.status, t.end_date
from public."TASKS" t
join public."PROJECTS" p on p.id = t.project_id and p.project_name = 'NTT onboarding'
join public."REF_USERS" u on u.auth_uid = t.assigned_to
order by u.user_name;
