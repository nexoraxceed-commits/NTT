from fastapi import HTTPException, status
from supabase import Client

from app.config import Settings
from app.constants import (
    ACTIVE_STATUS,
    AUTH_UID_COLUMN,
    NOTIFICATION_LOG_TABLE,
    NOTIFICATION_STATUS_READ,
    NORMAL_STATUS,
    PROJECT_WATCHERS_TABLE,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASK_ACCESS_LOG_TABLE,
    TASK_WORK_LOGS_TABLE,
    TASKS_TABLE,
)


def is_optional_analytics_table_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "task_work_logs" in message
        or "task_access_log" in message
        or "notification_log" in message
        or "description" in message
        or "parent_comment_id" in message
        or "target_url" in message
        or "read_at" in message
        or "schema cache" in message
        or "could not find" in message
        or "does not exist" in message
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


def get_project_by_id(
    supabase: Client,
    project_id: int,
) -> dict:
    try:
        response = (
            supabase.table(PROJECTS_TABLE)
            .select(
                "id,created_at,project_name,description,document_name,document_url,"
                "documents,created_by,status,stakeholder_id"
            )
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if not is_optional_analytics_table_error(exc):
            raise
        response = (
            supabase.table(PROJECTS_TABLE)
            .select(
                "id,created_at,project_name,description,documents,created_by,status"
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
    try:
        response = (
            supabase.table(TASKS_TABLE)
            .select(
                "id,created_at,project_id,task_title,task_details,documents,"
                "assigned_to,created_by,status,due_date,start_date,end_date"
            )
            .eq("id", task_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if not is_optional_analytics_table_error(exc):
            raise
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


def get_task_work_logs(
    supabase: Client,
    task_id: int,
) -> list[dict]:
    try:
        response = (
            supabase.table(TASK_WORK_LOGS_TABLE)
            .select("id,created_at,task_id,logged_by,work_date,hours,work_note")
            .eq("task_id", task_id)
            .order("work_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return []
        raise

    return getattr(response, "data", None) or []


def get_task_work_logs_for_tasks(
    supabase: Client,
    task_ids: list[int],
) -> dict[int, list[dict]]:
    if not task_ids:
        return {}

    try:
        response = (
            supabase.table(TASK_WORK_LOGS_TABLE)
            .select("id,created_at,task_id,logged_by,work_date,hours,work_note")
            .in_("task_id", task_ids)
            .order("work_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return {}
        raise

    logs_by_task: dict[int, list[dict]] = {}
    for work_log in getattr(response, "data", None) or []:
        task_id = work_log.get("task_id")
        if task_id is None:
            continue
        logs_by_task.setdefault(int(task_id), []).append(work_log)

    return logs_by_task


def insert_task_access_log(
    supabase: Client,
    *,
    task_id: int,
    project_id: int,
    actor_user_id: str | None,
    event_type: str,
    previous_status: str | None = None,
    new_status: str | None = None,
    previous_assignee_id: str | None = None,
    new_assignee_id: str | None = None,
    event_note: str | None = None,
) -> None:
    try:
        supabase.table(TASK_ACCESS_LOG_TABLE).insert(
            {
                "task_id": task_id,
                "project_id": project_id,
                "actor_user_id": actor_user_id,
                "event_type": event_type,
                "previous_status": previous_status,
                "new_status": new_status,
                "previous_assignee_id": previous_assignee_id,
                "new_assignee_id": new_assignee_id,
                "event_note": event_note,
            }
        ).execute()
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return
        raise


def get_task_access_logs_for_tasks(
    supabase: Client,
    task_ids: list[int],
) -> dict[int, list[dict]]:
    if not task_ids:
        return {}

    try:
        response = (
            supabase.table(TASK_ACCESS_LOG_TABLE)
            .select(
                "id,created_at,task_id,project_id,actor_user_id,event_type,event_note,"
                "previous_status,new_status,previous_assignee_id,new_assignee_id"
            )
            .in_("task_id", task_ids)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return {}
        raise

    logs_by_task: dict[int, list[dict]] = {}
    for access_log in getattr(response, "data", None) or []:
        task_id = access_log.get("task_id")
        if task_id is None:
            continue
        logs_by_task.setdefault(int(task_id), []).append(access_log)

    return logs_by_task


def delete_task_access_logs(supabase: Client) -> None:
    try:
        supabase.table(TASK_ACCESS_LOG_TABLE).delete().neq("id", 0).execute()
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return
        raise


def get_notifications_for_user(
    supabase: Client,
    user_id: str,
) -> list[dict]:
    try:
        response = (
            supabase.table(NOTIFICATION_LOG_TABLE)
            .select(
                "id,created_at,recipient_user_id,recipient_email,subject,body,description,"
                "status,source_type,source_id,target_url,read_at"
            )
            .eq("recipient_user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return []
        raise

    return getattr(response, "data", None) or []


def count_unread_notifications_for_user(
    supabase: Client,
    user_id: str,
) -> int:
    try:
        response = (
            supabase.table(NOTIFICATION_LOG_TABLE)
            .select("id", count="exact")
            .eq("recipient_user_id", user_id)
            .neq("status", NOTIFICATION_STATUS_READ)
            .limit(1)
            .execute()
        )
        if getattr(response, "count", None) is not None:
            return int(response.count)
    except TypeError:
        pass
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return 0
        raise

    try:
        response = (
            supabase.table(NOTIFICATION_LOG_TABLE)
            .select("id")
            .eq("recipient_user_id", user_id)
            .neq("status", NOTIFICATION_STATUS_READ)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return 0
        raise

    return len(getattr(response, "data", None) or [])


def mark_notification_read(
    supabase: Client,
    notification_id: int,
    user_id: str,
    read_at: str,
) -> dict | None:
    try:
        response = (
            supabase.table(NOTIFICATION_LOG_TABLE)
            .update({"status": NOTIFICATION_STATUS_READ, "read_at": read_at})
            .eq("id", notification_id)
            .eq("recipient_user_id", user_id)
            .execute()
        )
    except Exception as exc:
        if is_optional_analytics_table_error(exc):
            return None
        raise

    notifications = getattr(response, "data", None) or []
    return notifications[0] if notifications else None


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
