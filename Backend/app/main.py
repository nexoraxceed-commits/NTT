from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import Client

from app.config import Settings, get_settings
from app.schemas import (
    ErrorResponse,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    SignupRequest,
)
from app.supabase_client import get_supabase_admin_client, get_supabase_client


NORMAL_STATUS = "NORMAL"


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
                )
            )
        )
        .eq(app_settings.signup_allowed_users_email_column, email)
        .limit(1)
        .execute()
    )
    users = getattr(response, "data", None) or []
    return users[0] if users else None


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
            supabase.auth.sign_up(
                {
                    "email": normalized_email,
                    "password": payload.password,
                }
            )
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

    return app


app = create_app()
