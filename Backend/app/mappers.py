from app.config import Settings
from app.constants import REF_USER_NAME_COLUMN
from app.schemas import WatcherResponse


def build_watcher_responses(
    watchers: list[dict],
    users_by_auth_uid: dict[str, dict],
    app_settings: Settings,
) -> list[WatcherResponse]:
    responses: list[WatcherResponse] = []
    for watcher in watchers:
        ref_user = users_by_auth_uid.get(str(watcher.get("user_id"))) or {}
        responses.append(
            WatcherResponse(
                email=ref_user.get(app_settings.signup_allowed_users_email_column),
                user_name=ref_user.get(REF_USER_NAME_COLUMN),
            )
        )

    return responses
