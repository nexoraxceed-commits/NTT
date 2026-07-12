from datetime import date, datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import Client

from app.cache import backend_cache
from app.config import Settings, get_settings
from app.constants import (
    ACTIVE_STATUS,
    AUTH_UID_COLUMN,
    NORMAL_STATUS,
    NOTIFICATION_LOG_TABLE,
    PROJECT_MEMBERS_TABLE,
    PROJECT_ROLE_MEMBER,
    PROJECT_ROLE_OWNER,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASK_COMMENTS_TABLE,
    TASK_STATUS_CLOSED,
    TASK_STATUS_CLOSE_REQUESTED,
    TASK_STATUS_IN_PROGRESS,
    TASK_STATUS_OPEN,
    TASK_WORK_LOGS_TABLE,
    TASKS_TABLE,
)
from app.dependencies import get_current_user
from app.mappers import build_member_responses, build_watcher_responses
from app.repositories import (
    ensure_project_member,
    get_active_ref_users,
    get_project_by_id,
    get_project_members,
    get_project_members_for_projects,
    get_project_watchers,
    get_project_watchers_for_projects,
    get_ref_user,
    get_ref_users_by_emails,
    get_ref_users_by_auth_uids,
    get_task_by_id,
    get_task_watchers,
    get_task_watchers_for_tasks,
    get_task_work_logs,
    get_user_project_memberships,
    get_user_project_watchlist,
    replace_project_watchers,
    replace_task_watchers,
    sync_ref_user_auth_uid,
    update_ref_user_auth_uid,
    update_ref_user_status,
)
from app.schemas import (
    CreateTaskCommentRequest,
    CreateTaskWorkLogRequest,
    CreateProjectRequest,
    CreateTaskRequest,
    ErrorResponse,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    ProjectDetailResponse,
    ProjectSummaryResponse,
    ProjectUserResponse,
    SignupRequest,
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


def require_active_ref_user(
    supabase_admin: Client,
    app_settings: Settings,
    email: str,
    field_name: str,
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

    return ref_user


def resolve_active_user_ids(
    supabase_admin: Client,
    app_settings: Settings,
    emails: list[str],
    field_name: str,
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
        if current_status != NORMAL_STATUS or not auth_uid:
            invalid_emails.append(email)
            continue

        user_ids.append(str(auth_uid))

    if invalid_emails:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"These {field_name} users must be active and sign in once first: "
                f"{', '.join(invalid_emails)}"
            ),
        )

    return user_ids


def queue_notification_log(
    supabase_admin: Client,
    recipients: list[dict],
    subject: str,
    body: str,
    source_type: str,
    source_id: int,
    app_settings: Settings,
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
                "status": "PENDING",
                "source_type": source_type,
                "source_id": source_id,
            }
        )

    if rows:
        supabase_admin.table(NOTIFICATION_LOG_TABLE).insert(rows).execute()


def is_project_editor(project: dict, watchers: list[dict], user_id: str) -> bool:
    if project.get("assigned_to") and str(project.get("assigned_to")) == str(user_id):
        return True

    return any(str(watcher.get("user_id")) == str(user_id) for watcher in watchers)


