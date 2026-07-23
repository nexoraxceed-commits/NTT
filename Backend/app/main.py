import json
import re
import time
from datetime import date, datetime, timezone

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from supabase import Client

from app.cache import backend_cache
from app.board_report import build_board_report
from app.config import Settings, get_settings
from app.constants import (
    ASSIGNABLE_USER_CLASSES,
    AUTH_UID_COLUMN,
    MANAGEMENT_USER_CLASSES,
    NORMAL_STATUS,
    PENDING_STATUS,
    NOTIFICATION_LOG_TABLE,
    NOTIFICATION_STATUS_READ,
    NOTIFICATION_STATUS_UNREAD,
    PROJECT_WATCHERS_TABLE,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASK_COMMENTS_TABLE,
    TASK_STATUS_CLOSED,
    TASK_STATUS_CLOSE_REQUESTED,
    TASK_STATUS_IN_PROGRESS,
    TASK_STATUS_OPEN,
    TASK_WORK_LOGS_TABLE,
    TASKS_TABLE,
    USER_CLASS_ADMIN,
    USER_CLASS_COLUMN,
    USER_CLASS_JUNIOR,
    USER_CLASS_SENIOR,
)
from app.dependencies import CurrentUser, get_current_user, require_admin
from app.mappers import build_watcher_responses
from app.repositories import (
    activate_ref_user,
    count_unread_notifications_for_user,
    delete_push_subscription_by_endpoint,
    delete_task_access_logs,
    get_active_push_subscriptions_for_users,
    get_active_ref_users,
    get_all_ref_users,
    get_notifications_for_user,
    get_project_by_id,
    get_project_watchers,
    get_project_watchers_for_projects,
    get_ref_user,
    get_ref_users_by_emails,
    get_ref_users_by_auth_uids,
    get_task_access_logs_for_tasks,
    get_task_by_id,
    get_task_work_logs,
    get_task_work_logs_for_tasks,
    insert_task_access_log,
    insert_pending_ref_user,
    is_optional_analytics_table_error,
    mark_all_notifications_read,
    mark_notification_read,
    replace_project_watchers,
    sync_ref_user_auth_uid,
    update_ref_user_class,
    upsert_push_subscription,
)
from app.schemas import (
    AdminCreateUserRequest,
    AdminUpdateUserClassRequest,
    AdminUserResponse,
    CreateTaskCommentRequest,
    CreateTaskWorkLogRequest,
    CreateProjectRequest,
    CreateTaskRequest,
    CurrentUserResponse,
    ErrorResponse,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MessageResponse,
    NotificationCountResponse,
    NotificationResponse,
    ProjectDetailResponse,
    ProjectSummaryResponse,
    ProjectUserResponse,
    PushConfigResponse,
    PushSubscriptionRequest,
    RefreshSessionRequest,
    SignupRequest,
    TaskAccessLogResponse,
    TaskCommentResponse,
    TaskDetailResponse,
    TaskSummaryResponse,
    TaskWorkLogResponse,
    UpdateProjectRequest,
    UpdateTaskRequest,
    UpdateTaskStatusRequest,
)
from app.supabase_client import get_supabase_admin_client, get_supabase_client
from app.utils import normalize_optional_text


def normalize_email_list(emails: list[str]) -> list[str]:
    return sorted({email.strip().lower() for email in emails if email and email.strip()})


def parse_iso_date(value: str, field_name: str) -> str:
    try:
        parsed_date = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must use YYYY-MM-DD format.",
        ) from exc

    return parsed_date.isoformat()


def parse_iso_date_value(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must use YYYY-MM-DD format.",
        ) from exc


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def enforce_rate_limit(
    action: str,
    identifier: str,
    *,
    limit: int,
    window_seconds: int,
) -> None:
    normalized_identifier = re.sub(r"[^a-zA-Z0-9_.:@-]", "_", identifier.lower())
    cache_key = f"rate:{action}:{normalized_identifier}"
    value = backend_cache.get(cache_key) or {
        "count": 0,
        "window_started_at": time.time(),
    }
    if int(value.get("count", 0)) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please wait a moment and try again.",
        )

    value["count"] = int(value.get("count", 0)) + 1
    backend_cache.set(cache_key, value, window_seconds)


def get_cached_command_response(
    command_name: str,
    user_id: object,
    idempotency_key: str | None,
) -> MessageResponse | None:
    normalized_key = normalize_optional_text(idempotency_key)
    if not normalized_key:
        return None

    cache_key = f"idempotency:{command_name}:{user_id}:{normalized_key}"
    cached_response = backend_cache.get(cache_key)
    if cached_response is None:
        return None

    return MessageResponse(**cached_response)


def cache_command_response(
    command_name: str,
    user_id: object,
    idempotency_key: str | None,
    response: MessageResponse,
) -> None:
    normalized_key = normalize_optional_text(idempotency_key)
    if not normalized_key:
        return

    cache_key = f"idempotency:{command_name}:{user_id}:{normalized_key}"
    backend_cache.set(cache_key, response.model_dump(), 3600)


def project_watcher_user_ids(watchers: list[dict]) -> list[str]:
    return [
        str(watcher["user_id"])
        for watcher in watchers
        if watcher.get("user_id")
    ]


def is_project_stakeholder(project: dict, user_id: object) -> bool:
    return bool(project.get("stakeholder_id")) and str(project.get("stakeholder_id")) == str(
        user_id
    )


def task_with_project_roles(task: dict, project: dict) -> dict:
    return {**task, "stakeholder_id": project.get("stakeholder_id")}


def inherited_task_watchers_by_task(
    tasks: list[dict],
    project_watchers_by_project: dict[int, list[dict]],
) -> dict[int, list[dict]]:
    return {
        int(task["id"]): project_watchers_by_project.get(int(task["project_id"]), [])
        for task in tasks
    }


def can_change_task_assignee(project: dict, task: dict, user_id: object) -> bool:
    return is_project_stakeholder(project, user_id) or (
        bool(task.get("assigned_to")) and str(task.get("assigned_to")) == str(user_id)
    )


def require_active_ref_user(
    supabase_admin: Client,
    app_settings: Settings,
    email: str,
    field_name: str,
    allowed_user_classes: set[str] | None = None,
) -> dict:
    ref_user = get_ref_user(supabase_admin, app_settings, email.strip().lower())
    if not ref_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected {field_name} is not registered.",
        )

    current_status = str(
        ref_user.get(app_settings.signup_allowed_users_status_column) or ""
    ).upper()
    if current_status != NORMAL_STATUS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected {field_name} is not active.",
        )

    if not ref_user.get(AUTH_UID_COLUMN):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected {field_name} must sign in once before assignment.",
        )

    user_class = str(ref_user.get(USER_CLASS_COLUMN) or "").upper()
    if allowed_user_classes is not None and user_class not in allowed_user_classes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected {field_name} does not have an eligible user class.",
        )

    return ref_user


def resolve_active_user_ids(
    supabase_admin: Client,
    app_settings: Settings,
    emails: list[str],
    field_name: str,
    allowed_user_classes: set[str] | None = None,
) -> list[str]:
    normalized_emails = normalize_email_list(emails)
    if not normalized_emails:
        return []

    ref_users = get_ref_users_by_emails(supabase_admin, app_settings, normalized_emails)
    user_ids: list[str] = []
    invalid_emails: list[str] = []
    for email in normalized_emails:
        ref_user = ref_users.get(email)
        current_status = str(
            (ref_user or {}).get(app_settings.signup_allowed_users_status_column) or ""
        ).upper()
        auth_uid = (ref_user or {}).get(AUTH_UID_COLUMN)
        user_class = str((ref_user or {}).get(USER_CLASS_COLUMN) or "").upper()
        if (
            current_status != NORMAL_STATUS
            or not auth_uid
            or (
                allowed_user_classes is not None
                and user_class not in allowed_user_classes
            )
        ):
            invalid_emails.append(email)
            continue

        user_ids.append(str(auth_uid))

    if invalid_emails:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"These {field_name} users must be active, signed in, and eligible: "
                f"{', '.join(invalid_emails)}"
            ),
        )

    return user_ids


def require_management_user(current_user: CurrentUser) -> None:
    if current_user.user_class not in MANAGEMENT_USER_CLASSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Junior users can only participate as task assignees.",
        )


def invalidate_user_cache() -> None:
    backend_cache.delete("users:active")


def invalidate_notification_cache(user_ids: set[str] | list[str] | None = None) -> None:
    if not user_ids:
        backend_cache.delete_prefix("notifications:")
        return

    for user_id in {str(value) for value in user_ids if value}:
        backend_cache.delete(f"notifications:list:{user_id}")
        backend_cache.delete(f"notifications:unread:{user_id}")


def invalidate_project_cache(project_id: int | None = None) -> None:
    backend_cache.delete_prefix("projects:list:")
    backend_cache.delete_prefix("dashboard:data:")
    backend_cache.delete_prefix("tasks:detail:")
    if project_id is None:
        backend_cache.delete_prefix("projects:detail:")
        return

    backend_cache.delete_prefix(f"projects:detail:{project_id}:")


def invalidate_task_cache(
    task_id: int | None = None,
    project_id: int | None = None,
) -> None:
    backend_cache.delete_prefix("dashboard:data:")
    if project_id is not None:
        backend_cache.delete_prefix(f"projects:detail:{project_id}:")
    else:
        backend_cache.delete_prefix("projects:detail:")

    if task_id is not None:
        backend_cache.delete(f"tasks:detail:{task_id}")
    else:
        backend_cache.delete_prefix("tasks:detail:")


def is_push_configured(app_settings: Settings) -> bool:
    return bool(app_settings.vapid_public_key and app_settings.vapid_private_key)


def notification_push_payload(
    *,
    notification_id: int | None,
    subject: str,
    body: str,
    source_type: str,
    source_id: int,
    target_url: str | None,
) -> dict:
    return {
        "notification_id": notification_id,
        "title": subject,
        "body": body or "Open Nexora for details.",
        "source_type": source_type,
        "source_id": source_id,
        "target_url": target_url or "/notifications",
        "tag": f"{source_type}:{source_id}:{notification_id or 'new'}",
        "icon": "/icons/icon-192.png?v=20260723-push-app",
        "badge": "/icons/icon-192.png?v=20260723-push-app",
    }


