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
    password_reset_redirect_url: str
    signup_allowed_users_table: str
    signup_allowed_users_email_column: str
    signup_allowed_users_status_column: str


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


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=_get_required_env("SUPABASE_URL"),
        supabase_publishable_key=_get_supabase_publishable_key(),
        supabase_secret_key=_get_supabase_secret_key(),
        frontend_origin=_get_config_value(
            "FRONTEND_ORIGIN", "http://localhost:8000"
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
    )
