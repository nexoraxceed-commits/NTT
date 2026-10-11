from threading import Lock

from supabase import Client, create_client

from app.config import get_settings

_admin_client: Client | None = None
_admin_client_lock = Lock()


def get_supabase_client() -> Client:
    # The publishable-key client signs users in, which stores that user's
    # session on the client, so each auth request gets its own instance.
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_publishable_key)


def get_supabase_admin_client() -> Client:
    # The service client never holds a user session, so one instance is shared
    # by every request. Reusing it keeps the HTTP connections to Supabase open
    # instead of paying a fresh TLS handshake on each call.
    global _admin_client
    if _admin_client is not None:
        return _admin_client

    settings = get_settings()
    if not settings.supabase_secret_key:
        raise RuntimeError("Missing required configuration value: SUPABASE_SECRET_KEY")

    with _admin_client_lock:
        if _admin_client is None:
            _admin_client = create_client(settings.supabase_url, settings.supabase_secret_key)
    return _admin_client
