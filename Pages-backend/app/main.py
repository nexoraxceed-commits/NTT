from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client

from app.config import get_settings
from app.schemas import ErrorResponse, LoginRequest, LoginResponse
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

    @app.post("/auth/login", response_model=LoginResponse)
    def login(
        payload: LoginRequest,
        supabase: Client = Depends(get_supabase_client),
    ) -> LoginResponse:
        try:
            result = supabase.auth.sign_in_with_password(
                {
                    "email": payload.email,
                    "password": payload.password,
                }
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            ) from exc

        if not result.session or not result.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        return LoginResponse(
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            user_id=result.user.id,
            email=result.user.email,
        )

    return app


app = create_app()