def send_push_notifications(
    supabase_admin: Client,
    app_settings: Settings,
    notification_rows: list[dict],
    *,
    subject: str,
    body: str,
    source_type: str,
    source_id: int,
    target_url: str | None,
) -> None:
    if not is_push_configured(app_settings) or not notification_rows:
        return

    recipient_user_ids = [
        str(row.get("recipient_user_id"))
        for row in notification_rows
        if row.get("recipient_user_id")
    ]
    subscriptions = get_active_push_subscriptions_for_users(
        supabase_admin,
        recipient_user_ids,
    )
    if not subscriptions:
        return

    notification_by_user_id = {
        str(row.get("recipient_user_id")): row
        for row in notification_rows
        if row.get("recipient_user_id")
    }

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return

    vapid_claims = {"sub": app_settings.vapid_subject}
    for subscription in subscriptions:
        user_id = str(subscription.get("user_id") or "")
        notification = notification_by_user_id.get(user_id, {})
        payload = notification_push_payload(
            notification_id=notification.get("id"),
            subject=subject,
            body=body,
            source_type=source_type,
            source_id=source_id,
            target_url=target_url,
        )

        endpoint = subscription.get("endpoint")
        try:
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {
                        "p256dh": subscription.get("p256dh"),
                        "auth": subscription.get("auth"),
                    },
                },
                data=json.dumps(payload),
                vapid_private_key=app_settings.vapid_private_key,
                vapid_claims=vapid_claims,
            )
        except WebPushException as exc:
            response = getattr(exc, "response", None)
            if getattr(response, "status_code", None) in {404, 410}:
                delete_push_subscription_by_endpoint(
                    supabase_admin,
                    str(endpoint or ""),
                )
        except Exception:
            continue


def queue_notification_log(
    supabase_admin: Client,
    recipients: list[dict],
    subject: str,
    body: str,
    source_type: str,
    source_id: int,
    app_settings: Settings,
    target_url: str | None = None,
) -> None:
    rows = []
    seen_user_ids: set[str] = set()
    for recipient in recipients:
        user_id = recipient.get(AUTH_UID_COLUMN)
        if not user_id or str(user_id) in seen_user_ids:
            continue

        seen_user_ids.add(str(user_id))
        rows.append(
            {
                "recipient_user_id": user_id,
                "recipient_email": recipient.get(
                    app_settings.signup_allowed_users_email_column
                ),
                "subject": subject,
                "body": body,
                "description": body,
                "status": NOTIFICATION_STATUS_UNREAD,
                "source_type": source_type,
                "source_id": source_id,
                "target_url": target_url,
                "read_at": None,
            }
        )

    if rows:
        notification_rows = rows
        try:
            response = supabase_admin.table(NOTIFICATION_LOG_TABLE).insert(rows).execute()
            notification_rows = getattr(response, "data", None) or rows
        except Exception as exc:
            if not is_optional_analytics_table_error(exc):
                return

            fallback_rows = []
            for row in rows:
                fallback_row = {
                    key: value
                    for key, value in row.items()
                    if key not in {"description", "target_url", "read_at"}
                }
                fallback_row["status"] = NOTIFICATION_STATUS_UNREAD
                fallback_rows.append(fallback_row)

            try:
                response = supabase_admin.table(NOTIFICATION_LOG_TABLE).insert(
                    fallback_rows
                ).execute()
                notification_rows = getattr(response, "data", None) or fallback_rows
            except Exception as fallback_exc:
                if is_optional_analytics_table_error(fallback_exc):
                    return
                return
        send_push_notifications(
            supabase_admin,
            app_settings,
            notification_rows,
            subject=subject,
            body=body,
            source_type=source_type,
            source_id=source_id,
            target_url=target_url,
        )

    invalidate_notification_cache(seen_user_ids)


def get_task_target_url(task_id: int) -> str:
    return f"/task?id={task_id}"


def get_project_target_url(project_id: int) -> str:
    return f"/project?id={project_id}"


def rows_for_user_ids(
    supabase_admin: Client,
    app_settings: Settings,
    user_ids: list[str],
) -> list[dict]:
    return list(
        get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            [str(user_id) for user_id in user_ids if user_id],
        ).values()
    )


def get_ref_user_display_name(ref_user: dict | None, app_settings: Settings) -> str:
    if not ref_user:
        return "Someone"

    return (
        normalize_optional_text(ref_user.get(REF_USER_NAME_COLUMN))
        or normalize_optional_text(
            ref_user.get(app_settings.signup_allowed_users_email_column)
        )
        or "Someone"
    )


def get_actor_display_name(
    supabase_admin: Client,
    app_settings: Settings,
    user_id: object,
) -> str:
    rows = rows_for_user_ids(supabase_admin, app_settings, [str(user_id)])
    return get_ref_user_display_name(rows[0] if rows else None, app_settings)


def notify_user_ids(
    supabase_admin: Client,
    app_settings: Settings,
    user_ids: list[str],
    subject: str,
    body: str,
    source_type: str,
    source_id: int,
    target_url: str | None = None,
    exclude_user_ids: set[str] | None = None,
) -> set[str]:
    excluded_ids = exclude_user_ids or set()
    recipient_ids = []
    seen_ids: set[str] = set()
    for user_id in user_ids:
        if not user_id:
            continue
        normalized_id = str(user_id)
        if normalized_id in seen_ids or normalized_id in excluded_ids:
            continue
        seen_ids.add(normalized_id)
        recipient_ids.append(normalized_id)

    if not recipient_ids:
        return set()

    queue_notification_log(
        supabase_admin,
        rows_for_user_ids(supabase_admin, app_settings, recipient_ids),
        subject,
        body,
        source_type,
        source_id,
        app_settings,
        target_url=target_url,
    )
    return set(recipient_ids)


def notify_task_roles(
    supabase_admin: Client,
    app_settings: Settings,
    task_name: str,
    task_id: int,
    assigned_user_id: object | None = None,
    stakeholder_user_id: object | None = None,
    watcher_user_ids: list[str] | None = None,
    exclude_user_ids: set[str] | None = None,
) -> None:
    notified_ids = set(exclude_user_ids or set())
    target_url = get_task_target_url(task_id)
    if assigned_user_id:
        notified_ids.update(
            notify_user_ids(
                supabase_admin,
                app_settings,
                [str(assigned_user_id)],
                f"You have been assigned {task_name}",
                f'You are the assignee for task "{task_name}".',
                "TASK",
                task_id,
                target_url=target_url,
                exclude_user_ids=notified_ids,
            )
        )

    if stakeholder_user_id:
        notified_ids.update(
            notify_user_ids(
                supabase_admin,
                app_settings,
                [str(stakeholder_user_id)],
                f"You are stakeholder of {task_name}",
                f'You are the stakeholder for task "{task_name}".',
                "TASK",
                task_id,
                target_url=target_url,
                exclude_user_ids=notified_ids,
            )
        )

    notify_user_ids(
        supabase_admin,
        app_settings,
        watcher_user_ids or [],
        f"You are watching {task_name}",
        f'You will receive updates for task "{task_name}".',
        "TASK",
        task_id,
        target_url=target_url,
        exclude_user_ids=notified_ids,
    )


def notify_project_roles(
    supabase_admin: Client,
    app_settings: Settings,
    project_name: str,
    project_id: int,
    stakeholder_user_id: object | None = None,
    watcher_user_ids: list[str] | None = None,
    exclude_user_ids: set[str] | None = None,
) -> None:
    notified_ids = set(exclude_user_ids or set())
    target_url = get_project_target_url(project_id)

    if stakeholder_user_id:
        notified_ids.update(
            notify_user_ids(
                supabase_admin,
                app_settings,
                [str(stakeholder_user_id)],
                f"You are stakeholder of {project_name}",
                f'You are the stakeholder for project "{project_name}".',
                "PROJECT",
                project_id,
                target_url=target_url,
                exclude_user_ids=notified_ids,
            )
        )

    notify_user_ids(
        supabase_admin,
        app_settings,
        watcher_user_ids or [],
        f"You are watching {project_name}",
        f'You will receive updates for project "{project_name}".',
        "PROJECT",
        project_id,
        target_url=target_url,
        exclude_user_ids=notified_ids,
    )


def extract_mentioned_user_ids(
    comment_text: str,
    active_users: list[dict],
    app_settings: Settings,
) -> list[str]:
    text = comment_text or ""
    if not text.strip():
        return []

    normalized_text = text.lower()
    email_matches = {
        match.group(0).lower()
        for match in re.finditer(
            r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}",
            text,
        )
    }
    mention_tokens = {
        match.group(1).strip().lower()
        for match in re.finditer(r"@([A-Za-z0-9._%+-]+)", text)
    }

    mentioned_user_ids: list[str] = []
    for active_user in active_users:
        auth_uid = active_user.get(AUTH_UID_COLUMN)
        if not auth_uid:
            continue

        email = str(
            active_user.get(app_settings.signup_allowed_users_email_column) or ""
        ).strip().lower()
        name = str(active_user.get(REF_USER_NAME_COLUMN) or "").strip().lower()
        compact_name = re.sub(r"[^a-z0-9]", "", name)
        local_part = email.split("@", 1)[0] if email else ""
        mention_candidates = {
            email,
            local_part,
            name,
            compact_name,
        }

        if email and email in normalized_text:
            mentioned_user_ids.append(str(auth_uid))
            continue

        if email and email in email_matches:
            mentioned_user_ids.append(str(auth_uid))
            continue

        if mention_tokens.intersection({candidate for candidate in mention_candidates if candidate}):
            mentioned_user_ids.append(str(auth_uid))

    return sorted(set(mentioned_user_ids))


def is_project_editor(project: dict, watchers: list[dict], user_id: str) -> bool:
    if is_project_stakeholder(project, user_id):
        return True

    return any(str(watcher.get("user_id")) == str(user_id) for watcher in watchers)


