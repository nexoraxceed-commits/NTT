from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
RESOURCES_ROOT = PROJECT_ROOT / "Resources"
load_dotenv(BACKEND_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str | None
    frontend_origin: str
    backend_cache_ttl_seconds: int
    backend_cache_users_ttl_seconds: int
    backend_cache_projects_ttl_seconds: int
    backend_cache_dashboard_ttl_seconds: int
    backend_cache_tasks_ttl_seconds: int
    backend_cache_notifications_ttl_seconds: int
    signup_confirmation_redirect_url: str
    password_reset_redirect_url: str
    signup_allowed_users_table: str
    signup_allowed_users_email_column: str
    signup_allowed_users_status_column: str
    mailjet_api_key: str | None
    mailjet_secret_key: str | None
    mailjet_from_email: str | None
    mailjet_from_name: str
    vapid_public_key: str | None
    vapid_private_key: str | None
    vapid_subject: str
    scheduler_secret: str | None


def _load_properties_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    properties: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        key, separator, value = line.partition("=")
        if not separator:
            continue

        properties[key.strip()] = value.strip()

    return properties


@lru_cache
def get_project_properties() -> dict[str, str]:
    properties: dict[str, str] = {}
    for file_name in (
        "RENDER.PROPERTIES",
        "SUPABASE.PROPERTIES",
        "CLOUDFLARE.PROPERTIES",
    ):
        properties.update(_load_properties_file(RESOURCES_ROOT / file_name))
    return properties


def _get_config_value(name: str, default: str | None = None) -> str | None:
    return os.getenv(name) or get_project_properties().get(name) or default


def _get_required_env(name: str) -> str:
    value = _get_config_value(name)
    if not value:
        raise RuntimeError(f"Missing required configuration value: {name}")
    return value


def _get_supabase_publishable_key() -> str:
    return _get_config_value("SUPABASE_PUBLISHABLE_KEY") or _get_required_env(
        "SUPABASE_ANON_KEY"
    )


def _get_supabase_secret_key() -> str | None:
    return _get_config_value("SUPABASE_SECRET_KEY") or _get_config_value(
        "SUPABASE_SERVICE_ROLE_KEY"
    )


def _get_int_config_value(name: str, default: int) -> int:
    raw_value = _get_config_value(name)
    if raw_value is None:
        return default

    try:
        return int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"Configuration value must be an integer: {name}") from exc


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=_get_required_env("SUPABASE_URL"),
        supabase_publishable_key=_get_supabase_publishable_key(),
        supabase_secret_key=_get_supabase_secret_key(),
        frontend_origin=_get_config_value(
            "FRONTEND_ORIGIN", "http://localhost:8000"
        ),
        backend_cache_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_TTL_SECONDS", 60
        ),
        backend_cache_users_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_USERS_TTL_SECONDS",
            _get_int_config_value("BACKEND_CACHE_TTL_SECONDS", 1800),
        ),
        backend_cache_projects_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_PROJECTS_TTL_SECONDS",
            _get_int_config_value("BACKEND_CACHE_TTL_SECONDS", 600),
        ),
        backend_cache_dashboard_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_DASHBOARD_TTL_SECONDS",
            _get_int_config_value("BACKEND_CACHE_TTL_SECONDS", 20),
        ),
        backend_cache_tasks_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_TASKS_TTL_SECONDS",
            _get_int_config_value("BACKEND_CACHE_TTL_SECONDS", 8),
        ),
        backend_cache_notifications_ttl_seconds=_get_int_config_value(
            "BACKEND_CACHE_NOTIFICATIONS_TTL_SECONDS",
            _get_int_config_value("BACKEND_CACHE_TTL_SECONDS", 8),
        ),
        signup_confirmation_redirect_url=_get_config_value(
            "SIGNUP_CONFIRMATION_REDIRECT_URL",
            _get_config_value("FRONTEND_ORIGIN", "http://localhost:8000"),
        ),
        password_reset_redirect_url=_get_config_value(
            "PASSWORD_RESET_REDIRECT_URL",
            "http://localhost:8000/reset-password.html",
        ),
        signup_allowed_users_table=_get_config_value(
            "SIGNUP_ALLOWED_USERS_TABLE", "REF_USERS"
        ),
        signup_allowed_users_email_column=_get_config_value(
            "SIGNUP_ALLOWED_USERS_EMAIL_COLUMN", "user_id"
        ),
        signup_allowed_users_status_column=_get_config_value(
            "SIGNUP_ALLOWED_USERS_STATUS_COLUMN", "status"
        ),
        mailjet_api_key=_get_config_value("MAILJET_API_KEY"),
        mailjet_secret_key=_get_config_value("MAILJET_SECRET_KEY"),
        mailjet_from_email=_get_config_value("MAILJET_FROM_EMAIL"),
        mailjet_from_name=_get_config_value("MAILJET_FROM_NAME", "Nexora"),
        vapid_public_key=_get_config_value("VAPID_PUBLIC_KEY"),
        vapid_private_key=_get_config_value("VAPID_PRIVATE_KEY"),
        vapid_subject=_get_config_value(
            "VAPID_SUBJECT", "mailto:noreply@nexora.local"
        ),
        scheduler_secret=_get_config_value("SCHEDULER_SECRET"),
    )
