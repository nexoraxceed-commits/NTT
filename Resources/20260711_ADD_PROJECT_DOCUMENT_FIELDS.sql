alter table public."PROJECTS"
add column if not exists document_name text,
add column if not exists document_url text;

update public."PROJECTS"
set document_url = documents
where document_url is null
  and documents is not null;
