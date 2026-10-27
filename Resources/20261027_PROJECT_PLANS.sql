/*
  Project priority and target date, set when a project is created or edited.
  Run once in Supabase -> SQL Editor. Re-running is harmless.
*/

alter table public."PROJECTS" add column if not exists priority text;
alter table public."PROJECTS" add column if not exists target_date date;

alter table public."PROJECTS" drop constraint if exists projects_priority_check;
alter table public."PROJECTS"
add constraint projects_priority_check
check (priority is null or priority in ('HIGH', 'MEDIUM', 'LOW'));

-- Reminder emails: one row per task, per person, per day, so nobody is emailed twice.
create table if not exists public."TASK_DAILY_REMINDERS" (
  id bigint generated always as identity primary key,
  task_id bigint not null,
  recipient_email text not null,
  kind text not null,
  sent_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_at timestamptz not null default now(),
  unique (task_id, recipient_email, kind, sent_on)
);

alter table public."TASK_DAILY_REMINDERS" enable row level security;
revoke all on table public."TASK_DAILY_REMINDERS" from anon, authenticated;
alter table public."PROJECTS" enable row level security;
revoke all on table public."PROJECTS" from anon, authenticated;

-- Check: should show priority and target_date, then the new reminders table.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'PROJECTS' and column_name in ('priority', 'target_date');
select count(*) as reminder_rows from public."TASK_DAILY_REMINDERS";
