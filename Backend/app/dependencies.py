from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from supabase import Client

from app.config import Settings, get_settings
from app.constants import (
    AUTH_UID_COLUMN,
    NORMAL_STATUS,
    USER_CLASS_ADMIN,
    USER_CLASS_COLUMN,
)
from app.repositories import get_ref_user
from app.supabase_client import get_supabase_admin_client


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    user_class: str
    status: str
    user_name: str | None = None


def get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token.",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header.",
        )

    return token


def get_current_user(
    authorization: str | None = Header(default=None),
    supabase_admin: Client = Depends(get_supabase_admin_client),
    app_settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = get_bearer_token(authorization)

    try:
        result = supabase_admin.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        ) from exc

    user = getattr(result, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    user_id = str(getattr(user, "id", "") or "")
    email = str(getattr(user, "email", "") or "").strip().lower()
    ref_user = get_ref_user(supabase_admin, app_settings, email) if email else None
    current_status = str(
        (ref_user or {}).get(app_settings.signup_allowed_users_status_column) or ""
    ).upper()
    linked_auth_uid = str((ref_user or {}).get(AUTH_UID_COLUMN) or "")
    user_class = str((ref_user or {}).get(USER_CLASS_COLUMN) or "").upper()
    if (
        not ref_user
        or current_status != NORMAL_STATUS
        or not linked_auth_uid
        or linked_auth_uid != user_id
        or user_class not in {"ADMIN", "SENIOR", "JUNIOR"}
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not active or is not linked correctly.",
        )

    return CurrentUser(
        id=user_id,
        email=email,
        user_class=user_class,
        status=current_status,
        user_name=ref_user.get("user_name"),
    )


def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.user_class != USER_CLASS_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )
    return current_user
