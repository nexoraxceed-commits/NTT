begin;

alter table public."REF_USERS"
drop constraint if exists ref_users_user_class_check;

alter table public."REF_USERS"
add constraint ref_users_user_class_check
check (user_class in ('ADMIN', 'SENIOR', 'JUNIOR', 'REDUNDANT_USER'));

commit;
