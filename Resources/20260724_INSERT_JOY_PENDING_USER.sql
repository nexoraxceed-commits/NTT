/*
Register Joy as a Nexora SENIOR user.

The user begins in the required onboarding state:
  status   = PENDING
  auth_uid = NULL

After this succeeds, Joy must sign up and then sign in. The first successful
sign-in changes the record to NORMAL and writes the matching Supabase Auth UID.
*/

insert into public."REF_USERS" (
    "user_id",
    "status",
    "user_name",
    "auth_uid",
    "user_class"
)
values (
    'b25182@astra.xlri.ac.in',
    'PENDING',
    'Joy',
    null,
    'SENIOR'
)
returning
    "id",
    "created_at",
    "user_id",
    "status",
    "user_name",
    "auth_uid",
    "user_class";
