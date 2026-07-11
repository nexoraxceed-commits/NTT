from fastapi import HTTPException, status
from supabase import Client

from app.config import Settings
from app.constants import (
    AUTH_UID_COLUMN,
    NORMAL_STATUS,
    PROJECT_MEMBERS_TABLE,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASKS_TABLE,
)


def get_ref_user(
    supabase: Client,
    app_settings: Settings,
    email: str,
) -> dict | None:
    response = (
        supabase.table(app_settings.signup_allowed_users_table)
        .select(
            ",".join(
                (
                    app_settings.signup_allowed_users_email_column,
                    app_settings.signup_allowed_users_status_column,
                    AUTH_UID_COLUMN,
                )
            )
        )
        .eq(app_settings.signup_allowed_users_email_column, email)
        .limit(1)
        .execute()
    )
    users = getattr(response, "data", None) or []
    return users[0] if users else None


def get_active_ref_users(
    supabase: Client,
    app_settings: Settings,
) -> list[dict]:
    response = (
        supabase.table(app_settings.signup_allowed_users_table)
        .select(
            ",".join(
                (
                    app_settings.signup_allowed_users_email_column,
                    app_settings.signup_allowed_users_status_column,
                    REF_USER_NAME_COLUMN,
                    AUTH_UID_COLUMN,
                )
            )
        )
        .eq(app_settings.signup_allowed_users_status_column, NORMAL_STATUS)
        .order(app_settings.signup_allowed_users_email_column)
        .execute()
    )
    return getattr(response, "data", None) or []


def get_ref_users_by_auth_uids(
    supabase: Client,
    app_settings: Settings,
    auth_uids: list[str],
) -> dict[str, dict]:
    if not auth_uids:
        return {}

    response = (
        supabase.table(app_settings.signup_allowed_users_table)
        .select(
            ",".join(
                (
                    app_settings.signup_allowed_users_email_column,
                    REF_USER_NAME_COLUMN,
                    AUTH_UID_COLUMN,
                )
            )
        )
        .in_(AUTH_UID_COLUMN, list(set(auth_uids)))
        .execute()
    )
    users = getattr(response, "data", None) or []
    return {
        str(user.get(AUTH_UID_COLUMN)): user
        for user in users
        if user.get(AUTH_UID_COLUMN)
    }


def get_project_members(
    supabase: Client,
    project_id: int,
) -> list[dict]:
    response = (
        supabase.table(PROJECT_MEMBERS_TABLE)
        .select("project_id,user_id,role,status")
        .eq("project_id", project_id)
        .eq("status", "ACTIVE")
        .execute()
    )
    return getattr(response, "data", None) or []


def get_user_project_memberships(
    supabase: Client,
    user_id: str,
) -> list[dict]:
    response = (
        supabase.table(PROJECT_MEMBERS_TABLE)
        .select("project_id,user_id,role,status")
        .eq("user_id", user_id)
        .eq("status", "ACTIVE")
        .execute()
    )
    return getattr(response, "data", None) or []


def ensure_project_member(
    supabase: Client,
    project_id: int,
    user_id: str,
) -> None:
    response = (
        supabase.table(PROJECT_MEMBERS_TABLE)
        .select("id")
        .eq("project_id", project_id)
        .eq("user_id", user_id)
        .eq("status", "ACTIVE")
        .limit(1)
        .execute()
    )
    memberships = getattr(response, "data", None) or []
    if memberships:
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this project.",
    )


def get_project_by_id(
    supabase: Client,
    project_id: int,
) -> dict:
    response = (
        supabase.table(PROJECTS_TABLE)
        .select(
            "id,created_at,project_name,description,document_name,document_url,"
            "documents,created_by,status"
        )
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    projects = getattr(response, "data", None) or []
    if not projects:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        )

    return projects[0]


def get_task_by_id(
    supabase: Client,
    task_id: int,
) -> dict:
    response = (
        supabase.table(TASKS_TABLE)
        .select(
            "id,created_at,project_id,task_title,task_details,documents,"
            "assigned_to,created_by,status,due_date"
        )
        .eq("id", task_id)
        .limit(1)
        .execute()
    )
    tasks = getattr(response, "data", None) or []
    if not tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )

    return tasks[0]


def update_ref_user_status(
    supabase: Client,
    app_settings: Settings,
    email: str,
    new_status: str,
) -> None:
    (
        supabase.table(app_settings.signup_allowed_users_table)
        .update({app_settings.signup_allowed_users_status_column: new_status})
        .eq(app_settings.signup_allowed_users_email_column, email)
        .execute()
    )


def update_ref_user_auth_uid(
    supabase: Client,
    app_settings: Settings,
    email: str,
    auth_uid: str,
) -> None:
    (
        supabase.table(app_settings.signup_allowed_users_table)
        .update({AUTH_UID_COLUMN: auth_uid})
        .eq(app_settings.signup_allowed_users_email_column, email)
        .execute()
    )


def sync_ref_user_auth_uid(
    supabase: Client,
    app_settings: Settings,
    ref_user: dict,
    email: str,
    auth_uid: str,
) -> None:
    if ref_user.get(AUTH_UID_COLUMN) == auth_uid:
        return

    update_ref_user_auth_uid(supabase, app_settings, email, auth_uid)
