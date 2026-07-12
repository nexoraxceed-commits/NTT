from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class CreateProjectRequest(BaseModel):
    project_name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    document_name: str | None = Field(default=None, max_length=160)
    document_url: str | None = Field(default=None, max_length=2000)
    assigned_to_email: str | None = Field(default=None, max_length=320)
    watcher_emails: list[str] = Field(default_factory=list)


class UpdateProjectRequest(BaseModel):
    description: str | None = Field(default=None, max_length=1000)
    document_name: str | None = Field(default=None, max_length=160)
    document_url: str | None = Field(default=None, max_length=2000)
    assigned_to_email: str | None = Field(default=None, max_length=320)
    watcher_emails: list[str] = Field(default_factory=list)


class CreateTaskRequest(BaseModel):
    task_title: str = Field(min_length=1, max_length=160)
    task_details: str | None = Field(default=None, max_length=1000)
    documents: str | None = Field(default=None, max_length=2000)
    assigned_to_email: str | None = Field(default=None, max_length=320)
    stakeholder_email: str | None = Field(default=None, max_length=320)
    watcher_emails: list[str] = Field(default_factory=list)


class UpdateTaskRequest(BaseModel):
    task_title: str | None = Field(default=None, max_length=160)
    task_details: str | None = Field(default=None, max_length=1000)
    documents: str | None = Field(default=None, max_length=2000)
    assigned_to_email: str | None = Field(default=None, max_length=320)
    stakeholder_email: str | None = Field(default=None, max_length=320)
    watcher_emails: list[str] = Field(default_factory=list)


class UpdateTaskStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=40)


class CreateTaskCommentRequest(BaseModel):
    comment_text: str = Field(min_length=1, max_length=1000)
    deliverable_url: str | None = Field(default=None, max_length=2000)


class ProjectUserResponse(BaseModel):
    email: str
    user_name: str | None = None


class ProjectMemberResponse(BaseModel):
    email: str | None = None
    user_name: str | None = None
    role: str


class WatcherResponse(BaseModel):
    email: str | None = None
    user_name: str | None = None


class ProjectSummaryResponse(BaseModel):
    id: int
    project_name: str
    description: str | None = None
    document_name: str | None = None
    document_url: str | None = None
    documents: str | None = None
    status: str
    assigned_to_email: str | None = None
    assigned_to_name: str | None = None
    assignees: list[ProjectMemberResponse]
    watchers: list[WatcherResponse] = Field(default_factory=list)
    can_edit: bool = False


class TaskSummaryResponse(BaseModel):
    id: int
    project_id: int
    task_title: str
    task_details: str | None = None
    documents: str | None = None
    assigned_to_email: str | None = None
    assigned_to_name: str | None = None
    stakeholder_email: str | None = None
    stakeholder_name: str | None = None
    watchers: list[WatcherResponse] = Field(default_factory=list)
    status: str


class TaskCommentResponse(BaseModel):
    id: int
    comment_text: str | None = None
    deliverable_url: str | None = None
    commented_by_email: str | None = None
    commented_by_name: str | None = None
    created_at: str | None = None


class TaskDetailResponse(TaskSummaryResponse):
    project_name: str
    comments: list[TaskCommentResponse]


class ProjectDetailResponse(ProjectSummaryResponse):
    tasks: list[TaskSummaryResponse]


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    email: str | None = None


class ErrorResponse(BaseModel):
    detail: str


class MessageResponse(BaseModel):
    detail: str
