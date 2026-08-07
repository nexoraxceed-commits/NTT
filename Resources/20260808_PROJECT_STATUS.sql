alter table public."PROJECTS"
drop constraint if exists projects_status_check;

update public."PROJECTS"
set status = 'OPEN'
where status is null or upper(status) = 'ACTIVE';

alter table public."PROJECTS"
alter column status set default 'OPEN';

alter table public."PROJECTS"
add constraint projects_status_check
check (status in ('OPEN', 'CLOSED', 'DELETED'));