def has_project_access(
    project: dict,
    members: list[dict],
    watchers: list[dict],
    user_id: str,
) -> bool:
    return (
        any(str(member.get("user_id")) == str(user_id) for member in members)
        or (
            project.get("stakeholder_id")
            and str(project.get("stakeholder_id")) == str(user_id)
        )
        or is_project_editor(project, watchers, user_id)
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
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already signed up. Please sign in.",
            )

        try:
            signup_result = supabase.auth.sign_up(
                {
                    "email": normalized_email,
                    "password": payload.password,
                }
            )
            signup_user = getattr(signup_result, "user", None)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not create account with this email and password.",
            ) from exc

        try:
            update_ref_user_status(
                supabase_admin,
                app_settings,
                normalized_email,
                NORMAL_STATUS,
            )
            if signup_user and getattr(signup_user, "id", None):
                update_ref_user_auth_uid(
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

        backend_cache.clear()
        return MessageResponse(detail="Signup successful. You can now sign in.")

    @app.post("/auth/forgot-password", response_model=MessageResponse)
    def forgot_password(
        payload: ForgotPasswordRequest,
        supabase: Client = Depends(get_supabase_client),
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        normalized_email = payload.email.strip().lower()

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

        try:
            ref_user = get_ref_user(supabase_admin, app_settings, normalized_email)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not verify whether this email is approved for sign in.",
            ) from exc

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
                detail="This email is not active for sign in.",
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
            )
            for user in users
            if user.get(app_settings.signup_allowed_users_email_column)
        ]
        backend_cache.set(
            cache_key,
            [user.model_dump() for user in response],
            app_settings.backend_cache_ttl_seconds,
        )
        return response

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

        memberships = get_user_project_memberships(supabase_admin, user_id)
        watchlist = get_user_project_watchlist(supabase_admin, user_id)
        assigned_project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select("id")
            .eq("assigned_to", user_id)
            .execute()
        )
        stakeholder_project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select("id")
            .eq("stakeholder_id", user_id)
            .execute()
        )
        project_ids = list(
            {
                *(
                    int(membership["project_id"])
                    for membership in memberships
                    if membership.get("project_id")
                ),
                *(
                    int(watch["project_id"])
                    for watch in watchlist
                    if watch.get("project_id")
                ),
                *(
                    int(project["id"])
                    for project in (getattr(assigned_project_response, "data", None) or [])
                    if project.get("id")
                ),
                *(
                    int(project["id"])
                    for project in (
                        getattr(stakeholder_project_response, "data", None) or []
                    )
                    if project.get("id")
                ),
            }
        )
        if not project_ids:
            return []

        project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select(
                "id,project_name,description,document_name,document_url,documents,"
                "status,assigned_to,stakeholder_id"
            )
            .in_("id", project_ids)
            .order("created_at", desc=True)
            .execute()
        )
        projects = getattr(project_response, "data", None) or []
        loaded_project_ids = [int(project["id"]) for project in projects]
        members_by_project = get_project_members_for_projects(
            supabase_admin,
            loaded_project_ids,
        )
        watchers_by_project = get_project_watchers_for_projects(
            supabase_admin,
            loaded_project_ids,
        )
        all_member_ids = [
            str(member["user_id"])
            for members in members_by_project.values()
            for member in members
            if member.get("user_id")
        ]
        all_member_ids.extend(
            str(watcher["user_id"])
            for watchers in watchers_by_project.values()
            for watcher in watchers
            if watcher.get("user_id")
        )
        all_member_ids.extend(
            str(project["assigned_to"])
            for project in projects
            if project.get("assigned_to")
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
                assigned_to_email=(
                    users_by_auth_uid.get(str(project.get("assigned_to")), {}).get(
                        app_settings.signup_allowed_users_email_column
                    )
                    if project.get("assigned_to")
                    else None
                ),
                assigned_to_name=(
                    users_by_auth_uid.get(str(project.get("assigned_to")), {}).get(
                        REF_USER_NAME_COLUMN
                    )
                    if project.get("assigned_to")
                    else None
                ),
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
                assignees=build_member_responses(
                    members_by_project.get(int(project["id"]), []),
                    users_by_auth_uid,
                    app_settings,
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
            app_settings.backend_cache_ttl_seconds,
        )
        return response

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
        members = get_project_members(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        if not has_project_access(project, members, project_watchers, user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this project.",
            )

        cache_key = f"projects:detail:{project_id}:{user_id}"
        cached_project = backend_cache.get(cache_key)
        if cached_project is not None:
            return ProjectDetailResponse(**cached_project)

        task_response = (
            supabase_admin.table(TASKS_TABLE)
            .select(
                "id,project_id,task_title,task_details,documents,assigned_to,"
                "stakeholder_id,status,start_date,end_date"
            )
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        tasks = getattr(task_response, "data", None) or []
        task_ids = [int(task["id"]) for task in tasks]
        task_watchers_by_task = get_task_watchers_for_tasks(supabase_admin, task_ids)
        user_ids = [
            str(member["user_id"]) for member in members if member.get("user_id")
        ]
        user_ids.extend(
            str(watcher["user_id"]) for watcher in project_watchers if watcher.get("user_id")
        )
        user_ids.extend(
            str(task["assigned_to"]) for task in tasks if task.get("assigned_to")
        )
        user_ids.extend(
            str(task["stakeholder_id"]) for task in tasks if task.get("stakeholder_id")
        )
        if project.get("stakeholder_id"):
            user_ids.append(str(project["stakeholder_id"]))
        user_ids.extend(
            str(watcher["user_id"])
            for watchers in task_watchers_by_task.values()
            for watcher in watchers
            if watcher.get("user_id")
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
            assigned_to_email=(
                users_by_auth_uid.get(str(project.get("assigned_to")), {}).get(
                    app_settings.signup_allowed_users_email_column
                )
                if project.get("assigned_to")
                else None
            ),
            assigned_to_name=(
                users_by_auth_uid.get(str(project.get("assigned_to")), {}).get(
                    REF_USER_NAME_COLUMN
                )
                if project.get("assigned_to")
                else None
            ),
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
            assignees=build_member_responses(members, users_by_auth_uid, app_settings),
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
                    status=task.get("status") or TASK_STATUS_OPEN,
                )
                for task in tasks
            ],
        )
        backend_cache.set(
            cache_key,
            response.model_dump(),
            app_settings.backend_cache_ttl_seconds,
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

        project = get_project_by_id(supabase_admin, project_id)
        project_watchers = get_project_watchers(supabase_admin, project_id)
        if not is_project_editor(project, project_watchers, user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the project assignee or watcher can edit this project.",
            )

        update_payload = {
            "description": normalize_optional_text(payload.description),
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
        }
        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        assigned_user_id = None
        if assigned_to_email:
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email,
                "project assignee",
            )
            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]
            update_payload["assigned_to"] = assigned_user_id

        stakeholder_email = normalize_optional_text(payload.stakeholder_email)
        if stakeholder_email:
            stakeholder_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                stakeholder_email.lower(),
                "project stakeholder",
            )
            update_payload["stakeholder_id"] = stakeholder_ref_user[AUTH_UID_COLUMN]
        elif payload.stakeholder_email == "":
            update_payload["stakeholder_id"] = None

        (
            supabase_admin.table(PROJECTS_TABLE)
            .update(update_payload)
            .eq("id", project_id)
            .execute()
        )

        if assigned_user_id:
            existing_members = get_project_members(supabase_admin, project_id)
            if not any(
                str(member.get("user_id")) == str(assigned_user_id)
                for member in existing_members
            ):
                (
                    supabase_admin.table(PROJECT_MEMBERS_TABLE)
                    .insert(
                        {
                            "project_id": project_id,
                            "user_id": assigned_user_id,
                            "role": PROJECT_ROLE_MEMBER,
                            "status": ACTIVE_STATUS,
                        }
                    )
                    .execute()
                )

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
        )
        replace_project_watchers(supabase_admin, project_id, watcher_user_ids)
        queue_notification_log(
            supabase_admin,
            list(
                get_ref_users_by_auth_uids(
                    supabase_admin,
                    app_settings,
                    watcher_user_ids,
                ).values()
            ),
            "Project updated",
            f"Project #{project_id} was updated.",
            "PROJECT",
            project_id,
            app_settings,
        )

        backend_cache.clear()
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

        assigned_to_email = (
            payload.assigned_to_email.strip().lower()
            if payload.assigned_to_email
            else None
        )
        assigned_ref_user = None
        assigned_user_id = user_id

        if assigned_to_email:
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email,
                "project assignee",
            )
            assigned_user_id = assigned_ref_user.get(AUTH_UID_COLUMN)

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
            )
            stakeholder_user_id = stakeholder_ref_user.get(AUTH_UID_COLUMN)

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
        )

        project_payload = {
            "project_name": payload.project_name.strip(),
            "description": payload.description.strip() if payload.description else None,
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
            "created_by": user_id,
            "assigned_to": assigned_user_id,
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
            member_rows = [
                {
                    "project_id": project_id,
                    "user_id": user_id,
                    "role": PROJECT_ROLE_OWNER,
                    "status": ACTIVE_STATUS,
                }
            ]

            if assigned_user_id and assigned_user_id != user_id:
                member_rows.append(
                    {
                        "project_id": project_id,
                        "user_id": assigned_user_id,
                        "role": PROJECT_ROLE_MEMBER,
                        "status": ACTIVE_STATUS,
                    }
                )

            supabase_admin.table(PROJECT_MEMBERS_TABLE).insert(member_rows).execute()
            replace_project_watchers(supabase_admin, project_id, watcher_user_ids)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Project was created, but project members could not be "
                    f"assigned: {exc}"
                ),
            ) from exc

        backend_cache.clear()
        return MessageResponse(detail="Project created successfully.")

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

        ensure_project_member(supabase_admin, project_id, user_id)
        assigned_user_id = None
        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        if assigned_to_email:
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
                "task assignee",
            )
            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]

        stakeholder_user_id = None
        stakeholder_email = normalize_optional_text(payload.stakeholder_email)
        if stakeholder_email:
            stakeholder_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                stakeholder_email.lower(),
                "stakeholder",
            )
            stakeholder_user_id = stakeholder_ref_user[AUTH_UID_COLUMN]

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
        )
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
                    "stakeholder_id": stakeholder_user_id,
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
            replace_task_watchers(supabase_admin, task_id, watcher_user_ids)

        backend_cache.clear()
        return MessageResponse(detail="Task created successfully.")

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

        task = get_task_by_id(supabase_admin, task_id)
        project_id = int(task["project_id"])
        ensure_project_member(supabase_admin, project_id, user_id)

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

        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        if assigned_to_email:
            assigned_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
                "task assignee",
            )
            update_payload["assigned_to"] = assigned_ref_user[AUTH_UID_COLUMN]
        elif payload.assigned_to_email == "":
            update_payload["assigned_to"] = None

        stakeholder_email = normalize_optional_text(payload.stakeholder_email)
        if stakeholder_email:
            stakeholder_ref_user = require_active_ref_user(
                supabase_admin,
                app_settings,
                stakeholder_email.lower(),
                "stakeholder",
            )
            update_payload["stakeholder_id"] = stakeholder_ref_user[AUTH_UID_COLUMN]
        elif payload.stakeholder_email == "":
            update_payload["stakeholder_id"] = None

        if update_payload:
            (
                supabase_admin.table(TASKS_TABLE)
                .update(update_payload)
                .eq("id", task_id)
                .execute()
            )

        watcher_user_ids = resolve_active_user_ids(
            supabase_admin,
            app_settings,
            payload.watcher_emails,
            "watcher",
        )
        replace_task_watchers(supabase_admin, task_id, watcher_user_ids)
        queue_notification_log(
            supabase_admin,
            list(
                get_ref_users_by_auth_uids(
                    supabase_admin,
                    app_settings,
                    watcher_user_ids,
                ).values()
            ),
            "Task updated",
            f"Task #{task_id} was updated.",
            "TASK",
            task_id,
            app_settings,
        )

        backend_cache.clear()
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
        ensure_project_member(supabase_admin, project_id, user_id)
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

        if requested_status in {
            TASK_STATUS_IN_PROGRESS,
            TASK_STATUS_CLOSE_REQUESTED,
        } and str(task.get("assigned_to")) != str(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assignee can move this task to that status.",
            )

        if requested_status == TASK_STATUS_CLOSED and str(
            task.get("stakeholder_id")
        ) != str(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the stakeholder can close this task.",
            )

        status_payload = {"status": requested_status}
        if requested_status == TASK_STATUS_IN_PROGRESS and not task.get("start_date"):
            status_payload["start_date"] = datetime.now(timezone.utc).isoformat()

        supabase_admin.table(TASKS_TABLE).update(status_payload).eq("id", task_id).execute()

        if requested_status == TASK_STATUS_CLOSE_REQUESTED and task.get(
            "stakeholder_id"
        ):
            recipients = get_ref_users_by_auth_uids(
                supabase_admin,
                app_settings,
                [str(task["stakeholder_id"])],
            )
            queue_notification_log(
                supabase_admin,
                list(recipients.values()),
                "Task close requested",
                f"Task #{task_id} is ready for stakeholder review.",
                "TASK",
                task_id,
                app_settings,
            )

        task_watchers = get_task_watchers(supabase_admin, task_id)
        watcher_user_ids = [
            str(watcher["user_id"])
            for watcher in task_watchers
            if watcher.get("user_id")
        ]
        queue_notification_log(
            supabase_admin,
            list(
                get_ref_users_by_auth_uids(
                    supabase_admin,
                    app_settings,
                    watcher_user_ids,
                ).values()
            ),
            "Task status updated",
            f"Task #{task_id} status changed to {requested_status}.",
            "TASK",
            task_id,
            app_settings,
        )

        backend_cache.clear()
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
        ensure_project_member(supabase_admin, project_id, user_id)
        cache_key = f"tasks:detail:{task_id}"
        cached_task = backend_cache.get(cache_key)
        if cached_task is not None:
            return TaskDetailResponse(**cached_task)

        project = get_project_by_id(supabase_admin, project_id)

        comment_response = (
            supabase_admin.table(TASK_COMMENTS_TABLE)
            .select("id,created_at,task_id,commented_by,comment_text,deliverable_url")
            .eq("task_id", task_id)
            .order("created_at", desc=False)
            .execute()
        )
        comments = getattr(comment_response, "data", None) or []
        work_logs = get_task_work_logs(supabase_admin, task_id)
        task_watchers = get_task_watchers(supabase_admin, task_id)
        user_ids = []
        if task.get("assigned_to"):
            user_ids.append(str(task["assigned_to"]))
        if task.get("stakeholder_id"):
            user_ids.append(str(task["stakeholder_id"]))
        user_ids.extend(
            str(watcher["user_id"]) for watcher in task_watchers if watcher.get("user_id")
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
                task_watchers,
                users_by_auth_uid,
                app_settings,
            ),
            status=task.get("status") or TASK_STATUS_OPEN,
            comments=[
                TaskCommentResponse(
                    id=comment["id"],
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
        )
        backend_cache.set(
            cache_key,
            response.model_dump(),
            app_settings.backend_cache_ttl_seconds,
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

        task = get_task_by_id(supabase_admin, task_id)
        ensure_project_member(supabase_admin, int(task["project_id"]), user_id)
        (
            supabase_admin.table(TASK_COMMENTS_TABLE)
            .insert(
                {
                    "task_id": task_id,
                    "commented_by": user_id,
                    "comment_text": payload.comment_text.strip(),
                    "deliverable_url": normalize_optional_text(payload.deliverable_url),
                }
            )
            .execute()
        )
        task_watchers = get_task_watchers(supabase_admin, task_id)
        watcher_user_ids = [
            str(watcher["user_id"])
            for watcher in task_watchers
            if watcher.get("user_id")
        ]
        queue_notification_log(
            supabase_admin,
            list(
                get_ref_users_by_auth_uids(
                    supabase_admin,
                    app_settings,
                    watcher_user_ids,
                ).values()
            ),
            "Task comment added",
            f"A comment was added to task #{task_id}.",
            "TASK",
            task_id,
            app_settings,
        )

        backend_cache.clear()
        return MessageResponse(detail="Comment added successfully.")

    @app.post("/tasks/{task_id}/work-logs", response_model=MessageResponse)
    def create_task_work_log(
        task_id: int,
        payload: CreateTaskWorkLogRequest,
        current_user: object = Depends(get_current_user),
        supabase_admin: Client = Depends(get_supabase_admin_client),
    ) -> MessageResponse:
        user_id = getattr(current_user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please sign in again.",
            )

        task = get_task_by_id(supabase_admin, task_id)
        ensure_project_member(supabase_admin, int(task["project_id"]), user_id)
        work_date = (
            parse_iso_date(payload.work_date, "Work date")
            if payload.work_date
            else date.today().isoformat()
        )
        supabase_admin.table(TASK_WORK_LOGS_TABLE).insert(
            {
                "task_id": task_id,
                "logged_by": user_id,
                "work_date": work_date,
                "hours": payload.hours,
                "work_note": payload.work_note.strip(),
            }
        ).execute()

        backend_cache.clear()
        return MessageResponse(detail="Work log added successfully.")

    return app


app = create_app()
