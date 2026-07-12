create index if not exists idx_ref_users_user_id
on public."REF_USERS" (user_id);

create index if not exists idx_ref_users_status
on public."REF_USERS" (status);

create index if not exists idx_ref_users_auth_uid
on public."REF_USERS" (auth_uid);

create index if not exists idx_project_members_user_status_project
on public."PROJECT_MEMBERS" (user_id, status, project_id);

create index if not exists idx_project_members_project_status
on public."PROJECT_MEMBERS" (project_id, status);

create index if not exists idx_projects_created_at
on public."PROJECTS" (created_at desc);

create index if not exists idx_tasks_project_created_at
on public."TASKS" (project_id, created_at desc);

create index if not exists idx_tasks_assigned_status
on public."TASKS" (assigned_to, status);

create index if not exists idx_task_comments_task_created_at
on public."TASK_COMMENTS" (task_id, created_at);
