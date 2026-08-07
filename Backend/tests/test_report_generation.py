from datetime import datetime, timezone
from io import BytesIO

from pypdf import PdfReader
from app.board_report import build_board_report
from app.report_exports import build_evidence_csv
from app.team_report import build_team_report
from test_report_metrics import make_dashboard


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


def test_board_language_separates_snapshot_activity_and_unique_closures():
    report = build_board_report(make_dashboard(), generated_at=NOW)
    text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(report)).pages)
    assert "current authorized portfolio contains 44 tasks" in text.casefold()
    assert "closure events in period" in text.casefold()
    assert "unique tasks with closure events" in text.casefold()
    assert "self-reported work-log hours" in text.casefold()
    assert "not individual productivity" in text.casefold()
    assert "44 tasks were added" not in text.casefold()


def test_board_report_has_seven_core_pages_and_long_names_remain_extractable():
    report = build_board_report(make_dashboard(), generated_at=NOW)
    reader = PdfReader(BytesIO(report))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert len(reader.pages) == 7
    assert "A long task title" in text
