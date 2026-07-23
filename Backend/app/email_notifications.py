import html
import logging

import httpx

from app.config import Settings


logger = logging.getLogger(__name__)
MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send"


def send_mailjet_notification(
    app_settings: Settings,
    recipient_email: str,
    recipient_name: str | None,
    subject: str,
    body: str,
    target_url: str | None = None,
) -> bool:
    """Send a transactional notification without breaking the saved action."""
    if not (
        app_settings.mailjet_api_key
        and app_settings.mailjet_secret_key
        and app_settings.mailjet_from_email
    ):
        logger.info("Mailjet is not configured; notification email skipped.")
        return False

    action_url = None
    if target_url:
        action_url = (
            target_url
            if target_url.startswith(("http://", "https://"))
            else f"{app_settings.frontend_origin.rstrip('/')}/{target_url.lstrip('/')}"
        )

    safe_body = html.escape(body)
    html_part = (
        '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">'
        f"<p>{safe_body}</p>"
    )
    if action_url:
        html_part += (
            f'<p><a href="{html.escape(action_url, quote=True)}" '
            'style="display:inline-block;padding:10px 16px;background:#155eef;'
            'color:#fff;text-decoration:none;border-radius:6px">View task</a></p>'
        )
    html_part += "<p>— Nexora</p></div>"

    message = {
        "From": {
            "Email": app_settings.mailjet_from_email,
            "Name": app_settings.mailjet_from_name,
        },
        "To": [{"Email": recipient_email, "Name": recipient_name or recipient_email}],
        "Subject": subject,
        "TextPart": f"{body}\n\n{action_url or ''}\n\n— Nexora".strip(),
        "HTMLPart": html_part,
    }

    try:
        response = httpx.post(
            MAILJET_SEND_URL,
            auth=(app_settings.mailjet_api_key, app_settings.mailjet_secret_key),
            json={"Messages": [message]},
            timeout=10.0,
        )
        response.raise_for_status()
        return True
    except Exception:
        logger.exception("Mailjet notification delivery failed for %s.", recipient_email)
        return False
