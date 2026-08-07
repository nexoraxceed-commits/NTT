from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any


CANONICAL_STATUSES = {
    "OPEN": "Open",
    "IN PROGRESS": "In Progress",
    "CLOSE REQUESTED": "Close Review",
    "CLOSED": "Closed",
    "BLOCKED": "Blocked",
    "PAUSED": "Paused",
    "CANCELLED": "Cancelled",
}
NOT_CAPTURED = "Not yet captured"
NOT_AVAILABLE = "Not available"


@dataclass(frozen=True)
class RagThresholds:
    overdue_green_max: float = 10.0
    overdue_amber_max: float = 20.0
    assignment_green_min: float = 98.0
    assignment_amber_min: float = 95.0
    ownership_green_min: float = 100.0
    ownership_amber_min: float = 95.0


@dataclass
class ReportModel:
    generated_at: datetime
    period_start: datetime
    projects: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    period_events: list[dict[str, Any]]
    period_work_logs: list[dict[str, Any]]
    status_counts: Counter[str]
    overdue_tasks: list[dict[str, Any]]
    snapshot: dict[str, Any]
    movement: dict[str, Any]
    reconciliation: dict[str, Any]
    validation_flags: list[dict[str, Any]] = field(default_factory=list)
    active_contributors: list[str] = field(default_factory=list)
    thresholds: RagThresholds = field(default_factory=RagThresholds)


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_date(value: Any) -> date | None:
    parsed = parse_datetime(value)
    if parsed:
        return parsed.date()
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def normalized_project_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def display_status(value: Any) -> str:
    key = str(value or "OPEN").strip().upper()
    return CANONICAL_STATUSES.get(key, key.title())


def percentage(numerator: int | float, denominator: int | float) -> float | None:
    return round(float(numerator) / float(denominator) * 100, 1) if denominator else None


def _person(record: dict[str, Any], prefix: str) -> str | None:
    value = record.get(f"{prefix}_name") or record.get(f"{prefix}_email")
    return str(value).strip() if value else None


