from fastapi import HTTPException, status
from supabase import Client

from app.config import Settings
from app.constants import (
    ACTIVE_STATUS,
    AUTH_UID_COLUMN,
    NORMAL_STATUS,
    PROJECT_MEMBERS_TABLE,
    PROJECT_WATCHERS_TABLE,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASK_WATCHERS_TABLE,
    TASK_WORK_LOGS_TABLE,
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


def get_ref_users_by_emails(
    supabase: Client,
    app_settings: Settings,
    emails: list[str],
) -> dict[str, dict]:
    normalized_emails = sorted(
        {email.strip().lower() for email in emails if email and email.strip()}
    )
    if not normalized_emails:
        return {}

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
        .in_(app_settings.signup_allowed_users_email_column, normalized_emails)
        .execute()
    )
    users = getattr(response, "data", None) or []
    return {
        str(user.get(app_settings.signup_allowed_users_email_column)).lower(): user
        for user in users
        if user.get(app_settings.signup_allowed_users_email_column)
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


def get_project_members_for_projects(
    supabase: Client,
    project_ids: list[int],
) -> dict[int, list[dict]]:
    if not project_ids:
        return {}

    response = (
        supabase.table(PROJECT_MEMBERS_TABLE)
        .select("project_id,user_id,role,status")
        .in_("project_id", list(set(project_ids)))
        .eq("status", "ACTIVE")
        .execute()
    )
    members = getattr(response, "data", None) or []
    members_by_project: dict[int, list[dict]] = {
        int(project_id): [] for project_id in project_ids
    }

    for member in members:
        project_id = member.get("project_id")
        if project_id is None:
            continue

        members_by_project.setdefault(int(project_id), []).append(member)

    return members_by_project


def get_project_watchers(
    supabase: Client,
    project_id: int,
) -> list[dict]:
    response = (
        supabase.table(PROJECT_WATCHERS_TABLE)
        .select("project_id,user_id,status")
        .eq("project_id", project_id)
        .eq("status", ACTIVE_STATUS)
        .execute()
    )
    return getattr(response, "data", None) or []


def get_project_watchers_for_projects(
    supabase: Client,
    project_ids: list[int],
) -> dict[int, list[dict]]:
    if not project_ids:
        return {}

    response = (
        supabase.table(PROJECT_WATCHERS_TABLE)
        .select("project_id,user_id,status")
        .in_("project_id", list(set(project_ids)))
        .eq("status", ACTIVE_STATUS)
        .execute()
    )
    watchers = getattr(response, "data", None) or []
    watchers_by_project: dict[int, list[dict]] = {
        int(project_id): [] for project_id in project_ids
    }
    for watcher in watchers:
        project_id = watcher.get("project_id")
        if project_id is None:
            continue
        watchers_by_project.setdefault(int(project_id), []).append(watcher)

    return watchers_by_project


def replace_project_watchers(
    supabase: Client,
    project_id: int,
    watcher_user_ids: list[str],
) -> None:
    supabase.table(PROJECT_WATCHERS_TABLE).delete().eq("project_id", project_id).execute()
    rows = [
        {"project_id": project_id, "user_id": user_id, "status": ACTIVE_STATUS}
        for user_id in sorted(set(watcher_user_ids))
    ]
    if rows:
        supabase.table(PROJECT_WATCHERS_TABLE).insert(rows).execute()


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


def get_user_project_watchlist(
    supabase: Client,
    user_id: str,
) -> list[dict]:
    response = (
        supabase.table(PROJECT_WATCHERS_TABLE)
        .select("project_id,user_id,status")
        .eq("user_id", user_id)
        .eq("status", ACTIVE_STATUS)
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
            "documents,created_by,status,assigned_to,stakeholder_id"
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
            "assigned_to,stakeholder_id,created_by,status,due_date,start_date,end_date"
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


def get_task_watchers(
    supabase: Client,
    task_id: int,
) -> list[dict]:
    response = (
        supabase.table(TASK_WATCHERS_TABLE)
        .select("task_id,user_id,status")
        .eq("task_id", task_id)
        .eq("status", ACTIVE_STATUS)
        .execute()
    )
    return getattr(response, "data", None) or []


def get_task_watchers_for_tasks(
    supabase: Client,
    task_ids: list[int],
) -> dict[int, list[dict]]:
    if not task_ids:
        return {}

    response = (
        supabase.table(TASK_WATCHERS_TABLE)
        .select("task_id,user_id,status")
        .in_("task_id", list(set(task_ids)))
        .eq("status", ACTIVE_STATUS)
        .execute()
    )
    watchers = getattr(response, "data", None) or []
    watchers_by_task: dict[int, list[dict]] = {int(task_id): [] for task_id in task_ids}
    for watcher in watchers:
        task_id = watcher.get("task_id")
        if task_id is None:
            continue
        watchers_by_task.setdefault(int(task_id), []).append(watcher)

    return watchers_by_task


def replace_task_watchers(
    supabase: Client,
    task_id: int,
    watcher_user_ids: list[str],
) -> None:
    supabase.table(TASK_WATCHERS_TABLE).delete().eq("task_id", task_id).execute()
    rows = [
        {"task_id": task_id, "user_id": user_id, "status": ACTIVE_STATUS}
        for user_id in sorted(set(watcher_user_ids))
    ]
    if rows:
        supabase.table(TASK_WATCHERS_TABLE).insert(rows).execute()


def get_task_work_logs(
    supabase: Client,
    task_id: int,
) -> list[dict]:
    response = (
        supabase.table(TASK_WORK_LOGS_TABLE)
        .select("id,created_at,task_id,logged_by,work_date,hours,work_note")
        .eq("task_id", task_id)
        .order("work_date", desc=True)
        .order("created_at", desc=True)
        .execute()
    )
    return getattr(response, "data", None) or []


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
