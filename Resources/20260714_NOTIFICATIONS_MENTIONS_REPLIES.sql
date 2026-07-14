alter table public."NOTIFICATION_LOG"
add column if not exists target_url text;

alter table public."NOTIFICATION_LOG"
add column if not exists read_at timestamptz;

alter table public."NOTIFICATION_LOG"
alter column status set default 'UNREAD';

update public."NOTIFICATION_LOG"
set status = 'UNREAD'
where status is null
   or status = ''
   or status = 'PENDING';

alter table public."TASK_COMMENTS"
add column if not exists parent_comment_id bigint
references public."TASK_COMMENTS"(id)
on delete cascade;

create index if not exists idx_notification_log_user_status_created
on public."NOTIFICATION_LOG" (recipient_user_id, status, created_at desc);

create index if not exists idx_notification_log_source
on public."NOTIFICATION_LOG" (source_type, source_id);

create index if not exists idx_task_comments_task_created
on public."TASK_COMMENTS" (task_id, created_at);

create index if not exists idx_task_comments_parent_created
on public."TASK_COMMENTS" (parent_comment_id, created_at);

notify pgrst, 'reload schema';
