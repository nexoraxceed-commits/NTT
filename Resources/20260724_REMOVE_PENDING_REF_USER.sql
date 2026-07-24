/*
Remove one incomplete signup record from public."REF_USERS".

This script deliberately refuses to delete:
  - an activated record (auth_uid is not NULL);
  - a non-PENDING record; or
  - an ADMIN record.

It does not remove a user from auth.users. If the email also exists under
Supabase Authentication -> Users, remove that incomplete Auth user separately
before attempting signup again.
*/

begin;

do $$
declare
    target_email constant text := 'b25182@astra.xlri.ac.in';
    target_user public."REF_USERS"%rowtype;
begin
    select *
      into target_user
      from public."REF_USERS"
     where lower(trim("user_id")) = lower(target_email)
     for update;

    if not found then
        raise exception 'REF_USERS record not found for %.', target_email;
    end if;

    if upper(coalesce(target_user."user_class", '')) = 'ADMIN' then
        raise exception 'Refusing to delete ADMIN user %.', target_email;
    end if;

    if upper(coalesce(target_user."status", '')) <> 'PENDING' then
        raise exception
            'Refusing to delete % because status is % (expected PENDING).',
            target_email,
            target_user."status";
    end if;

    if target_user."auth_uid" is not null then
        raise exception
            'Refusing to delete % because auth_uid is populated.',
            target_email;
    end if;

    delete from public."REF_USERS"
     where "id" = target_user."id";

    raise notice 'Removed pending REF_USERS record for %.', target_email;
end
$$;

commit;
