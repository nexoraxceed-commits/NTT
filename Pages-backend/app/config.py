from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_publishable_key: str
    frontend_origin: str


def _get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _get_supabase_publishable_key() -> str:
    return os.getenv("SUPABASE_PUBLISHABLE_KEY") or _get_required_env(
        "SUPABASE_ANON_KEY"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=_get_required_env("SUPABASE_URL"),
        supabase_publishable_key=_get_supabase_publishable_key(),
        frontend_origin=os.getenv("FRONTEND_ORIGIN", "http://localhost:8000"),
    )
