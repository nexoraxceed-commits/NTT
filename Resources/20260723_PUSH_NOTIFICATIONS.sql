create table if not exists public."PUSH_SUBSCRIPTIONS" (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  status text not null default 'ACTIVE'
);

create index if not exists idx_push_subscriptions_user_status
on public."PUSH_SUBSCRIPTIONS" (user_id, status);

create index if not exists idx_push_subscriptions_endpoint
on public."PUSH_SUBSCRIPTIONS" (endpoint);

notify pgrst, 'reload schema';
