"""What a JUNIOR may see of other people's work.

Seniors oversee juniors; juniors see each other fully. Of seniors' work,
juniors see only merits: hours logged and tasks finished. They never see a
senior's open, in-progress, in-review or overdue task, unless the junior is
personally involved in that task (assignee, reviewer or watcher).

Everything here runs on the response dictionaries just before they are
returned, so the rules apply no matter how the frontend renders them.
"""

from __future__ import annotations

from app.constants import USER_CLASS_JUNIOR

# Activity entries that are positive or neutral facts. Notes such as "sent
# back with a note" or due-date changes are left out for hidden-merit tasks.
MERIT_EVENT_TYPES = {
    "TASK_CREATED",
    "TASK_WORK_STARTED",
    "TASK_WORK_LOGGED",
    "TASK_STATUS_CHANGED",
    "TASK_CLOSED",
}


def _lower(value: object) -> str:
    return str(value or "").strip().lower()


def is_junior(user: object) -> bool:
    return str(getattr(user, "user_class", "") or "").upper() == USER_CLASS_JUNIOR


def classes_by_email(ref_users: list[dict], email_column: str, class_column: str) -> dict[str, str]:
    return {
        _lower(row.get(email_column)): str(row.get(class_column) or "").upper()
        for row in ref_users
        if row.get(email_column)
    }


def _people(task: dict) -> set[str]:
    emails = {_lower(task.get("assigned_to_email")), _lower(task.get("stakeholder_email"))}
    for key in ("watchers", "supervisors", "team"):
        for person in task.get(key) or []:
            emails.add(_lower(person.get("email") if isinstance(person, dict) else getattr(person, "email", "")))
    emails.discard("")
    return emails


def _is_hidden(task: dict, viewer_email: str, classes: dict[str, str]) -> bool:
    if str(task.get("status") or "").upper() == "CLOSED":
        return False
    if viewer_email in _people(task):
        return False
    assignee = _lower(task.get("assigned_to_email"))
    if not assignee:
        # Unassigned work is visible so juniors can pick it up.
        return False
    return classes.get(assignee) != USER_CLASS_JUNIOR


def _merit_logs(task: dict) -> list[dict]:
    logs = []
    for log in task.get("work_logs") or []:
        if not log.get("hours"):
            continue
        logs.append(
            {
                "hours": log.get("hours"),
                "work_date": log.get("work_date"),
                "logged_by_email": log.get("logged_by_email"),
                "logged_by_name": log.get("logged_by_name"),
            }
        )
    return logs


def _trim_closed_senior_task(task: dict, classes: dict[str, str], viewer_email: str) -> dict:
    """Closed tasks of seniors stay visible as merits, without review notes."""
    assignee = _lower(task.get("assigned_to_email"))
    if classes.get(assignee) == USER_CLASS_JUNIOR or viewer_email in _people(task):
        return task
    trimmed = dict(task)
    trimmed["access_logs"] = [
        log
        for log in task.get("access_logs") or []
        if str(log.get("event_type") or "").upper() in MERIT_EVENT_TYPES
    ]
    return trimmed


def filter_tasks_for_junior(
    tasks: list[dict],
    viewer_email: str,
    classes: dict[str, str],
) -> tuple[list[dict], list[dict]]:
    """Return (tasks the junior may see, merit-only work logs of hidden tasks)."""
    viewer = _lower(viewer_email)
    visible: list[dict] = []
    merit_logs: list[dict] = []
    for task in tasks:
        if _is_hidden(task, viewer, classes):
            merit_logs.extend(_merit_logs(task))
            continue
        if str(task.get("status") or "").upper() == "CLOSED":
            task = _trim_closed_senior_task(task, classes, viewer)
        visible.append(task)
    return visible, merit_logs


def junior_may_open_task(task: dict, viewer_email: str, classes: dict[str, str]) -> bool:
    return not _is_hidden(task, _lower(viewer_email), classes)
