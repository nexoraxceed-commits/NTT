from __future__ import annotations

import csv
from io import StringIO

from app.report_metrics import build_report_model, parse_datetime


def build_evidence_csv(data: dict, *, window_days: int = 30) -> bytes:
    model = build_report_model(data, window_days=window_days)
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["event_id", "project_id", "task_id", "timestamp_utc", "effective_work_date", "project", "task", "event_type", "actor", "evidence_note", "previous_status", "new_status"])
    for event in sorted(model.period_events, key=lambda item: parse_datetime(item.get("created_at")) or model.period_start):
        writer.writerow([
            event.get("id"), event.get("project_id"), event.get("task_id"), event.get("created_at"), event.get("work_date"),
            event.get("project_name"), event.get("task_title"), event.get("event_type"), event.get("actor_name") or event.get("actor_email"),
            event.get("event_note"), event.get("previous_status"), event.get("new_status"),
        ])
    return stream.getvalue().encode("utf-8-sig")