def build_task_access_log_responses(
    access_logs: list[dict],
    users_by_auth_uid: dict[str, dict],
    app_settings: Settings,
) -> list[TaskAccessLogResponse]:
    return [
        TaskAccessLogResponse(
            id=access_log["id"],
            event_type=access_log.get("event_type") or "",
            event_note=access_log.get("event_note"),
            previous_status=access_log.get("previous_status"),
            new_status=access_log.get("new_status"),
            previous_assignee_email=users_by_auth_uid.get(
                str(access_log.get("previous_assignee_id")), {}
            ).get(app_settings.signup_allowed_users_email_column),
            previous_assignee_name=users_by_auth_uid.get(
                str(access_log.get("previous_assignee_id")), {}
            ).get(REF_USER_NAME_COLUMN),
            new_assignee_email=users_by_auth_uid.get(
                str(access_log.get("new_assignee_id")), {}
            ).get(app_settings.signup_allowed_users_email_column),
            new_assignee_name=users_by_auth_uid.get(
                str(access_log.get("new_assignee_id")), {}
            ).get(REF_USER_NAME_COLUMN),
            actor_email=users_by_auth_uid.get(
                str(access_log.get("actor_user_id")), {}
            ).get(app_settings.signup_allowed_users_email_column),
            actor_name=users_by_auth_uid.get(str(access_log.get("actor_user_id")), {}).get(
                REF_USER_NAME_COLUMN
            ),
            created_at=access_log.get("created_at"),
        )
        for access_log in access_logs
    ]


def parse_event_datetime(value: object) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def build_task_access_log_description(access_log: dict | None) -> str | None:
    if not access_log:
        return None

    event_note = normalize_optional_text(access_log.get("event_note"))
    if event_note:
        return event_note

    previous_status = normalize_optional_text(access_log.get("previous_status"))
    new_status = normalize_optional_text(access_log.get("new_status"))
    if previous_status and new_status and previous_status != new_status:
        return f"Status changed from {previous_status} to {new_status}."

    previous_assignee = normalize_optional_text(access_log.get("previous_assignee_id"))
    new_assignee = normalize_optional_text(access_log.get("new_assignee_id"))
    if previous_assignee != new_assignee:
        return "Task assignee changed."

    event_type = normalize_optional_text(access_log.get("event_type"))
    if event_type:
        return f"{event_type.replace('_', ' ').title()}."

    return None


def find_nearest_task_access_log(
    notification: dict,
    access_logs: list[dict],
) -> dict | None:
    if not access_logs:
        return None

    notification_created_at = parse_event_datetime(notification.get("created_at"))
    if notification_created_at is None:
        return access_logs[0]

    return min(
        access_logs,
        key=lambda access_log: abs(
            (
                parse_event_datetime(access_log.get("created_at"))
                or notification_created_at
            )
            - notification_created_at
        ).total_seconds(),
    )


def build_notification_description(
    notification: dict,
    task_access_logs_by_task: dict[int, list[dict]],
) -> str | None:
    description = normalize_optional_text(notification.get("description"))
    if description:
        return description

    body = normalize_optional_text(notification.get("body"))
    if body:
        return body

    source_type = str(notification.get("source_type") or "").upper()
    if source_type == "TASK" and notification.get("source_id") is not None:
        try:
            task_id = int(notification["source_id"])
        except (TypeError, ValueError):
            task_id = None

        if task_id is not None:
            access_log = find_nearest_task_access_log(
                notification,
                task_access_logs_by_task.get(task_id, []),
            )
            access_log_description = build_task_access_log_description(access_log)
            if access_log_description:
                return access_log_description

    return None


def get_user_email(
    users_by_auth_uid: dict[str, dict],
    user_id: object,
    app_settings: Settings,
) -> str | None:
    if not user_id:
        return None

    return users_by_auth_uid.get(str(user_id), {}).get(
        app_settings.signup_allowed_users_email_column
    )


def get_user_name(
    users_by_auth_uid: dict[str, dict],
    user_id: object,
) -> str | None:
    if not user_id:
        return None

    return users_by_auth_uid.get(str(user_id), {}).get(REF_USER_NAME_COLUMN)


