"""Optional planning fields on projects: priority and target date.

Stored on PROJECTS (see Resources/20261027_PROJECT_PLANS.sql). Every function
here tolerates the columns not existing yet, so nothing breaks if the backend
is deployed before the script is run.
"""

from __future__ import annotations

import re

from supabase import Client

from app.constants import PROJECTS_TABLE

PRIORITIES = {"HIGH", "MEDIUM", "LOW"}


def normalize_priority(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip().upper()
    return value if value in PRIORITIES else None


def normalize_target_date(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip()[:10]
    return value if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None


def get_project_plans(supabase: Client, project_ids: list[int]) -> dict[int, dict]:
    if not project_ids:
        return {}
    try:
        response = (
            supabase.table(PROJECTS_TABLE)
            .select("id,priority,target_date,created_at")
            .in_("id", project_ids)
            .execute()
        )
    except Exception:
        try:
            response = (
                supabase.table(PROJECTS_TABLE)
                .select("id,created_at")
                .in_("id", project_ids)
                .execute()
            )
        except Exception:
            return {}
    return {int(row["id"]): row for row in (getattr(response, "data", None) or [])}


def save_project_plan(
    supabase: Client,
    project_id: int,
    priority: str | None,
    target_date: str | None,
    *,
    clear_missing: bool = False,
) -> bool:
    values: dict[str, object] = {}
    if priority is not None or clear_missing:
        values["priority"] = normalize_priority(priority)
    if target_date is not None or clear_missing:
        values["target_date"] = normalize_target_date(target_date)
    if not values:
        return True
    try:
        supabase.table(PROJECTS_TABLE).update(values).eq("id", project_id).execute()
        return True
    except Exception:
        return False


def plan_fields(plans: dict[int, dict], project_id: int) -> dict:
    row = plans.get(int(project_id), {})
    return {
        "priority": row.get("priority"),
        "target_date": str(row.get("target_date"))[:10] if row.get("target_date") else None,
        "created_at": row.get("created_at"),
    }
