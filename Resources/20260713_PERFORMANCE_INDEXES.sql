-- Performance indexes for the NTT task tracker.
-- Run this once in Supabase SQL Editor after the table migrations.

create extension if not exists pg_trgm;

create index if not exists idx_ref_users_auth_uid
on public."REF_USERS" (auth_uid);

create index if not exists idx_ref_users_status_user_id
on public."REF_USERS" (status, user_id);

create index if not exists idx_ref_users_user_id_lower
on public."REF_USERS" (lower(user_id));

create index if not exists idx_projects_created_at
on public."PROJECTS" (created_at desc, id desc);

create index if not exists idx_projects_assigned_to
on public."PROJECTS" (assigned_to);

create index if not exists idx_projects_stakeholder_id
on public."PROJECTS" (stakeholder_id);

create index if not exists idx_projects_status
on public."PROJECTS" (status);

create index if not exists idx_projects_project_name_trgm
on public."PROJECTS" using gin (project_name gin_trgm_ops);

create index if not exists idx_project_members_project_status_user
on public."PROJECT_MEMBERS" (project_id, status, user_id);

create index if not exists idx_project_members_user_status_project
on public."PROJECT_MEMBERS" (user_id, status, project_id);

create index if not exists idx_project_watchers_project_status_user
on public."PROJECT_WATCHERS" (project_id, status, user_id);

create index if not exists idx_project_watchers_user_status_project
on public."PROJECT_WATCHERS" (user_id, status, project_id);

create index if not exists idx_tasks_project_created
on public."TASKS" (project_id, created_at desc, id desc);

create index if not exists idx_tasks_created_at
on public."TASKS" (created_at desc, id desc);

create index if not exists idx_tasks_project_status
on public."TASKS" (project_id, status);

create index if not exists idx_tasks_assigned_status_end
on public."TASKS" (assigned_to, status, end_date);

create index if not exists idx_tasks_stakeholder_status
on public."TASKS" (stakeholder_id, status);

create index if not exists idx_tasks_end_date_status
on public."TASKS" (end_date, status);

create index if not exists idx_tasks_task_title_trgm
on public."TASKS" using gin (task_title gin_trgm_ops);

create index if not exists idx_task_watchers_task_status_user
on public."TASK_WATCHERS" (task_id, status, user_id);

create index if not exists idx_task_watchers_user_status_task
on public."TASK_WATCHERS" (user_id, status, task_id);

create index if not exists idx_task_comments_task_created
on public."TASK_COMMENTS" (task_id, created_at desc);

create index if not exists idx_task_comments_commented_by
on public."TASK_COMMENTS" (commented_by);

create index if not exists idx_task_work_logs_task_date
on public."TASK_WORK_LOGS" (task_id, work_date desc, created_at desc);

create index if not exists idx_task_work_logs_logged_by_date
on public."TASK_WORK_LOGS" (logged_by, work_date desc);

create index if not exists idx_task_work_logs_work_date
on public."TASK_WORK_LOGS" (work_date desc);

create index if not exists idx_task_work_logs_weekly_rollup
on public."TASK_WORK_LOGS" (work_date desc, logged_by, task_id);

create index if not exists idx_task_access_log_task_created
on public."TASK_ACCESS_LOG" (task_id, created_at desc);

create index if not exists idx_task_access_log_project_created
on public."TASK_ACCESS_LOG" (project_id, created_at desc);

create index if not exists idx_task_access_log_event_type
on public."TASK_ACCESS_LOG" (event_type);

create index if not exists idx_task_access_log_created_at
on public."TASK_ACCESS_LOG" (created_at desc, task_id);

create index if not exists idx_notification_log_recipient_status
on public."NOTIFICATION_LOG" (recipient_user_id, status);

notify pgrst, 'reload schema';
