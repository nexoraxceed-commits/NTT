from datetime import datetime, timezone

from app.board_report import build_board_report
from app.report_exports import build_evidence_csv
from app.team_report import build_team_report
from tests.test_report_metrics import make_dashboard


NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def test_board_report_generates_without_commentary_and_uses_correct_language():
    report = build_board_report(make_dashboard(), generated_at=NOW)
    assert report.startswith(b"%PDF")
    assert len(report) > 10_000


def test_board_report_generates_with_commentary_and_long_names():
    report = build_board_report(make_dashboard(), generated_at=NOW, management_commentary={"achievements": "Accepted delivery evidence was reviewed.", "risks": "Recovery validation is in progress.", "decisions": "Confirm priority."})
    assert report.startswith(b"%PDF")


def test_team_report_and_full_evidence_export_generate():
    data = make_dashboard()
    assert build_team_report(data, generated_at=NOW).startswith(b"%PDF")
    csv_data = build_evidence_csv(data)
    assert b"event_id" in csv_data
    assert len(csv_data.splitlines()) > 22
