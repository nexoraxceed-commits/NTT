from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import Client

from app.config import Settings, get_settings
from app.constants import (
    AUTH_UID_COLUMN,
    NORMAL_STATUS,
    PROJECT_MEMBERS_TABLE,
    PROJECTS_TABLE,
    REF_USER_NAME_COLUMN,
    TASK_COMMENTS_TABLE,
    TASKS_TABLE,
)
from app.dependencies import get_current_user
from app.mappers import build_member_responses
from app.repositories import (
    ensure_project_member,
    get_active_ref_users,
    get_project_by_id,
    get_project_members,
    get_ref_user,
    get_ref_users_by_auth_uids,
    get_task_by_id,
    get_user_project_memberships,
    sync_ref_user_auth_uid,
    update_ref_user_auth_uid,
    update_ref_user_status,
)
from app.schemas import (
    CreateTaskCommentRequest,
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
    UpdateProjectRequest,
)
from app.supabase_client import get_supabase_admin_client, get_supabase_client
from app.utils import normalize_optional_text


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
        try:
            users = get_active_ref_users(supabase_admin, app_settings)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not load project users.",
            ) from exc

        return [
            ProjectUserResponse(
                email=user.get(app_settings.signup_allowed_users_email_column),
                user_name=user.get(REF_USER_NAME_COLUMN),
            )
            for user in users
            if user.get(app_settings.signup_allowed_users_email_column)
        ]

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

        memberships = get_user_project_memberships(supabase_admin, user_id)
        project_ids = [membership["project_id"] for membership in memberships]
        if not project_ids:
            return []

        project_response = (
            supabase_admin.table(PROJECTS_TABLE)
            .select("id,project_name,description,document_name,document_url,documents,status")
            .in_("id", project_ids)
            .order("created_at", desc=True)
            .execute()
        )
        projects = getattr(project_response, "data", None) or []
        members_by_project: dict[int, list[dict]] = {}
        all_member_ids: list[str] = []

        for project in projects:
            members = get_project_members(supabase_admin, int(project["id"]))
            members_by_project[int(project["id"])] = members
            all_member_ids.extend(
                str(member["user_id"]) for member in members if member.get("user_id")
            )

        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            all_member_ids,
        )

        return [
            ProjectSummaryResponse(
                id=project["id"],
                project_name=project["project_name"],
                description=project.get("description"),
                document_name=project.get("document_name"),
                document_url=project.get("document_url"),
                documents=project.get("documents"),
                status=project.get("status") or "ACTIVE",
                assignees=build_member_responses(
                    members_by_project.get(int(project["id"]), []),
                    users_by_auth_uid,
                    app_settings,
                ),
            )
            for project in projects
        ]

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

        ensure_project_member(supabase_admin, project_id, user_id)
        project = get_project_by_id(supabase_admin, project_id)
        members = get_project_members(supabase_admin, project_id)

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
        user_ids = [
            str(member["user_id"]) for member in members if member.get("user_id")
        ]
        user_ids.extend(
            str(task["assigned_to"]) for task in tasks if task.get("assigned_to")
        )
        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            user_ids,
        )

        return ProjectDetailResponse(
            id=project["id"],
            project_name=project["project_name"],
            description=project.get("description"),
            document_name=project.get("document_name"),
            document_url=project.get("document_url"),
            documents=project.get("documents"),
            status=project.get("status") or "ACTIVE",
            assignees=build_member_responses(members, users_by_auth_uid, app_settings),
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
                    status=task.get("status") or "TODO",
                )
                for task in tasks
            ],
        )

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

        ensure_project_member(supabase_admin, project_id, user_id)
        update_payload = {
            "description": normalize_optional_text(payload.description),
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
        }
        (
            supabase_admin.table(PROJECTS_TABLE)
            .update(update_payload)
            .eq("id", project_id)
            .execute()
        )

        assigned_to_email = normalize_optional_text(payload.assigned_to_email)
        if assigned_to_email:
            assigned_ref_user = get_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
            )
            if not assigned_ref_user or not assigned_ref_user.get(AUTH_UID_COLUMN):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected assignee must sign in once before assignment.",
                )

            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]
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
                            "role": "MEMBER",
                            "status": "ACTIVE",
                        }
                    )
                    .execute()
                )

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
        assigned_user_id = None

        if assigned_to_email:
            assigned_ref_user = get_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email,
            )
            if not assigned_ref_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected assignee is not registered.",
                )

            assigned_status = str(
                assigned_ref_user.get(app_settings.signup_allowed_users_status_column)
                or ""
            ).upper()
            if assigned_status != NORMAL_STATUS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected assignee is not active.",
                )

            assigned_user_id = assigned_ref_user.get(AUTH_UID_COLUMN)
            if not assigned_user_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Selected assignee must sign in once before they can be "
                        "assigned to a project."
                    ),
                )

        project_payload = {
            "project_name": payload.project_name.strip(),
            "description": payload.description.strip() if payload.description else None,
            "document_name": normalize_optional_text(payload.document_name),
            "document_url": normalize_optional_text(payload.document_url),
            "created_by": user_id,
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
            (
                supabase_admin.table(PROJECT_MEMBERS_TABLE)
                .insert(
                    {
                        "project_id": project_id,
                        "user_id": user_id,
                        "role": "OWNER",
                        "status": "ACTIVE",
                    }
                )
                .execute()
            )

            if assigned_user_id and assigned_user_id != user_id:
                (
                    supabase_admin.table(PROJECT_MEMBERS_TABLE)
                    .insert(
                        {
                            "project_id": project_id,
                            "user_id": assigned_user_id,
                            "role": "MEMBER",
                            "status": "ACTIVE",
                        }
                    )
                    .execute()
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Project was created, but project members could not be "
                    f"assigned: {exc}"
                ),
            ) from exc

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
            assigned_ref_user = get_ref_user(
                supabase_admin,
                app_settings,
                assigned_to_email.lower(),
            )
            if not assigned_ref_user or not assigned_ref_user.get(AUTH_UID_COLUMN):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected assignee must sign in once before assignment.",
                )

            assigned_user_id = assigned_ref_user[AUTH_UID_COLUMN]

        (
            supabase_admin.table(TASKS_TABLE)
            .insert(
                {
                    "project_id": project_id,
                    "task_title": payload.task_title.strip(),
                    "task_details": normalize_optional_text(payload.task_details),
                    "documents": normalize_optional_text(payload.documents),
                    "assigned_to": assigned_user_id,
                    "created_by": user_id,
                    "status": "TODO",
                }
            )
            .execute()
        )

        return MessageResponse(detail="Task created successfully.")

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
        project = get_project_by_id(supabase_admin, project_id)

        comment_response = (
            supabase_admin.table(TASK_COMMENTS_TABLE)
            .select("id,created_at,task_id,commented_by,comment_text,deliverable_url")
            .eq("task_id", task_id)
            .order("created_at", desc=False)
            .execute()
        )
        comments = getattr(comment_response, "data", None) or []
        user_ids = []
        if task.get("assigned_to"):
            user_ids.append(str(task["assigned_to"]))
        user_ids.extend(
            str(comment["commented_by"])
            for comment in comments
            if comment.get("commented_by")
        )
        users_by_auth_uid = get_ref_users_by_auth_uids(
            supabase_admin,
            app_settings,
            user_ids,
        )
        assigned_ref_user = users_by_auth_uid.get(str(task.get("assigned_to"))) or {}

        return TaskDetailResponse(
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
            status=task.get("status") or "TODO",
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
        )

    @app.post("/tasks/{task_id}/comments", response_model=MessageResponse)
    def create_task_comment(
        task_id: int,
        payload: CreateTaskCommentRequest,
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

        return MessageResponse(detail="Comment added successfully.")

    return app


app = create_app()
