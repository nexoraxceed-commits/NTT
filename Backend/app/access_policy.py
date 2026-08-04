from app.constants import USER_CLASS_REDUNDANT


def is_request_allowed_for_user_class(
    user_class: str,
    method: str,
    path: str,
) -> bool:
    if user_class != USER_CLASS_REDUNDANT:
        return True
    return method.upper() in {"GET", "HEAD", "OPTIONS"} or path == "/auth/logout"
