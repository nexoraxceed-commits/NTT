"""User profile details collected on the welcome screen.

Columns live on REF_USERS (see Resources/20261027_USER_PROFILES.sql). Every
read here tolerates the columns not existing yet, so the app keeps working
if the backend is deployed before that script is run.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.config import Settings

PROFILE_COLUMNS = ("vertical", "roll_no", "phone", "linkedin_url", "skills", "onboarded_at")
VERTICALS = {"PSO", "VAD", "IPR", "VOC"}


class ProfileResponse(BaseModel):
    email: str
    user_name: str | None = None
    user_class: str
    vertical: str | None = None
    roll_no: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    skills: str | None = None
    onboarded: bool = False
    profiles_available: bool = True


class ProfileUpdateRequest(BaseModel):
    vertical: str | None = Field(default=None, max_length=10)
    roll_no: str | None = Field(default=None, max_length=30)
    phone: str | None = Field(default=None, max_length=30)
    linkedin_url: str | None = Field(default=None, max_length=300)
    skills: str | None = Field(default=None, max_length=500)
    mark_onboarded: bool = True

    @field_validator("vertical")
    @classmethod
    def _vertical(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip().upper()
        if value not in VERTICALS:
            raise ValueError("Pick one of PSO, VAD, IPR or VOC.")
        return value

    @field_validator("roll_no")
    @classmethod
    def _roll(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{1,4}\d{4,6}", value):
            raise ValueError("Roll number looks like B26182.")
        return value

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        digits = re.sub(r"[^\d+]", "", value)
        if not re.fullmatch(r"\+?\d{10,13}", digits):
            raise ValueError("Enter a 10-digit phone number, with country code if outside India.")
        return digits

    @field_validator("linkedin_url")
    @classmethod
    def _linkedin(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not value.startswith("http"):
            value = "https://" + value
        if "linkedin.com/" not in value.lower():
            raise ValueError("Paste your LinkedIn profile link.")
        return value

    @field_validator("skills")
    @classmethod
    def _skills(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


def get_profiles_by_email(supabase: Client, app_settings: Settings) -> dict[str, dict] | None:
    """email -> profile columns, or None if the columns don't exist yet."""
    email_column = app_settings.signup_allowed_users_email_column
    try:
        response = (
            supabase.table(app_settings.signup_allowed_users_table)
            .select(",".join((email_column, *PROFILE_COLUMNS)))
            .execute()
        )
    except Exception:
        return None
    rows = getattr(response, "data", None) or []
    return {
        str(row.get(email_column) or "").lower(): row
        for row in rows
        if row.get(email_column)
    }


def update_profile(
    supabase: Client,
    app_settings: Settings,
    email: str,
    payload: ProfileUpdateRequest,
) -> None:
    values: dict[str, object] = {
        "vertical": payload.vertical,
        "roll_no": payload.roll_no,
        "phone": payload.phone,
        "linkedin_url": payload.linkedin_url,
        "skills": payload.skills,
    }
    if payload.mark_onboarded:
        values["onboarded_at"] = datetime.now(timezone.utc).isoformat()
    (
        supabase.table(app_settings.signup_allowed_users_table)
        .update(values)
        .eq(app_settings.signup_allowed_users_email_column, email)
        .execute()
    )