def flatten_dashboard(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    projects = [dict(project) for project in data.get("projects") or []]
    project_lookup = {project.get("id"): project for project in projects}
    tasks: list[dict[str, Any]] = []
    for detail in data.get("project_details") or []:
        project = project_lookup.get(detail.get("id"), detail)
        for task in detail.get("tasks") or []:
            tasks.append({
                **task,
                "project_id": task.get("project_id") or detail.get("id"),
                "project_name": detail.get("project_name") or project.get("project_name") or "Untitled project",
            })
    return projects, tasks


def _validation_flags(projects: list[dict[str, Any]], tasks: list[dict[str, Any]], events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    projects_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    task_count = Counter(task.get("project_id") for task in tasks)
    for project in projects:
        normalized = normalized_project_name(project.get("project_name"))
        projects_by_name[normalized].append(project)
        if normalized == "test":
            flags.append({"type": "POSSIBLE_TEST_DATA", "record": project.get("project_name"), "message": "Validation required: possible test project."})
        if not (project.get("stakeholder_name") or project.get("stakeholder_email")):
            flags.append({"type": "MISSING_STAKEHOLDER", "record": project.get("project_name"), "message": "No named project stakeholder."})
        if not task_count[project.get("id")]:
            flags.append({"type": "ZERO_TASK_PROJECT", "record": project.get("project_name"), "message": "Active project has no visible tasks."})
    for candidates in projects_by_name.values():
        if len(candidates) > 1:
            names = ", ".join(str(item.get("project_name")) for item in candidates)
            flags.append({"type": "DUPLICATE_PROJECT_CANDIDATE", "record": names, "message": "Normalized project names match; do not merge without review."})
    event_groups: dict[tuple[Any, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        event_groups[(event.get("task_id"), event.get("event_type"))].append(event)
        actor = str(event.get("actor_name") or event.get("actor_email") or "")
        if actor.casefold() in {"admin", "system", "service"}:
            flags.append({"type": "AMBIGUOUS_ACCOUNT", "record": actor, "message": "Classify as person, shared, system, or service account."})
    for (task_id, event_type), grouped in event_groups.items():
        timestamps = sorted(filter(None, (parse_datetime(item.get("created_at")) for item in grouped)))
        if any((later - earlier) <= timedelta(minutes=2) for earlier, later in zip(timestamps, timestamps[1:])):
            flags.append({"type": "REPEATED_EVENT", "record": f"Task {task_id}: {event_type}", "message": "Repeated event in a short window; validation required."})
    unique = {(item["type"], item["record"]): item for item in flags}
    return list(unique.values())


def build_report_model(
    data: dict[str, Any],
    *,
    generated_at: datetime | None = None,
    window_days: int = 30,
    period_start: datetime | None = None,
    exclude_test_projects: bool = False,
    system_accounts: set[str] | None = None,
    thresholds: RagThresholds | None = None,
) -> ReportModel:
    generated_at = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    period_start = period_start or generated_at - timedelta(days=window_days)
    projects, tasks = flatten_dashboard(data)
    all_events: list[dict[str, Any]] = []
    all_work_logs: list[dict[str, Any]] = []
    for task in tasks:
        for log in task.get("access_logs") or []:
            all_events.append({**log, "task_id": task.get("id"), "project_id": task.get("project_id"), "task_title": task.get("task_title"), "project_name": task.get("project_name")})
        for log in task.get("work_logs") or []:
            all_work_logs.append({**log, "task_id": task.get("id"), "project_id": task.get("project_id"), "task_title": task.get("task_title"), "project_name": task.get("project_name")})
    validation = _validation_flags(projects, tasks, all_events)
    if exclude_test_projects:
        excluded_ids = {project.get("id") for project in projects if normalized_project_name(project.get("project_name")) == "test"}
        projects = [project for project in projects if project.get("id") not in excluded_ids]
        tasks = [task for task in tasks if task.get("project_id") not in excluded_ids]
        all_events = [event for event in all_events if event.get("project_id") not in excluded_ids]
        all_work_logs = [log for log in all_work_logs if log.get("project_id") not in excluded_ids]

    status_counts = Counter(str(task.get("status") or "OPEN").upper() for task in tasks)
    non_closed = [task for task in tasks if str(task.get("status") or "").upper() != "CLOSED"]
    overdue = [task for task in non_closed if (due := parse_date(task.get("end_date"))) and due < generated_at.date()]
    assigned = [task for task in tasks if task.get("assigned_to_email") or task.get("assigned_to_name")]
    stakeholder_projects = [project for project in projects if project.get("stakeholder_email") or project.get("stakeholder_name")]
    period_events = [event for event in all_events if (stamp := parse_datetime(event.get("created_at"))) and period_start <= stamp <= generated_at]
    period_work_logs = [log for log in all_work_logs if (stamp := parse_datetime(log.get("work_date") or log.get("created_at"))) and period_start <= stamp <= generated_at]
    closure_events = [event for event in period_events if str(event.get("event_type") or "").upper() == "TASK_CLOSED"]
    closed_task_ids = {event.get("task_id") for event in closure_events if event.get("task_id") is not None}
    repeated_closures = len(closure_events) - len(closed_task_ids)
    reopened_ids: set[Any] = set()
    for task_id in closed_task_ids:
        task_events = sorted((event for event in all_events if event.get("task_id") == task_id), key=lambda event: parse_datetime(event.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
        closed_seen = False
        for event in task_events:
            if str(event.get("event_type") or "").upper() == "TASK_CLOSED" or str(event.get("new_status") or "").upper() == "CLOSED":
                closed_seen = True
            elif closed_seen and str(event.get("new_status") or "").upper() not in {"", "CLOSED"}:
                reopened_ids.add(task_id)
    account_exclusions = {value.casefold() for value in (system_accounts or {"admin", "system", "service"})}
    contributors = {
        name for event in period_events
        if (name := _person(event, "actor")) and name.casefold() not in account_exclusions
    } | {
        name for log in period_work_logs
        if (name := _person(log, "logged_by")) and name.casefold() not in account_exclusions
    }
    overdue_ages = [(generated_at.date() - parse_date(task.get("end_date"))).days for task in overdue]
    total_hours = round(sum(float(log.get("hours") or 0) for log in period_work_logs), 1)
    snapshot = {
        "project_count": len(projects), "task_count": len(tasks), "open_count": status_counts["OPEN"],
        "in_progress_count": status_counts["IN PROGRESS"], "close_review_count": status_counts["CLOSE REQUESTED"],
        "closed_count": status_counts["CLOSED"], "non_closed_count": len(non_closed), "work_in_motion": status_counts["IN PROGRESS"] + status_counts["CLOSE REQUESTED"],
        "closed_task_rate": percentage(status_counts["CLOSED"], len(tasks)), "overdue_count": len(overdue),
        "overdue_rate": percentage(len(overdue), len(non_closed)), "median_overdue_age": round(median(overdue_ages), 1) if overdue_ages else None,
        "assignment_coverage": percentage(len(assigned), len(tasks)), "stakeholder_coverage": percentage(len(stakeholder_projects), len(projects)),
        "stakeholder_project_count": len(stakeholder_projects), "unassigned_count": len(tasks) - len(assigned),
    }
    movement = {
        "workflow_event_count": len(period_events), "closure_event_count": len(closure_events),
        "unique_closed_task_count": len(closed_task_ids), "active_contributor_count": len(contributors),
        "self_reported_hours": total_hours,
    }
    reconciliation = {
        "closure_event_count": len(closure_events), "unique_closed_task_count": len(closed_task_ids),
        "currently_closed_count": status_counts["CLOSED"], "reopened_task_count": len(reopened_ids),
        "repeated_closure_event_count": repeated_closures, "removed_or_archived_count": None,
        "note": "Closure events and current Closed tasks measure different things. Full reconciliation requires immutable task lifecycle history.",
    }
    return ReportModel(generated_at, period_start, projects, tasks, period_events, period_work_logs, status_counts, overdue, snapshot, movement, reconciliation, validation, sorted(contributors), thresholds or RagThresholds())


def rag_for(metric: str, value: float | None, thresholds: RagThresholds | None = None) -> str:
    if value is None:
        return "GREY"
    thresholds = thresholds or RagThresholds()
    if metric == "overdue_rate":
        return "GREEN" if value <= thresholds.overdue_green_max else "AMBER" if value <= thresholds.overdue_amber_max else "RED"
    if metric == "assignment_coverage":
        return "GREEN" if value >= thresholds.assignment_green_min else "AMBER" if value >= thresholds.assignment_amber_min else "RED"
    if metric == "stakeholder_coverage":
        return "GREEN" if value >= thresholds.ownership_green_min else "AMBER" if value >= thresholds.ownership_amber_min else "RED"
    return "GREY"