def build_task_summary_response(
    task: dict,
    task_watchers_by_task: dict[int, list[dict]],
    task_work_logs_by_task: dict[int, list[dict]],
    task_access_logs_by_task: dict[int, list[dict]],
    users_by_auth_uid: dict[str, dict],
    app_settings: Settings,
) -> TaskSummaryResponse:
    task_id = int(task["id"])

    return TaskSummaryResponse(
        id=task["id"],
        project_id=task["project_id"],
        task_title=task["task_title"],
        task_details=task.get("task_details"),
        documents=task.get("documents"),
        assigned_to_email=get_user_email(
            users_by_auth_uid,
            task.get("assigned_to"),
            app_settings,
        ),
        assigned_to_name=get_user_name(users_by_auth_uid, task.get("assigned_to")),
        stakeholder_email=get_user_email(
            users_by_auth_uid,
            task.get("stakeholder_id"),
            app_settings,
        ),
        stakeholder_name=get_user_name(users_by_auth_uid, task.get("stakeholder_id")),
        start_date=task.get("start_date"),
        end_date=task.get("end_date"),
        watchers=build_watcher_responses(
            task_watchers_by_task.get(task_id, []),
            users_by_auth_uid,
            app_settings,
        ),
        work_logs=[
            TaskWorkLogResponse(
                id=work_log["id"],
                work_note=work_log.get("work_note") or "",
                work_date=work_log.get("work_date"),
                hours=work_log.get("hours"),
                logged_by_email=get_user_email(
                    users_by_auth_uid,
                    work_log.get("logged_by"),
                    app_settings,
                ),
                logged_by_name=get_user_name(
                    users_by_auth_uid,
                    work_log.get("logged_by"),
                ),
                created_at=work_log.get("created_at"),
            )
            for work_log in task_work_logs_by_task.get(task_id, [])
        ],
        access_logs=build_task_access_log_responses(
            task_access_logs_by_task.get(task_id, []),
            users_by_auth_uid,
            app_settings,
        ),
        status=task.get("status") or TASK_STATUS_OPEN,
    )


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="NTT Backend",
        version="0.1.0",
        responses={
            status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
            status.HTTP_500_INTERNAL_SERVER_ERROR: {"model": ErrorResponse},
        },
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Idempotency-Key"],
        expose_headers=["Content-Disposition"],
    )

    @app.get("/health")
    def health_check() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(Exception)
    def unexpected_error_handler(_request, _exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Unexpected backend error."},
        )

    @app.post("/auth/signup", response_model=MessageResponse)
    def signup(
        payload: SignupRequest,
        supabase: Client = Depends(get_supabase_client),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        normalized_email = payload.email.strip().lower()
        enforce_rate_limit("signup", normalized_email, limit=5, window_seconds=600)

        try:
            ref_user = get_ref_user(supabase_admin, app_settings, normalized_email)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not verify whether this email is approved for signup.",
            ) from exc

        if not ref_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is not approved for signup.",
            )

        current_status = str(
            ref_user.get(app_settings.signup_allowed_users_status_column) or ""
        ).upper()
        if current_status == NORMAL_STATUS:
            return MessageResponse(detail="Signup already completed. Please sign in.")
        if current_status != PENDING_STATUS or ref_user.get(AUTH_UID_COLUMN):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This user record is not ready for signup. Contact an administrator.",
            )

        try:
            signup_result = supabase.auth.sign_up(
                {
                    "email": normalized_email,
                    "password": payload.password,
                    "options": {
                        "email_redirect_to": app_settings.signup_confirmation_redirect_url,
                    },
                }
            )
            signup_user = getattr(signup_result, "user", None)
            signup_session = getattr(signup_result, "session", None)
        except Exception as exc:
            auth_error = str(exc).lower()
            if "already registered" in auth_error or "already exists" in auth_error:
                return MessageResponse(
                    detail="An authentication account already exists. Please sign in to complete activation."
                )

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not create account with this email and password.",
            ) from exc

        if not signup_user or not getattr(signup_user, "id", None):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase signup did not return a user id.",
            )

        # With email confirmation enabled, Supabase returns a user but no
        # session. Keep the approved user PENDING with a NULL auth_uid until
        # their first successful sign-in proves that confirmation is complete.
        if not signup_session:
            return MessageResponse(
                detail="Account created. Check your email and confirm your address before signing in."
            )

        try:
            if signup_session:
                activate_ref_user(
                    supabase_admin,
                    app_settings,
                    normalized_email,
                    signup_user.id,
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Account created, but user status could not be updated.",
            ) from exc

        invalidate_user_cache()
        return MessageResponse(detail="Signup successful. You can now sign in.")

    @app.post("/auth/forgot-password", response_model=MessageResponse)
    def forgot_password(
        payload: ForgotPasswordRequest,
        supabase: Client = Depends(get_supabase_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        normalized_email = payload.email.strip().lower()
        enforce_rate_limit("forgot-password", normalized_email, limit=5, window_seconds=600)

        try:
            supabase.auth.reset_password_email(
                normalized_email,
                {
                    "redirect_to": app_settings.password_reset_redirect_url,
                },
            )
        except TypeError:
            supabase.auth.reset_password_email(normalized_email)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not send password reset email.",
            ) from exc

        return MessageResponse(
            detail="If this email has an account, a password reset link has been sent."
        )

    @app.post("/auth/login", response_model=LoginResponse)
    def login(
        payload: LoginRequest,
        supabase: Client = Depends(get_supabase_client),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> LoginResponse:
        normalized_email = payload.email.strip().lower()
        enforce_rate_limit("login", normalized_email, limit=10, window_seconds=300)

        try:
            ref_user = get_ref_user(supabase_admin, app_settings, normalized_email)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not verify whether this email is approved for sign in.",
            ) from exc

        if not ref_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        current_status = str(
            ref_user.get(app_settings.signup_allowed_users_status_column) or ""
        ).upper()
        if current_status not in {NORMAL_STATUS, PENDING_STATUS}:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        try:
            result = supabase.auth.sign_in_with_password(
                {
                    "email": normalized_email,
                    "password": payload.password,
                }
            )

            session = getattr(result, "session", None)
            user = getattr(result, "user", None)

            if not session or not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                )

            if current_status == PENDING_STATUS:
                if ref_user.get(AUTH_UID_COLUMN):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This pending user record is linked incorrectly. Contact an administrator.",
                    )
                activate_ref_user(
                    supabase_admin,
                    app_settings,
                    normalized_email,
                    user.id,
                )
                ref_user = {
                    **ref_user,
                    AUTH_UID_COLUMN: user.id,
                    app_settings.signup_allowed_users_status_column: NORMAL_STATUS,
                }
                invalidate_user_cache()

            sync_ref_user_auth_uid(
                supabase_admin,
                app_settings,
                ref_user,
                normalized_email,
                user.id,
            )

            return LoginResponse(
                access_token=session.access_token,
                refresh_token=session.refresh_token,
                user_id=user.id,
                email=user.email,
                user_class=str(ref_user.get(USER_CLASS_COLUMN) or "").upper(),
            )
        except HTTPException:
            raise
        except Exception as exc:
            auth_error = str(exc)
            if "email not confirmed" in auth_error.lower():
                detail = "Please confirm your email before signing in."
            else:
                detail = "Invalid email or password."

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=detail,
            ) from exc

    @app.post("/auth/refresh", response_model=LoginResponse)
    def refresh_session(
        payload: RefreshSessionRequest,
        app_settings: Settings = Depends(get_settings),
        supabase_admin: Client = Depends(get_supabase_admin_client),
    ) -> LoginResponse:
        enforce_rate_limit("refresh-session", payload.refresh_token[:24], limit=60, window_seconds=300)
        try:
            response = httpx.post(
                f"{app_settings.supabase_url}/auth/v1/token?grant_type=refresh_token",
                headers={
                    "apikey": app_settings.supabase_publishable_key,
                    "Content-Type": "application/json",
                },
                json={"refresh_token": payload.refresh_token},
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            ) from exc

        user = data.get("user") or {}
        normalized_email = str(user.get("email") or "").strip().lower()
        ref_user = get_ref_user(supabase_admin, app_settings, normalized_email)
        if (
            not ref_user
            or str(
                ref_user.get(app_settings.signup_allowed_users_status_column) or ""
            ).upper()
            != NORMAL_STATUS
            or str(ref_user.get(AUTH_UID_COLUMN) or "") != str(user.get("id") or "")
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        return LoginResponse(
            access_token=data.get("access_token") or "",
            refresh_token=data.get("refresh_token") or payload.refresh_token,
            user_id=user.get("id") or "",
            email=user.get("email"),
            user_class=str(ref_user.get(USER_CLASS_COLUMN) or "").upper(),
        )

    @app.post("/auth/logout", response_model=MessageResponse)
    def logout_session(
        _payload: LogoutRequest | None = None,
        authorization: str | None = Header(default=None),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        if authorization:
            try:
                httpx.post(
                    f"{app_settings.supabase_url}/auth/v1/logout",
                    headers={
                        "apikey": app_settings.supabase_publishable_key,
                        "Authorization": authorization,
                    },
                    timeout=10,
                )
            except Exception:
                pass

        return MessageResponse(detail="Logged out successfully.")

    @app.get("/users", response_model=list[ProjectUserResponse])
    def list_project_users(
        _current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> list[ProjectUserResponse]:
        cache_key = "users:active"
        cached_users = backend_cache.get(cache_key)
        if cached_users is not None:
            return [ProjectUserResponse(**user) for user in cached_users]

        try:
            users = get_active_ref_users(supabase_admin, app_settings)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not load project users.",
            ) from exc

        response = [
            ProjectUserResponse(
                email=user.get(app_settings.signup_allowed_users_email_column),
                user_name=user.get(REF_USER_NAME_COLUMN),
                user_class=str(user.get(USER_CLASS_COLUMN) or "").upper(),
            )
            for user in users
            if user.get(app_settings.signup_allowed_users_email_column)
        ]
        backend_cache.set(
            cache_key,
            [user.model_dump() for user in response],
            app_settings.backend_cache_users_ttl_seconds,
        )
        return response

    @app.get("/auth/me", response_model=CurrentUserResponse)
    def get_my_profile(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUserResponse:
        return CurrentUserResponse(
            email=current_user.email,
            user_name=current_user.user_name,
            user_class=current_user.user_class,
            status=current_user.status,
        )

    @app.get("/admin/users", response_model=list[AdminUserResponse])
    def list_admin_users(
        _current_user: CurrentUser = Depends(require_admin),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> list[AdminUserResponse]:
        users = get_all_ref_users(supabase_admin, app_settings)
        return [
            AdminUserResponse(
                id=int(user["id"]),
                email=str(
                    user.get(app_settings.signup_allowed_users_email_column) or ""
                ),
                user_name=user.get(REF_USER_NAME_COLUMN),
                user_class=str(user.get(USER_CLASS_COLUMN) or "").upper(),
                status=str(
                    user.get(app_settings.signup_allowed_users_status_column) or ""
                ).upper(),
                auth_uid=(
                    str(user.get(AUTH_UID_COLUMN))
                    if user.get(AUTH_UID_COLUMN)
                    else None
                ),
            )
            for user in users
        ]

    @app.post("/admin/users", response_model=AdminUserResponse)
    def register_admin_user(
        payload: AdminCreateUserRequest,
        _current_user: CurrentUser = Depends(require_admin),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> AdminUserResponse:
        normalized_email = payload.email.strip().lower()
        user_class = payload.user_class.strip().upper()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter a valid email address.",
            )
        if user_class not in {USER_CLASS_SENIOR, USER_CLASS_JUNIOR}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New users must be registered as SENIOR or JUNIOR.",
            )
        if get_ref_user(supabase_admin, app_settings, normalized_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email is already registered.",
            )

        try:
            user = insert_pending_ref_user(
                supabase_admin,
                app_settings,
                email=normalized_email,
                user_name=payload.user_name.strip(),
                user_class=user_class,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not register this user.",
            ) from exc
        invalidate_user_cache()
        return AdminUserResponse(
            id=int(user["id"]),
            email=normalized_email,
            user_name=user.get(REF_USER_NAME_COLUMN),
            user_class=user_class,
            status=PENDING_STATUS,
            auth_uid=None,
        )

    @app.post(
        "/admin/users/{ref_user_id}/user-class",
        response_model=AdminUserResponse,
    )
    def change_admin_user_class(
        ref_user_id: int,
        payload: AdminUpdateUserClassRequest,
        current_user: CurrentUser = Depends(require_admin),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> AdminUserResponse:
        user_class = payload.user_class.strip().upper()
        if user_class not in {USER_CLASS_SENIOR, USER_CLASS_JUNIOR}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Managed users can only be SENIOR or JUNIOR.",
            )
        matching_users = [
            user
            for user in get_all_ref_users(supabase_admin, app_settings)
            if int(user.get("id") or 0) == ref_user_id
        ]
        if not matching_users:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found.",
            )
        existing = matching_users[0]
        if str(existing.get(USER_CLASS_COLUMN) or "").upper() == USER_CLASS_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The administrator account class cannot be changed here.",
            )
        if str(existing.get(AUTH_UID_COLUMN) or "") == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot change your own user class.",
            )
        existing_auth_uid = existing.get(AUTH_UID_COLUMN)
        if user_class == USER_CLASS_JUNIOR and existing_auth_uid:
            stakeholder_projects = (
                supabase_admin.table(PROJECTS_TABLE)
                .select("id")
                .eq("stakeholder_id", existing_auth_uid)
                .limit(1)
                .execute()
            )
            watched_projects = (
                supabase_admin.table(PROJECT_WATCHERS_TABLE)
                .select("project_id")
                .eq("user_id", existing_auth_uid)
                .eq("status", "ACTIVE")
                .limit(1)
                .execute()
            )
            if (
                getattr(stakeholder_projects, "data", None)
                or getattr(watched_projects, "data", None)
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Remove this user as a project stakeholder or watcher "
                        "before changing the class to JUNIOR."
                    ),
                )
        updated = update_ref_user_class(
            supabase_admin,
            app_settings,
            user_id=ref_user_id,
            user_class=user_class,
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found.",
            )
        invalidate_user_cache()
        invalidate_project_cache()
        invalidate_task_cache()
        return AdminUserResponse(
            id=ref_user_id,
            email=str(
                existing.get(app_settings.signup_allowed_users_email_column) or ""
            ),
            user_name=existing.get(REF_USER_NAME_COLUMN),
            user_class=user_class,
            status=str(
                existing.get(app_settings.signup_allowed_users_status_column) or ""
            ).upper(),
            auth_uid=(
                str(existing.get(AUTH_UID_COLUMN))
                if existing.get(AUTH_UID_COLUMN)
                else None
            ),
        )

    @app.get("/push/config", response_model=PushConfigResponse)
    def get_push_config(
        app_settings: Settings = Depends(get_settings),
    ) -> PushConfigResponse:
        return PushConfigResponse(
            public_key=app_settings.vapid_public_key,
            is_configured=is_push_configured(app_settings),
        )

    @app.post("/push/subscriptions", response_model=MessageResponse)
    def save_push_subscription(
        payload: PushSubscriptionRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        if not is_push_configured(app_settings):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Push notifications are not configured yet.",
            )

        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        upsert_push_subscription(
            supabase_admin,
            str(user_id),
            payload.endpoint,
            payload.keys.p256dh,
            payload.keys.auth,
            payload.expiration_time,
        )
        return MessageResponse(detail="Push notifications enabled.")

    @app.get("/notifications", response_model=list[NotificationResponse])
    def list_notifications(
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> list[NotificationResponse]:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        cache_key = f"notifications:list:{user_id}"
        cached_notifications = backend_cache.get(cache_key)
        if cached_notifications is not None:
            return [
                NotificationResponse(**notification)
                for notification in cached_notifications
            ]

        notifications = get_notifications_for_user(supabase_admin, str(user_id))
        task_notification_ids = [
            int(notification["source_id"])
            for notification in notifications
            if str(notification.get("source_type") or "").upper() == "TASK"
            and notification.get("source_id") is not None
        ]
        task_access_logs_by_task = get_task_access_logs_for_tasks(
            supabase_admin,
            task_notification_ids,
        )
        response = [
            NotificationResponse(
                id=notification["id"],
                subject=notification.get("subject") or "",
                body=notification.get("body"),
                description=build_notification_description(
                    notification,
                    task_access_logs_by_task,
                ),
                status=notification.get("status") or NOTIFICATION_STATUS_UNREAD,
                source_type=notification.get("source_type") or "",
                source_id=notification.get("source_id") or 0,
                target_url=notification.get("target_url"),
                created_at=notification.get("created_at"),
            )
            for notification in notifications
        ]
        backend_cache.set(
            cache_key,
            [notification.model_dump() for notification in response],
            app_settings.backend_cache_notifications_ttl_seconds,
        )
        return response

    @app.get("/notifications/unread-count", response_model=NotificationCountResponse)
    def get_unread_notification_count(
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> NotificationCountResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        cache_key = f"notifications:unread:{user_id}"
        cached_count = backend_cache.get(cache_key)
        if cached_count is not None:
            return NotificationCountResponse(unread_count=int(cached_count))

        unread_count = count_unread_notifications_for_user(
            supabase_admin,
            str(user_id),
        )
        backend_cache.set(
            cache_key,
            unread_count,
            app_settings.backend_cache_notifications_ttl_seconds,
        )
        return NotificationCountResponse(unread_count=unread_count)

    @app.post("/notifications/{notification_id}/read", response_model=MessageResponse)
    def read_notification(
        notification_id: int,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        notification = mark_notification_read(
            supabase_admin,
            notification_id,
            str(user_id),
            datetime.now(timezone.utc).isoformat(),
        )
        if notification is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found.",
            )

        invalidate_notification_cache([str(user_id)])
        return MessageResponse(detail="Notification marked as read.")

    @app.post("/notifications/read-all", response_model=MessageResponse)
    def read_all_notifications(
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        updated_count = mark_all_notifications_read(
            supabase_admin,
            str(user_id),
            datetime.now(timezone.utc).isoformat(),
        )
        invalidate_notification_cache([str(user_id)])
        return MessageResponse(
            detail=f"{updated_count} notification(s) marked as read."
        )

    @app.get("/projects", response_model=list[ProjectSummaryResponse])
    def list_projects(
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> list[ProjectSummaryResponse]:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        cache_key = f"projects:list:{user_id}"
        cached_projects = backend_cache.get(cache_key)
        if cached_projects is not None:
            return [ProjectSummaryResponse(**project) for project in cached_projects]

        project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select(
                "id,project_name,description,document_name,document_url,documents,"
                "status,stakeholder_id"
            )
            .order("created_at", desc=True)
            .execute()
        )
        projects = getattr(project_response, "data", None) or []
        loaded_project_ids = [int(project["id"]) for project in projects]
        watchers_by_project = get_project_watchers_for_projects(
            supabase_admin,
            loaded_project_ids,
        )
        all_member_ids: list[str] = []
        all_member_ids.extend(
            str(watcher["user_id"])
            for watchers in watchers_by_project.values()
            for watcher in watchers
            if watcher.get("user_id")
        )
        all_member_ids.extend(
            str(project["stakeholder_id"])
            for project in projects
            if project.get("stakeholder_id")
        )

        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            all_member_ids,
        )

        response = [
            ProjectSummaryResponse(
                id=project["id"],
                project_name=project["project_name"],
                description=project.get("description"),
                document_name=project.get("document_name"),
                document_url=project.get("document_url"),
                documents=project.get("documents"),
                status=project.get("status") or "ACTIVE",
                stakeholder_email=(
                    users_by_auth_uid.get(str(project.get("stakeholder_id")), {}).get(
                        app_settings.signup_allowed_users_email_column
                    )
                    if project.get("stakeholder_id")
                    else None
                ),
                stakeholder_name=(
                    users_by_auth_uid.get(str(project.get("stakeholder_id")), {}).get(
                        REF_USER_NAME_COLUMN
                    )
                    if project.get("stakeholder_id")
                    else None
                ),
                watchers=build_watcher_responses(
                    watchers_by_project.get(int(project["id"]), []),
                    users_by_auth_uid,
                    app_settings,
                ),
                can_edit=is_project_editor(
                    project,
                    watchers_by_project.get(int(project["id"]), []),
                    user_id,
                ),
            )
            for project in projects
        ]
        backend_cache.set(
            cache_key,
            [project.model_dump() for project in response],
            app_settings.backend_cache_projects_ttl_seconds,
        )
        return response

    @app.get("/dashboard")
    def get_dashboard_data(
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> dict:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        cache_key = f"dashboard:data:{user_id}"
        cached_dashboard = backend_cache.get(cache_key)
        if cached_dashboard is not None:
            return cached_dashboard

        project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select(
                "id,project_name,description,document_name,document_url,documents,"
                "status,stakeholder_id"
            )
            .order("created_at", desc=True)
            .execute()
        )
        projects = getattr(project_response, "data", None) or []
        project_ids = [int(project["id"]) for project in projects]

        project_watchers_by_project = get_project_watchers_for_projects(
            supabase_admin,
            project_ids,
        )
        projects_by_id = {int(project["id"]): project for project in projects}

        tasks: list[dict] = []
        if project_ids:
            task_response = (
                supabase_admin.table(TASKS_TABLE)
                .select(
                    "id,project_id,task_title,task_details,documents,assigned_to,"
                    "status,start_date,end_date"
                )
                .in_("project_id", project_ids)
                .order("created_at", desc=True)
                .execute()
            )
            tasks = getattr(task_response, "data", None) or []

        tasks = [
            task_with_project_roles(task, projects_by_id.get(int(task["project_id"]), {}))
            for task in tasks
        ]
        task_ids = [int(task["id"]) for task in tasks]
        task_watchers_by_task = inherited_task_watchers_by_task(
            tasks,
            project_watchers_by_project,
        )
        task_work_logs_by_task = get_task_work_logs_for_tasks(supabase_admin, task_ids)
        task_access_logs_by_task = get_task_access_logs_for_tasks(
            supabase_admin,
            task_ids,
        )

        user_ids: list[str] = []

        def add_user_id(value: object) -> None:
            if value:
                user_ids.append(str(value))

        for project in projects:
            add_user_id(project.get("stakeholder_id"))
        for watchers in project_watchers_by_project.values():
            for watcher in watchers:
                add_user_id(watcher.get("user_id"))
        for task in tasks:
            add_user_id(task.get("assigned_to"))
            add_user_id(task.get("stakeholder_id"))
        for watchers in task_watchers_by_task.values():
            for watcher in watchers:
                add_user_id(watcher.get("user_id"))
        for work_logs in task_work_logs_by_task.values():
            for work_log in work_logs:
                add_user_id(work_log.get("logged_by"))
        for access_logs in task_access_logs_by_task.values():
            for access_log in access_logs:
                add_user_id(access_log.get("actor_user_id"))
                add_user_id(access_log.get("previous_assignee_id"))
                add_user_id(access_log.get("new_assignee_id"))

        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            user_ids,
        )

        project_responses = [
            ProjectSummaryResponse(
                id=project["id"],
                project_name=project["project_name"],
                description=project.get("description"),
                document_name=project.get("document_name"),
                document_url=project.get("document_url"),
                documents=project.get("documents"),
                status=project.get("status") or "ACTIVE",
                stakeholder_email=get_user_email(
                    users_by_auth_uid,
                    project.get("stakeholder_id"),
                    app_settings,
                ),
                stakeholder_name=get_user_name(
                    users_by_auth_uid,
                    project.get("stakeholder_id"),
                ),
                watchers=build_watcher_responses(
                    project_watchers_by_project.get(int(project["id"]), []),
                    users_by_auth_uid,
                    app_settings,
                ),
                can_edit=is_project_editor(
                    project,
                    project_watchers_by_project.get(int(project["id"]), []),
                    user_id,
                ),
            )
            for project in projects
        ]

        task_responses_by_project: dict[int, list[TaskSummaryResponse]] = {
            project_id: [] for project_id in project_ids
        }
        for task in tasks:
            task_response = build_task_summary_response(
                task,
                task_watchers_by_task,
                task_work_logs_by_task,
                task_access_logs_by_task,
                users_by_auth_uid,
                app_settings,
            )
            task_responses_by_project.setdefault(int(task["project_id"]), []).append(
                task_response
            )

        details_by_project = {
            project.id: ProjectDetailResponse(
                **project.model_dump(),
                tasks=task_responses_by_project.get(project.id, []),
            )
            for project in project_responses
        }

        dashboard = {
            "projects": [project.model_dump() for project in project_responses],
            "project_details": [
                details_by_project[project.id].model_dump()
                for project in project_responses
            ],
        }
        backend_cache.set(
            cache_key,
            dashboard,
            app_settings.backend_cache_dashboard_ttl_seconds,
        )
        return dashboard

    @app.get("/reports/board.pdf")
    def download_board_report(
        current_user: CurrentUser = Depends(require_admin),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> Response:
        dashboard = get_dashboard_data(current_user, supabase_admin, app_settings)
        report = build_board_report(
            dashboard,
            generated_for=str(getattr(current_user, "email", "") or "") or None,
        )
        filename = f"nexora-board-delivery-report-{date.today().isoformat()}.pdf"
        return Response(
            content=report,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/projects/{project_id}", response_model=ProjectDetailResponse)
    def get_project_detail(
        project_id: int,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> ProjectDetailResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)

        cache_key = f"projects:detail:{project_id}:{user_id}"
        cached_project = backend_cache.get(cache_key)
        if cached_project is not None:
            return ProjectDetailResponse(**cached_project)

        try:
            task_response = (
                supabase_admin.table(TASKS_TABLE)
                .select(
                    "id,project_id,task_title,task_details,documents,assigned_to,"
                    "status,start_date,end_date"
                )
                .eq("project_id", project_id)
                .order("created_at", desc=True)
                .execute()
            )
        except Exception:
            task_response = (
                supabase_admin.table(TASKS_TABLE)
                .select(
                    "id,project_id,task_title,task_details,documents,assigned_to,status"
                )
                .eq("project_id", project_id)
                .order("created_at", desc=True)
                .execute()
            )
        tasks = getattr(task_response, "data", None) or []
        tasks = [task_with_project_roles(task, project) for task in tasks]
        task_ids = [int(task["id"]) for task in tasks]
        task_watchers_by_task = {
            int(task["id"]): project_watchers for task in tasks
        }
        task_work_logs_by_task = get_task_work_logs_for_tasks(supabase_admin, task_ids)
        task_access_logs_by_task = get_task_access_logs_for_tasks(
            supabase_admin,
            task_ids,
        )
        user_ids = [
            str(watcher["user_id"]) for watcher in project_watchers if watcher.get("user_id")
        ]
        user_ids.extend(
            str(task["assigned_to"]) for task in tasks if task.get("assigned_to")
        )
        if project.get("stakeholder_id"):
            user_ids.append(str(project["stakeholder_id"]))
        user_ids.extend(
            str(work_log["logged_by"])
            for work_logs in task_work_logs_by_task.values()
            for work_log in work_logs
            if work_log.get("logged_by")
        )
        user_ids.extend(
            str(access_log[user_id_key])
            for access_logs in task_access_logs_by_task.values()
            for access_log in access_logs
            for user_id_key in (
                "actor_user_id",
                "previous_assignee_id",
                "new_assignee_id",
            )
            if access_log.get(user_id_key)
        )
        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            user_ids,
        )

        response = ProjectDetailResponse(
            id=project["id"],
            project_name=project["project_name"],
            description=project.get("description"),
            document_name=project.get("document_name"),
            document_url=project.get("document_url"),
            documents=project.get("documents"),
            status=project.get("status") or "ACTIVE",
            stakeholder_email=(
                users_by_auth_uid.get(str(project.get("stakeholder_id")), {}).get(
                    app_settings.signup_allowed_users_email_column
                )
                if project.get("stakeholder_id")
                else None
            ),
            stakeholder_name=(
                users_by_auth_uid.get(str(project.get("stakeholder_id")), {}).get(
                    REF_USER_NAME_COLUMN
                )
                if project.get("stakeholder_id")
                else None
            ),
            watchers=build_watcher_responses(
                project_watchers,
                users_by_auth_uid,
                app_settings,
            ),
            can_edit=is_project_editor(project, project_watchers, user_id),
            tasks=[
                TaskSummaryResponse(
                    id=task["id"],
                    project_id=task["project_id"],
                    task_title=task["task_title"],
                    task_details=task.get("task_details"),
                    documents=task.get("documents"),
                    assigned_to_email=(
                        users_by_auth_uid.get(str(task.get("assigned_to")), {}).get(
                            app_settings.signup_allowed_users_email_column
                        )
                        if task.get("assigned_to")
                        else None
                    ),
                    assigned_to_name=(
                        users_by_auth_uid.get(str(task.get("assigned_to")), {}).get(
                            REF_USER_NAME_COLUMN
                        )
                        if task.get("assigned_to")
                        else None
                    ),
                    stakeholder_email=(
                        users_by_auth_uid.get(str(task.get("stakeholder_id")), {}).get(
                            app_settings.signup_allowed_users_email_column
                        )
                        if task.get("stakeholder_id")
                        else None
                    ),
                    stakeholder_name=(
                        users_by_auth_uid.get(str(task.get("stakeholder_id")), {}).get(
                            REF_USER_NAME_COLUMN
                        )
                        if task.get("stakeholder_id")
                        else None
                    ),
                    start_date=task.get("start_date"),
                    end_date=task.get("end_date"),
                    watchers=build_watcher_responses(
                        task_watchers_by_task.get(int(task["id"]), []),
                        users_by_auth_uid,
                        app_settings,
                    ),
                    work_logs=[
                        TaskWorkLogResponse(
                            id=work_log["id"],
                            work_note=work_log.get("work_note") or "",
                            work_date=work_log.get("work_date"),
                            hours=work_log.get("hours"),
                            logged_by_email=users_by_auth_uid.get(
                                str(work_log.get("logged_by")), {}
                            ).get(app_settings.signup_allowed_users_email_column),
                            logged_by_name=users_by_auth_uid.get(
                                str(work_log.get("logged_by")), {}
                            ).get(REF_USER_NAME_COLUMN),
                            created_at=work_log.get("created_at"),
                        )
                        for work_log in task_work_logs_by_task.get(int(task["id"]), [])
                    ],
                    access_logs=build_task_access_log_responses(
                        task_access_logs_by_task.get(int(task["id"]), []),
                        users_by_auth_uid,
                        app_settings,
                    ),
                    status=task.get("status") or TASK_STATUS_OPEN,
                )
                for task in tasks
            ],
        )
        backend_cache.set(
            cache_key,
            response.model_dump(),
            app_settings.backend_cache_tasks_ttl_seconds,
        )
        return response

    @app.post("/projects/{project_id}/update", response_model=MessageResponse)
    def update_project(
        project_id: int,
        payload: UpdateProjectRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        require_management_user(current_user)

        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        if not is_project_editor(project, project_watchers, user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the project stakeholder or watcher can edit this project.",
            )

        update_payload = {
            "description": normalize_optional_text(payload.description),
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
        }
        stakeholder_user_id = None
        stakeholder_email = normalize_optional_text(payload.stakeholder_email)
        if stakeholder_email:
            stakeholder_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                stakeholder_email.lower(),
                "project stakeholder",
                MANAGEMENT_USER_CLASSES,
            )
            stakeholder_user_id = stakeholder_ref_user[AUTH_UID_COLUMN]
            update_payload["stakeholder_id"] = stakeholder_user_id
        elif payload.stakeholder_email == "":
            update_payload["stakeholder_id"] = None

        (
            supabase_admin.table(PROJECTS_TABLE)
            .update(update_payload)
            .eq("id", project_id)
            .execute()
        )

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
            MANAGEMENT_USER_CLASSES,
        )
        previous_watcher_user_ids = {
            str(watcher["user_id"])
            for watcher in project_watchers
            if watcher.get("user_id")
        }
        newly_added_watcher_user_ids = [
            str(watcher_user_id)
            for watcher_user_id in watcher_user_ids
            if str(watcher_user_id) not in previous_watcher_user_ids
        ]
        stakeholder_notification_user_id = (
            stakeholder_user_id
            if stakeholder_user_id
            and str(project.get("stakeholder_id") or "") != str(stakeholder_user_id)
            else None
        )
        replace_project_watchers(supabase_admin, project_id, watcher_user_ids)
        notify_project_roles(
            supabase_admin,
            app_settings,
            normalize_optional_text(project.get("project_name")) or f"Project #{project_id}",
            project_id,
            stakeholder_user_id=stakeholder_notification_user_id,
            watcher_user_ids=newly_added_watcher_user_ids,
            exclude_user_ids={str(user_id)},
        )

        invalidate_project_cache(project_id)
        return MessageResponse(detail="Project updated successfully.")

    @app.post("/projects", response_model=MessageResponse)
    def create_project(
        payload: CreateProjectRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        user_email = str(getattr(current_user, "email", "") or "").strip().lower()

        if not user_id or not user_email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        require_management_user(current_user)
        cached_response = get_cached_command_response(
            "create-project",
            str(user_id),
            payload.idempotency_key,
        )
        if cached_response is not None:
            return cached_response

        ref_user = get_ref_user(supabase_admin, app_settings, user_email)
        if not ref_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is not registered.",
            )

        current_status = str(
            ref_user.get(app_settings.signup_allowed_users_status_column) or ""
        ).upper()
        if current_status != NORMAL_STATUS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is not active for project creation.",
            )

        sync_ref_user_auth_uid(
            supabase_admin,
            app_settings,
            ref_user,
            user_email,
            user_id,
        )

        stakeholder_user_id = None
        stakeholder_email = (
            payload.stakeholder_email.strip().lower()
            if payload.stakeholder_email
            else None
        )
        if stakeholder_email:
            stakeholder_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                stakeholder_email,
                "project stakeholder",
                MANAGEMENT_USER_CLASSES,
            )
            stakeholder_user_id = stakeholder_ref_user.get(AUTH_UID_COLUMN)

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
            MANAGEMENT_USER_CLASSES,
        )

        project_payload = {
            "project_name": payload.project_name.strip(),
            "description": payload.description.strip() if payload.description else None,
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
            "created_by": user_id,
            "stakeholder_id": stakeholder_user_id,
            "status": "ACTIVE",
        }

        try:
            project_response = (
                supabase_admin.table(PROJECTS_TABLE)
                .insert(project_payload)
                .execute()
            )
            project_data = getattr(project_response, "data", None) or []
            project_id = project_data[0]["id"] if project_data else None

            if not project_id:
                raise RuntimeError("Project insert did not return an id.")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Could not create project record: {exc}",
            ) from exc

        try:
            replace_project_watchers(supabase_admin, project_id, watcher_user_ids)
            notify_project_roles(
                supabase_admin,
                app_settings,
                payload.project_name.strip(),
                int(project_id),
                stakeholder_user_id=stakeholder_user_id,
                watcher_user_ids=watcher_user_ids,
                exclude_user_ids={str(user_id)},
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Project was created, but project roles could not be "
                    f"saved: {exc}"
                ),
            ) from exc

        invalidate_project_cache(int(project_id))
        response = MessageResponse(detail="Project created successfully.")
        cache_command_response(
            "create-project",
            str(user_id),
            payload.idempotency_key,
            response,
        )
        return response

    @app.post("/projects/{project_id}/tasks", response_model=MessageResponse)
    def create_task(
        project_id: int,
        payload: CreateTaskRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        require_management_user(current_user)
        cached_response = get_cached_command_response(
            "create-task",
            str(user_id),
            payload.idempotency_key,
        )
        if cached_response is not None:
            return cached_response

        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        assigned_user_id = None
        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        if assigned_to_email:
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
                "task assignee",
                ASSIGNABLE_USER_CLASSES,
            )
            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]

        end_date = parse_iso_date(payload.end_date, "Task end date")

        task_response = (
            supabase_admin.table(TASKS_TABLE)
            .insert(
                {
                    "project_id": project_id,
                    "task_title": payload.task_title.strip(),
                    "task_details": normalize_optional_text(payload.task_details),
                    "documents": normalize_optional_text(payload.documents),
                    "assigned_to": assigned_user_id,
                    "created_by": user_id,
                    "status": TASK_STATUS_OPEN,
                    "end_date": end_date,
                }
            )
            .execute()
        )
        task_data = getattr(task_response, "data", None) or []
        task_id = int(task_data[0]["id"]) if task_data else None
        if task_id:
            insert_task_access_log(
                supabase_admin,
                task_id=task_id,
                project_id=project_id,
                actor_user_id=str(user_id),
                event_type="TASK_CREATED",
                new_status=TASK_STATUS_OPEN,
                new_assignee_id=str(assigned_user_id) if assigned_user_id else None,
                event_note="Task was created.",
            )
            notify_task_roles(
                supabase_admin,
                app_settings,
                payload.task_title.strip(),
                task_id,
                assigned_user_id=assigned_user_id,
                stakeholder_user_id=project.get("stakeholder_id"),
                watcher_user_ids=project_watcher_user_ids(project_watchers),
                exclude_user_ids={str(user_id)},
            )

        if task_id:
            invalidate_task_cache(task_id, project_id)
        else:
            invalidate_project_cache(project_id)
        response = MessageResponse(detail="Task created successfully.")
        cache_command_response(
            "create-task",
            str(user_id),
            payload.idempotency_key,
            response,
        )
        return response

    @app.post("/tasks/{task_id}/update", response_model=MessageResponse)
    def update_task(
        task_id: int,
        payload: UpdateTaskRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        require_management_user(current_user)

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        if not can_change_task_assignee(project, task, user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Only the project stakeholder or current task assignee "
                    "can update this task."
                ),
            )

        update_payload = {}
        if payload.task_title is not None:
            update_payload["task_title"] = payload.task_title.strip()
        if payload.task_details is not None:
            update_payload["task_details"] = normalize_optional_text(
                payload.task_details
            )
        if payload.documents is not None:
            update_payload["documents"] = normalize_optional_text(payload.documents)
        if payload.end_date is not None:
            update_payload["end_date"] = parse_iso_date(payload.end_date, "Task end date")

        assigned_user_id = None
        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        if assigned_to_email:
            if not can_change_task_assignee(project, task, user_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Only the project stakeholder or current task assignee "
                        "can change the task assignee."
                    ),
                )
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
                "task assignee",
                ASSIGNABLE_USER_CLASSES,
            )
            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]
            update_payload["assigned_to"] = assigned_user_id
        elif payload.assigned_to_email == "":
            if not can_change_task_assignee(project, task, user_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Only the project stakeholder or current task assignee "
                        "can change the task assignee."
                    ),
                )
            update_payload["assigned_to"] = None

        if update_payload:
            (
                supabase_admin.table(TASKS_TABLE)
                .update(update_payload)
                .eq("id", task_id)
                .execute()
            )
            if "assigned_to" in update_payload and str(task.get("assigned_to") or "") != str(
                update_payload.get("assigned_to") or ""
            ):
                insert_task_access_log(
                    supabase_admin,
                    task_id=task_id,
                    project_id=project_id,
                    actor_user_id=str(user_id),
                    event_type="TASK_ASSIGNEE_CHANGED",
                    previous_assignee_id=(
                        str(task.get("assigned_to")) if task.get("assigned_to") else None
                    ),
                    new_assignee_id=(
                        str(update_payload.get("assigned_to"))
                        if update_payload.get("assigned_to")
                        else None
                    ),
                    event_note="Task assignee changed.",
                )
            if "end_date" in update_payload:
                insert_task_access_log(
                    supabase_admin,
                    task_id=task_id,
                    project_id=project_id,
                    actor_user_id=str(user_id),
                    event_type="TASK_DUE_DATE_CHANGED",
                    event_note=f"Task end date changed to {update_payload['end_date']}.",
                )
        assigned_notification_user_id = (
            assigned_user_id
            if "assigned_to" in update_payload
            and assigned_user_id
            and str(task.get("assigned_to") or "") != str(assigned_user_id)
            else None
        )
        notify_task_roles(
            supabase_admin,
            app_settings,
            normalize_optional_text(update_payload.get("task_title"))
            or normalize_optional_text(task.get("task_title"))
            or f"Task #{task_id}",
            task_id,
            assigned_user_id=assigned_notification_user_id,
            stakeholder_user_id=project.get("stakeholder_id"),
            watcher_user_ids=project_watcher_user_ids(project_watchers),
            exclude_user_ids={str(user_id)},
        )

        invalidate_task_cache(task_id, project_id)
        return MessageResponse(detail="Task updated successfully.")

    @app.post("/tasks/{task_id}/status", response_model=MessageResponse)
    def update_task_status(
        task_id: int,
        payload: UpdateTaskStatusRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        requested_status = payload.status.strip().upper()
        allowed_statuses = {
            TASK_STATUS_OPEN,
            TASK_STATUS_IN_PROGRESS,
            TASK_STATUS_CLOSE_REQUESTED,
            TASK_STATUS_CLOSED,
        }
        if requested_status not in allowed_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported task status.",
            )

        current_status = str(task.get("status") or TASK_STATUS_OPEN).upper()
        if requested_status == current_status:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task is already in this status.",
            )

        if requested_status == TASK_STATUS_IN_PROGRESS and current_status != TASK_STATUS_OPEN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only open tasks can be moved to in progress.",
            )

        if (
            requested_status == TASK_STATUS_CLOSE_REQUESTED
            and current_status != TASK_STATUS_IN_PROGRESS
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only in-progress tasks can be sent for close review.",
            )

        if requested_status == TASK_STATUS_CLOSED and current_status not in {
            TASK_STATUS_IN_PROGRESS,
            TASK_STATUS_CLOSE_REQUESTED,
        }:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only in-progress or close-requested tasks can be closed.",
            )

        current_user_is_assignee = str(task.get("assigned_to")) == str(user_id)
        current_user_is_stakeholder = is_project_stakeholder(project, user_id)

        if requested_status in {
            TASK_STATUS_IN_PROGRESS,
            TASK_STATUS_CLOSE_REQUESTED,
        }:
            if not current_user_is_assignee:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the assignee can move this task to that status.",
                )

        if requested_status == TASK_STATUS_CLOSED and not current_user_is_stakeholder:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the stakeholder can close this task.",
            )
        if (
            current_user.user_class == USER_CLASS_JUNIOR
            and not current_user_is_assignee
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Junior users can only act on tasks assigned to them.",
            )

        task_name = normalize_optional_text(task.get("task_title")) or f"Task #{task_id}"
        actor_name = get_actor_display_name(supabase_admin, app_settings, user_id)
        status_payload = {"status": requested_status}
        if requested_status == TASK_STATUS_IN_PROGRESS and not task.get("start_date"):
            status_payload["start_date"] = datetime.now(timezone.utc).isoformat()

        supabase_admin.table(TASKS_TABLE).update(status_payload).eq("id", task_id).execute()
        event_type_by_status = {
            TASK_STATUS_IN_PROGRESS: "TASK_WORK_STARTED",
            TASK_STATUS_CLOSE_REQUESTED: "TASK_CLOSE_REQUESTED",
            TASK_STATUS_CLOSED: "TASK_CLOSED",
        }
        insert_task_access_log(
            supabase_admin,
            task_id=task_id,
            project_id=project_id,
            actor_user_id=str(user_id),
            event_type=event_type_by_status.get(
                requested_status,
                "TASK_STATUS_CHANGED",
            ),
            previous_status=task.get("status"),
            new_status=requested_status,
            previous_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            new_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            event_note=f"Task status changed to {requested_status}.",
        )

        if requested_status == TASK_STATUS_CLOSE_REQUESTED and project.get(
            "stakeholder_id"
        ):
            notify_user_ids(
                supabase_admin,
                app_settings,
                [str(project["stakeholder_id"])],
                f"{actor_name} requested to close task",
                f'{actor_name} requested to close "{task_name}".',
                "TASK",
                task_id,
                target_url=get_task_target_url(task_id),
                exclude_user_ids={str(user_id)},
            )

        notify_user_ids(
            supabase_admin,
            app_settings,
            project_watcher_user_ids(project_watchers),
            f"{task_name} moved to {requested_status}",
            f'{actor_name} changed "{task_name}" to {requested_status}.',
            "TASK",
            task_id,
            target_url=get_task_target_url(task_id),
            exclude_user_ids={str(user_id)},
        )

        invalidate_task_cache(task_id, project_id)
        return MessageResponse(detail="Task status updated successfully.")

    @app.get("/tasks/{task_id}", response_model=TaskDetailResponse)
    def get_task_detail(
        task_id: int,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> TaskDetailResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        cache_key = f"tasks:detail:{task_id}"
        cached_task = backend_cache.get(cache_key)
        if cached_task is not None:
            return TaskDetailResponse(**cached_task)

        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        task = task_with_project_roles(task, project)

        try:
            comment_response = (
                supabase_admin.table(TASK_COMMENTS_TABLE)
                .select(
                    "id,created_at,task_id,parent_comment_id,commented_by,"
                    "comment_text,deliverable_url"
                )
                .eq("task_id", task_id)
                .order("created_at", desc=False)
                .execute()
            )
        except Exception as exc:
            if not is_optional_analytics_table_error(exc):
                raise
            comment_response = (
                supabase_admin.table(TASK_COMMENTS_TABLE)
                .select("id,created_at,task_id,commented_by,comment_text,deliverable_url")
                .eq("task_id", task_id)
                .order("created_at", desc=False)
                .execute()
            )
        comments = getattr(comment_response, "data", None) or []
        work_logs = get_task_work_logs(supabase_admin, task_id)
        access_logs = get_task_access_logs_for_tasks(supabase_admin, [task_id]).get(
            task_id,
            [],
        )
        user_ids = []
        if task.get("assigned_to"):
            user_ids.append(str(task["assigned_to"]))
        if task.get("stakeholder_id"):
            user_ids.append(str(task["stakeholder_id"]))
        user_ids.extend(
            str(watcher["user_id"])
            for watcher in project_watchers
            if watcher.get("user_id")
        )
        user_ids.extend(
            str(comment["commented_by"])
            for comment in comments
            if comment.get("commented_by")
        )
        user_ids.extend(
            str(work_log["logged_by"])
            for work_log in work_logs
            if work_log.get("logged_by")
        )
        user_ids.extend(
            str(access_log[user_id_key])
            for access_log in access_logs
            for user_id_key in (
                "actor_user_id",
                "previous_assignee_id",
                "new_assignee_id",
            )
            if access_log.get(user_id_key)
        )
        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            user_ids,
        )
        assigned_ref_user = users_by_auth_uid.get(str(task.get("assigned_to"))) or {}
        stakeholder_ref_user = (
            users_by_auth_uid.get(str(task.get("stakeholder_id"))) or {}
        )

        response = TaskDetailResponse(
            id=task["id"],
            project_id=project_id,
            project_name=project["project_name"],
            task_title=task["task_title"],
            task_details=task.get("task_details"),
            documents=task.get("documents"),
            assigned_to_email=assigned_ref_user.get(
                app_settings.signup_allowed_users_email_column
            ),
            assigned_to_name=assigned_ref_user.get(REF_USER_NAME_COLUMN),
            stakeholder_email=stakeholder_ref_user.get(
                app_settings.signup_allowed_users_email_column
            ),
            stakeholder_name=stakeholder_ref_user.get(REF_USER_NAME_COLUMN),
            start_date=task.get("start_date"),
            end_date=task.get("end_date"),
            watchers=build_watcher_responses(
                project_watchers,
                users_by_auth_uid,
                app_settings,
            ),
            status=task.get("status") or TASK_STATUS_OPEN,
            comments=[
                TaskCommentResponse(
                    id=comment["id"],
                    parent_comment_id=comment.get("parent_comment_id"),
                    comment_text=comment.get("comment_text"),
                    deliverable_url=comment.get("deliverable_url"),
                    commented_by_email=(
                        users_by_auth_uid.get(
                            str(comment.get("commented_by")), {}
                        ).get(app_settings.signup_allowed_users_email_column)
                    ),
                    commented_by_name=(
                        users_by_auth_uid.get(
                            str(comment.get("commented_by")), {}
                        ).get(REF_USER_NAME_COLUMN)
                    ),
                    created_at=comment.get("created_at"),
                )
                for comment in comments
            ],
            work_logs=[
                TaskWorkLogResponse(
                    id=work_log["id"],
                    work_note=work_log.get("work_note") or "",
                    work_date=work_log.get("work_date"),
                    hours=work_log.get("hours"),
                    logged_by_email=(
                        users_by_auth_uid.get(str(work_log.get("logged_by")), {}).get(
                            app_settings.signup_allowed_users_email_column
                        )
                    ),
                    logged_by_name=(
                        users_by_auth_uid.get(str(work_log.get("logged_by")), {}).get(
                            REF_USER_NAME_COLUMN
                        )
                    ),
                    created_at=work_log.get("created_at"),
                )
                for work_log in work_logs
            ],
            access_logs=build_task_access_log_responses(
                access_logs,
                users_by_auth_uid,
                app_settings,
            ),
        )
        backend_cache.set(
            cache_key,
            response.model_dump(),
            app_settings.backend_cache_tasks_ttl_seconds,
        )
        return response

    @app.post("/tasks/{task_id}/comments", response_model=MessageResponse)
    def create_task_comment(
        task_id: int,
        payload: CreateTaskCommentRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        cached_response = get_cached_command_response(
            "create-comment",
            str(user_id),
            payload.idempotency_key,
        )
        if cached_response is not None:
            return cached_response

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        if (
            current_user.user_class == USER_CLASS_JUNIOR
            and str(task.get("assigned_to") or "") != str(user_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Junior users can only comment on tasks assigned to them.",
            )
        comment_payload = {
            "task_id": task_id,
            "commented_by": user_id,
            "comment_text": payload.comment_text.strip(),
            "deliverable_url": normalize_optional_text(payload.deliverable_url),
        }
        if payload.parent_comment_id:
            comment_payload["parent_comment_id"] = payload.parent_comment_id

        try:
            (
                supabase_admin.table(TASK_COMMENTS_TABLE)
                .insert(comment_payload)
                .execute()
            )
        except Exception as exc:
            if not is_optional_analytics_table_error(exc):
                raise
            comment_payload.pop("parent_comment_id", None)
            (
                supabase_admin.table(TASK_COMMENTS_TABLE)
                .insert(comment_payload)
                .execute()
            )
        insert_task_access_log(
            supabase_admin,
            task_id=task_id,
            project_id=project_id,
            actor_user_id=str(user_id),
            event_type="TASK_COMMENT_ADDED",
            previous_status=task.get("status"),
            new_status=task.get("status"),
            previous_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            new_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            event_note="Comment added.",
        )
        watcher_user_ids = project_watcher_user_ids(project_watchers)
        task_name = normalize_optional_text(task.get("task_title")) or f"Task #{task_id}"
        actor_name = get_actor_display_name(supabase_admin, app_settings, user_id)
        role_notification_ids = watcher_user_ids[:]
        if project.get("stakeholder_id"):
            role_notification_ids.append(str(project["stakeholder_id"]))
        active_users = get_active_ref_users(supabase_admin, app_settings)
        mentioned_user_ids = extract_mentioned_user_ids(
            payload.comment_text,
            active_users,
            app_settings,
        )
        mentioned_user_id_set = {
            str(mentioned_user_id)
            for mentioned_user_id in mentioned_user_ids
            if str(mentioned_user_id) != str(user_id)
        }
        notify_user_ids(
            supabase_admin,
            app_settings,
            role_notification_ids,
            f"New reply on {task_name}"
            if payload.parent_comment_id
            else f"New comment on {task_name}",
            f'{actor_name} added a reply on "{task_name}".'
            if payload.parent_comment_id
            else f'{actor_name} added a comment on "{task_name}".',
            "TASK",
            task_id,
            target_url=get_task_target_url(task_id),
            exclude_user_ids={str(user_id), *mentioned_user_id_set},
        )
        notify_user_ids(
            supabase_admin,
            app_settings,
            list(mentioned_user_id_set),
            f"{actor_name} mentioned you",
            f'{actor_name} mentioned you in "{task_name}".',
            "TASK",
            task_id,
            target_url=get_task_target_url(task_id),
            exclude_user_ids={str(user_id)},
        )

        invalidate_task_cache(task_id, project_id)
        response = MessageResponse(detail="Comment added successfully.")
        cache_command_response(
            "create-comment",
            str(user_id),
            payload.idempotency_key,
            response,
        )
        return response

    @app.post("/tasks/{task_id}/work-logs", response_model=MessageResponse)
    def create_task_work_log(
        task_id: int,
        payload: CreateTaskWorkLogRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )
        cached_response = get_cached_command_response(
            "create-work-log",
            str(user_id),
            payload.idempotency_key,
        )
        if cached_response is not None:
            return cached_response

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        project = get_project_by_id(supabase_admin, project_id)

        if str(task.get("assigned_to") or "") != str(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the task assignee can log work on this task.",
            )

        if str(task.get("status") or "").upper() != TASK_STATUS_IN_PROGRESS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Work can only be logged while the task is in progress.",
            )

        parsed_work_date = (
            parse_iso_date_value(payload.work_date, "Work date")
            if payload.work_date
            else today_utc()
        )
        if parsed_work_date > today_utc():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Work date cannot be in the future.",
            )
        work_date = parsed_work_date.isoformat()

        supabase_admin.table(TASK_WORK_LOGS_TABLE).insert(
            {
                "task_id": task_id,
                "logged_by": user_id,
                "work_date": work_date,
                "hours": payload.hours,
                "work_note": payload.work_note.strip(),
            }
        ).execute()
        insert_task_access_log(
            supabase_admin,
            task_id=task_id,
            project_id=project_id,
            actor_user_id=str(user_id),
            event_type="TASK_WORK_LOGGED",
            previous_status=task.get("status"),
            new_status=task.get("status"),
            previous_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            new_assignee_id=(
                str(task.get("assigned_to")) if task.get("assigned_to") else None
            ),
            event_note=f"{payload.hours} hours logged for {work_date}.",
        )
        if project.get("stakeholder_id"):
            task_name = normalize_optional_text(task.get("task_title")) or f"Task #{task_id}"
            actor_name = get_actor_display_name(supabase_admin, app_settings, user_id)
            notify_user_ids(
                supabase_admin,
                app_settings,
                [str(project["stakeholder_id"])],
                f"Work logged on {task_name}",
                f'{actor_name} logged {payload.hours}h on "{task_name}".',
                "TASK",
                task_id,
                target_url=get_task_target_url(task_id),
                exclude_user_ids={str(user_id)},
            )

        invalidate_task_cache(task_id, project_id)
        response = MessageResponse(detail="Work log added successfully.")
        cache_command_response(
            "create-work-log",
            str(user_id),
            payload.idempotency_key,
            response,
        )
        return response

    @app.delete("/access-logs", response_model=MessageResponse)
    def delete_access_logs(
        current_user: CurrentUser = Depends(require_admin),
        supabase_admin: Client = Depends(get_supabase_admin_client),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        delete_task_access_logs(supabase_admin)
        invalidate_task_cache()
        return MessageResponse(detail="Task access log deleted successfully.")

    return app


app = create_app()
