from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import Client

from app.config import Settings, get_settings
from app.schemas import (
    ErrorResponse,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    SignupRequest,
)
from app.supabase_client import get_supabase_client


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
        app_settings: Settings = Depends(get_settings),
    ) -> MessageResponse:
        normalized_email = payload.email.strip().lower()

        try:
            allowed_user_response = (
                supabase.table(app_settings.signup_allowed_users_table)
                .select(app_settings.signup_allowed_users_email_column)
                .eq(app_settings.signup_allowed_users_email_column, normalized_email)
                .limit(1)
                .execute()
            )
            allowed_users = getattr(allowed_user_response, "data", None)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not verify whether this email is approved for signup.",
            ) from exc

        if not allowed_users:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is not approved for signup.",
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

        return MessageResponse(detail="Signup successful. You can now sign in.")

    @app.post("/auth/login", response_model=LoginResponse)
    def login(
        payload: LoginRequest,
        supabase: Client = Depends(get_supabase_client),
    ) -> LoginResponse:
        normalized_email = payload.email.strip().lower()

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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            ) from exc

    return app


app = create_app()
