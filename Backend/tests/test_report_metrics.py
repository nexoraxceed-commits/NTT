from datetime import datetime, timedelta, timezone

from app.report_metrics import NOT_CAPTURED, build_report_model, normalized_project_name


NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def make_dashboard(*, include_commentary_fields=False):
    projects = []
    details = []
    for project_id in range(1, 25):
        project = {"id": project_id, "project_name": "test" if project_id == 24 else f"Project {project_id}", "status": "ACTIVE", "stakeholder_name": None if project_id == 24 else f"Stakeholder {project_id}"}
        if include_commentary_fields:
            project["strategic_objective"] = "Objective"
        projects.append(project)
        details.append({**project, "tasks": []})
    statuses = ["OPEN"] * 21 + ["IN PROGRESS"] * 4 + ["CLOSE REQUESTED"] + ["CLOSED"] * 18
    for index, status in enumerate(statuses, 1):
        project_index = (index - 1) % 23
        task = {"id": index, "project_id": project_index + 1, "task_title": "A long task title " * 6 if index == 1 else f"Task {index}", "status": status, "assigned_to_name": "Owner", "end_date": "2026-08-01" if index <= 8 else "2026-08-30", "access_logs": [], "work_logs": []}
        details[project_index]["tasks"].append(task)
    for index in range(22):
        task = details[index % 23]["tasks"][0]
        task["access_logs"].append({"id": 1000 + index, "event_type": "TASK_CLOSED", "created_at": (NOW - timedelta(days=index % 20)).isoformat(), "actor_name": "Human"})
    return {"projects": projects, "project_details": details}


def test_required_snapshot_formulas():
    model = build_report_model(make_dashboard(), generated_at=NOW)
    assert model.snapshot["task_count"] == 44
    assert model.snapshot["closed_count"] == 18
    assert model.snapshot["closed_task_rate"] == 40.9
    assert model.snapshot["non_closed_count"] == 26
    assert model.snapshot["overdue_count"] == 8
    assert model.snapshot["overdue_rate"] == 30.8
    assert model.snapshot["assignment_coverage"] == 100.0
    assert model.snapshot["stakeholder_coverage"] == 95.8


def test_closure_events_are_not_unique_task_count_and_reopen_is_detected():
    data = make_dashboard()
    task = data["project_details"][0]["tasks"][0]
    task["access_logs"] += [
        {"id": 9991, "event_type": "TASK_CLOSED", "new_status": "CLOSED", "created_at": (NOW - timedelta(days=2)).isoformat(), "actor_name": "Human"},
        {"id": 9992, "event_type": "TASK_REOPENED", "new_status": "OPEN", "created_at": (NOW - timedelta(days=1)).isoformat(), "actor_name": "Human"},
    ]
    model = build_report_model(data, generated_at=NOW)
    assert model.movement["closure_event_count"] > model.movement["unique_closed_task_count"]
    assert model.reconciliation["reopened_task_count"] == 1


def test_validation_flags_candidates_without_mutating_records():
    data = make_dashboard()
    data["projects"][1]["project_name"] = "  PROJECT-1  "
    data["project_details"][1]["project_name"] = "  PROJECT-1  "
    model = build_report_model(data, generated_at=NOW)
    kinds = {flag["type"] for flag in model.validation_flags}
    assert "DUPLICATE_PROJECT_CANDIDATE" in kinds
    assert "POSSIBLE_TEST_DATA" in kinds
    assert "ZERO_TASK_PROJECT" in kinds
    assert normalized_project_name("Xceed Website Design") == normalized_project_name("xceed-website design")


def test_test_projects_can_be_excluded_and_system_accounts_are_not_contributors():
    data = make_dashboard()
    task = data["project_details"][0]["tasks"][0]
    task["access_logs"].append({"id": 8888, "event_type": "TASK_COMMENT_ADDED", "created_at": NOW.isoformat(), "actor_name": "Admin"})
    model = build_report_model(data, generated_at=NOW, exclude_test_projects=True)
    assert model.snapshot["project_count"] == 23
    assert "Admin" not in model.active_contributors


def test_missing_future_fields_are_not_zero():
    model = build_report_model(make_dashboard(), generated_at=NOW)
    assert model.projects[0].get("strategic_objective") is None
    assert NOT_CAPTURED != "0"


def test_explicit_report_period_uses_inclusive_date_boundaries():
    data = make_dashboard()
    for project in data["project_details"]:
        for existing_task in project["tasks"]:
            existing_task["access_logs"] = []
    task = data["project_details"][0]["tasks"][0]
    task["access_logs"] = [
        {"id": 7001, "event_type": "TASK_CLOSED", "created_at": "2026-08-01T00:00:00+00:00"},
        {"id": 7002, "event_type": "TASK_CLOSED", "created_at": "2026-08-07T23:59:59+00:00"},
        {"id": 7003, "event_type": "TASK_CLOSED", "created_at": "2026-07-31T23:59:59+00:00"},
    ]
    model = build_report_model(
        data,
        generated_at=datetime(2026, 8, 7, 23, 59, 59, tzinfo=timezone.utc),
        period_start=datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc),
    )
    assert model.movement["closure_event_count"] == 2
