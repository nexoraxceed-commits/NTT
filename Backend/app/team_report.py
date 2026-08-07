from __future__ import annotations

from datetime import datetime
from html import escape
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.report_metrics import NOT_AVAILABLE, NOT_CAPTURED, build_report_model, display_status, parse_date


NAVY = colors.HexColor("#13233A")
TEAL = colors.HexColor("#168A91")
INK = colors.HexColor("#26364A")
MUTED = colors.HexColor("#637083")
PALE = colors.HexColor("#F3F6FA")
WHITE = colors.white


def _clean(value: Any) -> str:
    return " ".join(str(value if value not in (None, "") else "-").split())


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=NAVY, spaceAfter=8),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=TEAL, spaceBefore=5, spaceAfter=4),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=8, leading=11, textColor=INK, spaceAfter=4),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=5.8, leading=7, textColor=WHITE, wordWrap="CJK"),
        "td": ParagraphStyle("td", fontName="Helvetica", fontSize=5.8, leading=7, textColor=INK, wordWrap="CJK"),
    }


def _table(rows: list[list[Any]], widths: list[float], s: dict[str, ParagraphStyle]) -> Table:
    cells = [[Paragraph(escape(_clean(value)), s["th"] if row_index == 0 else s["td"]) for value in row] for row_index, row in enumerate(rows)]
    table = Table(cells, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE]), ("GRID", (0, 0), (-1, -1), .3, colors.HexColor("#D7E0E9")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    return table


def build_team_report(data: dict, *, generated_at: datetime | None = None, window_days: int = 30) -> bytes:
    model = build_report_model(data, generated_at=generated_at, window_days=window_days)
    s = _styles(); output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=12 * mm, bottomMargin=13 * mm, title="Nexora Team Delivery Operating Report")

    def footer(canvas, doc):
        canvas.saveState(); canvas.setFont("Helvetica", 6.5); canvas.setFillColor(MUTED)
        canvas.drawString(10 * mm, 7 * mm, "NEXORA | TEAM OPERATING VIEW | PRIVATE DELIVERY MANAGEMENT")
        canvas.drawRightString(287 * mm, 7 * mm, f"Page {doc.page}"); canvas.restoreState()

    story: list[Any] = [Paragraph("Nexora Team Delivery Operating Report", s["h1"]), Paragraph(f"Current task controls and exceptions at {model.generated_at:%d %b %Y}. This view supports ownership, recovery and workload balancing; it is not a public productivity leaderboard.", s["body"])]
    rows = [["Project / task", "Owner / contributors", "Committed outcome / done", "Acceptance owner", "Priority", "Original due / forecast", "Status / age", "Overdue", "Blocker / dependency", "Next action", "Evidence / learning"]]
    for task in sorted(model.tasks, key=lambda item: (str(item.get("status")), parse_date(item.get("end_date")) or model.generated_at.date(), str(item.get("project_name")))):
        due = parse_date(task.get("end_date")); days_overdue = max((model.generated_at.date() - due).days, 0) if due and str(task.get("status") or "").upper() != "CLOSED" else 0
        rows.append([
            f'{task.get("project_name")} / {task.get("task_title")}', task.get("assigned_to_name") or task.get("assigned_to_email") or "Unassigned",
            task.get("weekly_committed_outcome") or NOT_CAPTURED, task.get("acceptance_owner") or NOT_CAPTURED, task.get("priority") or NOT_CAPTURED,
            f'{task.get("original_due_date") or NOT_CAPTURED} / {task.get("current_forecast_date") or task.get("end_date") or NOT_CAPTURED}',
            f'{display_status(task.get("status"))} / {task.get("age_in_status") or NOT_AVAILABLE}', days_overdue,
            task.get("blocker") or task.get("dependency") or NOT_CAPTURED, task.get("next_action") or NOT_CAPTURED,
            task.get("completion_evidence") or task.get("learning") or NOT_CAPTURED,
        ])
    if len(rows) == 1: rows.append(["No tasks in scope"] + [NOT_AVAILABLE] * 10)
    story += [Spacer(1, 3 * mm), _table(rows, [40 * mm, 28 * mm, 34 * mm, 22 * mm, 17 * mm, 29 * mm, 25 * mm, 14 * mm, 29 * mm, 25 * mm, 24 * mm], s), PageBreak(), Paragraph("Operating controls and missing capabilities", s["h1"])]
    controls = [
        ["Control", "Current result", "Configuration / next step"],
        ["WIP limit", NOT_AVAILABLE, "Recommended configurable starting point: two normal In Progress tasks per owner; expedited exception requires justification."],
        ["Close Review turnaround", NOT_AVAILABLE, "Recommended configurable starting point: two business days."],
        ["Weekly commitment reliability", NOT_AVAILABLE, "Capture explicit weekly commitments and definition of done before calculating."],
        ["Blocker escalation", NOT_AVAILABLE, "Prepare private notifications at 1, 2 and 5 working-day thresholds; do not use punitive public alerts."],
        ["Aging bands", NOT_AVAILABLE, "Configurable defaults: 0-3 normal, 4-7 watch, 8-14 attention, >14 recovery/closure decision."],
        ["Recognition", NOT_CAPTURED, "Base recognition on accepted outcomes, reliability, quality, early escalation, blocker removal, support and learning."],
    ]
    story += [_table(controls, [56 * mm, 43 * mm, 178 * mm], s), Spacer(1, 6 * mm), Paragraph("Participation assurance", s["h2"]), Paragraph("Workflow events and self-reported hours are participation and traceability signals. They are not measures of individual productivity or value. Individual records are retained for private capacity discussion, audit, workload balancing, coaching and data-quality review.", s["body"])]
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
