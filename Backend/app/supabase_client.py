from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_publishable_key)


@lru_cache
def get_supabase_admin_client() -> Client:
    settings = get_settings()
    if not settings.supabase_secret_key:
        raise RuntimeError("Missing required configuration value: SUPABASE_SECRET_KEY")

    return create_client(settings.supabase_url, settings.supabase_secret_key)
