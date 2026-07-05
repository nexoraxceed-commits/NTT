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
    documents: str | None = Field(default=None, max_length=2000)
    assigned_to_email: str | None = Field(default=None, max_length=320)


class ProjectUserResponse(BaseModel):
    email: str
    user_name: str | None = None


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
