"""Six-digit email codes for first-time sign-up and password reset.

Codes are sent by NTT itself through Mailjet, so they do not depend on
Supabase's built-in mailer (which only delivers to the Supabase project's own
team members and is limited to a few emails an hour).

Codes are stateless: an HMAC of (purpose, email, 10-minute window) keyed with
the backend's secret. A code is accepted in its own window and the next one,
so it stays valid for 10-20 minutes and survives server restarts. Guessing is
limited by the per-email rate limit on verification.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import logging
import time

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 600
MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send"

PURPOSES = {
    "signup": {
        "subject": "Your Nexora sign-up code: {code}",
        "title": "Confirm your email",
        "line": "Use this code to finish creating your Nexora account.",
    },
    "reset": {
        "subject": "Your Nexora password reset code: {code}",
        "title": "Reset your password",
        "line": "Use this code to set a new password for your Nexora account.",
    },
}


def email_codes_available(app_settings: Settings) -> bool:
    return bool(
        app_settings.mailjet_api_key
        and app_settings.mailjet_secret_key
        and app_settings.mailjet_from_email
        and app_settings.supabase_secret_key
    )


def _code_for(app_settings: Settings, purpose: str, email: str, window: int) -> str:
    key = hashlib.sha256(
        f"ntt-email-code:{app_settings.supabase_secret_key}".encode("utf-8")
    ).digest()
    message = f"{purpose}:{email.strip().lower()}:{window}".encode("utf-8")
    digest = hmac.new(key, message, hashlib.sha256).digest()
    return f"{int.from_bytes(digest[:8], 'big') % 1_000_000:06d}"


def make_code(app_settings: Settings, purpose: str, email: str, now: float | None = None) -> str:
    window = int((now if now is not None else time.time()) // WINDOW_SECONDS)
    return _code_for(app_settings, purpose, email, window)


def verify_code(
    app_settings: Settings,
    purpose: str,
    email: str,
    code: str,
    now: float | None = None,
) -> bool:
    candidate = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(candidate) != 6:
        return False
    window = int((now if now is not None else time.time()) // WINDOW_SECONDS)
    return any(
        hmac.compare_digest(candidate, _code_for(app_settings, purpose, email, w))
        for w in (window, window - 1)
    )


LAST_ERROR: dict[str, str] = {"detail": ""}


def _explain_mailjet(status_code: int, text: str) -> str:
    """Turn Mailjet's reply into a plain-English reason for admins."""
    lowered = text.lower()
    if status_code == 401:
        return "Mailjet rejected the API keys (401). Check MAILJET_API_KEY and MAILJET_SECRET_KEY on Render."
    if "sender" in lowered and ("not" in lowered and ("valid" in lowered or "authoriz" in lowered or "allowed" in lowered)):
        return (
            "Mailjet says the sender address isn't verified. In Mailjet go to Account settings -> "
            "Senders & domains and verify the MAILJET_FROM_EMAIL address."
        )
    if "suspend" in lowered or "blocked" in lowered or "under review" in lowered or "pending" in lowered:
        return "Mailjet has the account suspended or under review. Check the Mailjet dashboard for a notice."
    if status_code == 429 or "rate" in lowered:
        return "Mailjet's sending limit was reached. Free accounts allow 200 emails a day and 6,000 a month."
    return f"Mailjet returned {status_code}: {text[:300]}"


def send_code_email(
    app_settings: Settings,
    purpose: str,
    email: str,
    name: str | None = None,
) -> bool:
    """Send the current code. Returns False if Mailjet refused or is not set up."""
    LAST_ERROR["detail"] = ""
    if not email_codes_available(app_settings):
        LAST_ERROR["detail"] = "Mailjet keys or sender are missing on the server."
        return False
    copy = PURPOSES[purpose]
    code = make_code(app_settings, purpose, email)
    greeting = f"Hi {name}," if name else "Hi,"
    text = (
        f"{greeting}\n\n{copy['line']}\n\n{code}\n\n"
        "It works for the next 10 minutes. If you didn't ask for this, you can ignore this email.\n\n— Nexora"
    )
    html_part = (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#1c1c1e">'
        f'<p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.08em;color:#0a6cf5;text-transform:uppercase">Nexora</p>'
        f'<h1 style="margin:0 0 12px;font-size:22px">{html.escape(copy["title"])}</h1>'
        f'<p style="margin:0 0 16px;line-height:1.5">{html.escape(greeting)} {html.escape(copy["line"])}</p>'
        f'<p style="margin:0 0 16px;padding:14px 0;border-radius:12px;background:#f2f2f7;text-align:center;'
        f'font-size:32px;font-weight:700;letter-spacing:.3em">{code}</p>'
        '<p style="margin:0;color:#6e6e73;font-size:13px;line-height:1.5">It works for the next 10 minutes. '
        "If you didn't ask for this, you can ignore this email.</p></div>"
    )
    message = {
        "From": {"Email": app_settings.mailjet_from_email, "Name": app_settings.mailjet_from_name},
        "To": [{"Email": email, "Name": name or email}],
        "Subject": copy["subject"].format(code=code),
        "TextPart": text,
        "HTMLPart": html_part,
        "CustomID": f"ntt-{purpose}-code",
    }
    try:
        response = httpx.post(
            MAILJET_SEND_URL,
            auth=(app_settings.mailjet_api_key or "", app_settings.mailjet_secret_key or ""),
            json={"Messages": [message]},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        logger.exception("Mailjet request failed for %s code", purpose)
        LAST_ERROR["detail"] = f"Couldn't reach Mailjet: {exc}"
        return False
    if response.status_code >= 400:
        logger.warning("Mailjet rejected %s code email: %s %s", purpose, response.status_code, response.text[:500])
        LAST_ERROR["detail"] = _explain_mailjet(response.status_code, response.text)
        return False
    try:
        status_value = response.json()["Messages"][0]["Status"]
    except Exception:
        status_value = "unknown"
    if str(status_value).lower() != "success":
        logger.warning("Mailjet did not accept %s code email: %s", purpose, response.text[:500])
        LAST_ERROR["detail"] = _explain_mailjet(response.status_code, response.text)
        return False
    return True
