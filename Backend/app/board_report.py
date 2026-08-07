from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from io import BytesIO
from typing import Any

from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.report_metrics import NOT_AVAILABLE, NOT_CAPTURED, ReportModel, build_report_model, display_status, parse_date, rag_for


NAVY = colors.HexColor("#13233A")
BLUE = colors.HexColor("#2B6EF2")
TEAL = colors.HexColor("#168A91")
GREEN = colors.HexColor("#2E8B57")
AMBER = colors.HexColor("#D68B1F")
RED = colors.HexColor("#C23B3B")
INK = colors.HexColor("#26364A")
MUTED = colors.HexColor("#637083")
PALE = colors.HexColor("#F3F6FA")
WHITE = colors.white
RAG_COLOURS = {"GREEN": GREEN, "AMBER": AMBER, "RED": RED, "GREY": MUTED}


def _text(value: Any) -> str:
    return " ".join(str(value if value not in (None, "") else "-").split())


def _cell(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(_text(value)), style)


def _table(rows: list[list[Any]], widths: list[float], styles: dict[str, ParagraphStyle], *, header: bool = True) -> Table:
    wrapped = [[_cell(value, styles["th"] if header and index == 0 else styles["td"]) for value in row] for index, row in enumerate(rows)]
    table = Table(wrapped, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D7E0E9")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE])]
    table.setStyle(TableStyle(commands))
    return table


def _metric(label: str, value: str, definition: str, *, rag: str = "GREY") -> Table:
    accent = RAG_COLOURS[rag]
    label_style = ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=6.8, leading=8, textColor=MUTED)
    value_style = ParagraphStyle("mv", fontName="Helvetica-Bold", fontSize=13, leading=15, textColor=NAVY)
    note_style = ParagraphStyle("mn", fontName="Helvetica", fontSize=6.7, leading=8.5, textColor=MUTED)
    card = Table(
        [
            [Paragraph(escape(label.upper()), label_style)],
            [Paragraph(escape(value), value_style)],
            [Paragraph(escape(definition), note_style)],
        ],
        colWidths=[46 * mm],
        rowHeights=[6 * mm, 8 * mm, 8 * mm],
    )
    card.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), .5, colors.HexColor("#DCE3EC")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return card


def _workflow_bar(model: ReportModel) -> Drawing:
    stages = [("OPEN", BLUE), ("IN PROGRESS", TEAL), ("CLOSE REQUESTED", AMBER), ("CLOSED", GREEN)]
    total = max(sum(model.status_counts[key] for key, _ in stages), 1)
    drawing = Drawing(510, 78)
    drawing.add(String(0, 67, "Current workflow stage distribution", fontName="Helvetica-Bold", fontSize=9, fillColor=NAVY))
    x = 0
    for key, colour in stages:
        count = model.status_counts[key]
        width = 500 * count / total
        if width:
            drawing.add(Rect(x, 30, width, 18, fillColor=colour, strokeColor=WHITE))
            if width > 38:
                drawing.add(String(x + width / 2, 36, f"{display_status(key)} {count}", fontName="Helvetica-Bold", fontSize=6.5, fillColor=WHITE, textAnchor="middle"))
        x += width
    drawing.add(String(0, 13, "Snapshot at report cutoff; this is not period throughput.", fontName="Helvetica", fontSize=6.5, fillColor=MUTED))
    return drawing


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=NAVY, spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=TEAL, spaceBefore=5, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontSize=8.2, leading=11.4, textColor=INK, spaceAfter=4),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontSize=6.8, leading=9, textColor=MUTED),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=6.7, leading=8.4, textColor=WHITE, wordWrap="CJK"),
        "td": ParagraphStyle("td", fontName="Helvetica", fontSize=6.7, leading=8.5, textColor=INK, wordWrap="CJK"),
        "callout": ParagraphStyle("callout", fontName="Helvetica-Bold", fontSize=8.3, leading=11.5, textColor=NAVY, borderColor=colors.HexColor("#DCE3EC"), borderWidth=.5, borderPadding=7, backColor=PALE),
    }


def _footer(canvas, document) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D8E1EA")); canvas.line(15 * mm, 13 * mm, 195 * mm, 13 * mm)
    canvas.setFont("Helvetica", 6.5); canvas.setFillColor(MUTED)
    canvas.drawString(15 * mm, 8.5 * mm, "NEXORA | BOARD DELIVERY UPDATE | INTERNAL")
    canvas.drawRightString(195 * mm, 8.5 * mm, f"Page {document.page}")
    canvas.restoreState()


def _person(record: dict, prefix: str) -> str:
    return _text(record.get(f"{prefix}_name") or record.get(f"{prefix}_email") or "Not assigned")


def build_board_report(
    data: dict,
    generated_for: str | None = None,
    *,
    generated_at: datetime | None = None,
    window_days: int = 30,
    period_start: datetime | None = None,
    management_commentary: dict[str, str] | None = None,
    exclude_test_projects: bool = False,
) -> bytes:
    model = build_report_model(
        data,
        generated_at=generated_at,
        window_days=window_days,
        period_start=period_start,
        exclude_test_projects=exclude_test_projects,
    )
    commentary = management_commentary or {}
    s = _styles(); out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=17 * mm, bottomMargin=17 * mm, title="Nexora Delivery Update - Executive Summary and Board Actions", author="Nexora")
    story: list[Any] = []

    # Page 1: Executive summary and board actions.
    story += [Paragraph("Nexora Delivery Update - Executive Summary and Board Actions", s["h1"]), Paragraph(f"Reporting scope: current authorized portfolio snapshot at {model.generated_at:%d %b %Y}; movement covers {model.period_start:%d %b %Y} to {model.generated_at:%d %b %Y} (UTC).", s["small"]), Spacer(1, 3 * mm)]
    snapshot = model.snapshot; movement = model.movement
    cards = [
        _metric("Current projects", str(snapshot["project_count"]), "Current snapshot"), _metric("Current tasks", str(snapshot["task_count"]), "Current snapshot"),
        _metric("Current Closed", f'{snapshot["closed_count"]} / {snapshot["closed_task_rate"] or 0:.1f}%', "Current closed-task rate"),
        _metric("Closure events", str(movement["closure_event_count"]), "Recorded in reporting period"),
        _metric("Current overdue", f'{snapshot["overdue_count"]} / {snapshot["overdue_rate"] or 0:.1f}%', "Of current non-closed tasks", rag=rag_for("overdue_rate", snapshot["overdue_rate"], model.thresholds)),
        _metric("Stakeholder coverage", f'{snapshot["stakeholder_project_count"]}/{snapshot["project_count"]}', "Current project records", rag=rag_for("stakeholder_coverage", snapshot["stakeholder_coverage"], model.thresholds)),
    ]
    story += [Table([cards[:3], cards[3:]], colWidths=[60 * mm] * 3, style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]), Spacer(1, 4 * mm)]
    factual = (f'The current authorized portfolio contains {snapshot["task_count"]} tasks. During the reporting period, {movement["closure_event_count"]} task-closure events were recorded. '
               f'At cutoff, {snapshot["closed_count"]} tasks are Closed ({snapshot["closed_task_rate"] or 0:.1f}%). {snapshot["overdue_count"]} of {snapshot["non_closed_count"]} non-closed tasks are overdue ({snapshot["overdue_rate"] or 0:.1f}%).')
    story += [Paragraph("Board interpretation", s["h2"]), Paragraph(factual, s["callout"])]
    panels = [["Key achievements", commentary.get("achievements", "Management commentary required: record accepted outputs or outcomes supported by evidence.")], ["Material risks and management attention", commentary.get("risks", f'{snapshot["overdue_count"]} overdue non-closed tasks require status validation, recovery dates, blocker analysis and prioritization.')], ["Decisions or support requested", commentary.get("decisions", "No board decision has been entered for this reporting period.")]]
    story += [
        Spacer(1, 3 * mm),
        _table(panels, [46 * mm, 134 * mm], s, header=False),
        Spacer(1, 5 * mm),
        _workflow_bar(model),
        Paragraph(
            "Reading guide: cards and workflow stages describe the current portfolio at cutoff. "
            "Closure events describe changes recorded during the reporting period. Neither work-log "
            "hours nor event volume should be interpreted as individual productivity.",
            s["small"],
        ),
    ]

    # Page 2: Strategic portfolio.
    story += [PageBreak(), Paragraph("Strategic Portfolio and Organizational Value", s["h1"]), Paragraph("Strategic alignment and outcome data are not yet captured consistently in the product. The table below is deliberately transparent and does not infer value from task activity.", s["callout"])]
    priority = sorted(model.projects, key=lambda p: _text(p.get("project_name")).casefold())[:10]
    rows = [["Priority project", "Accountable owner", "Sponsor", "Objective", "Health", "Next milestone", "Outcome/evidence"]]
    for project in priority:
        rows.append([project.get("project_name"), project.get("accountable_owner") or NOT_CAPTURED, project.get("executive_sponsor") or NOT_CAPTURED, project.get("strategic_objective") or NOT_CAPTURED, project.get("health") or NOT_CAPTURED, project.get("next_milestone") or NOT_CAPTURED, project.get("outcome_evidence") or NOT_CAPTURED])
    if len(rows) == 1: rows.append(["No projects in scope", NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE])
    story += [Spacer(1, 4 * mm), _table(rows, [34 * mm, 25 * mm, 22 * mm, 27 * mm, 20 * mm, 25 * mm, 27 * mm], s), Spacer(1, 5 * mm), Paragraph("Management portfolio commentary", s["h2"]), Paragraph(commentary.get("portfolio", "No strategic portfolio commentary supplied."), s["body"])]

    # Page 3: Performance and predictability.
    story += [PageBreak(), Paragraph("Delivery Performance and Predictability", s["h1"]), _workflow_bar(model)]
    performance = [
        ["Measure", "Value", "Type / interpretation"], ["Current closed-task rate", f'{snapshot["closed_task_rate"] or 0:.1f}%', "Snapshot; portfolio-state indicator, not performance against plan"],
        ["Current work in motion", snapshot["work_in_motion"], "Snapshot: In Progress plus Close Review"], ["Closure events in period", movement["closure_event_count"], "Movement: event count, not unique throughput"],
        ["Unique tasks with closure events", movement["unique_closed_task_count"], "Movement; distinct current task IDs represented"], ["Recorded workflow events", movement["workflow_event_count"], "Traceability signal; not value or productivity"],
        ["Self-reported work-log hours", f'{movement["self_reported_hours"]:.1f}h', "Participation evidence; not individual productivity"], ["On-time completion", NOT_AVAILABLE, "Requires original due dates and closure timestamps"],
        ["Cycle time / lead time", NOT_AVAILABLE, "Requires reliable lifecycle timestamps"],
    ]
    story += [_table(performance, [53 * mm, 34 * mm, 93 * mm], s), Spacer(1, 4 * mm), Paragraph("Closure reconciliation", s["h2"])]
    rec = model.reconciliation
    story += [_table([["Closure events", "Distinct task IDs", "Currently Closed", "Reopened", "Repeated closures", "Removed/archive"], [rec["closure_event_count"], rec["unique_closed_task_count"], rec["currently_closed_count"], rec["reopened_task_count"], rec["repeated_closure_event_count"], NOT_AVAILABLE]], [30 * mm] * 6, s), Paragraph(rec["note"], s["small"])]

    # Page 4: Risks and recovery.
    story += [PageBreak(), Paragraph("Material Delivery Risks and Recovery Actions", s["h1"]), Paragraph("Operational exceptions are sorted by overdue age. Strategic importance, impact and recovery confidence are not yet captured and require management input before board prioritization.", s["body"])]
    risk_rows = [["Project / task", "Owner", "Status", "Due", "Days overdue", "Priority / impact", "Recovery / support"]]
    for task in sorted(model.overdue_tasks, key=lambda item: parse_date(item.get("end_date")) or model.generated_at.date())[:12]:
        due = parse_date(task.get("end_date")); days = (model.generated_at.date() - due).days if due else "-"
        risk_rows.append([f'{task.get("project_name")} / {task.get("task_title")}', _person(task, "assigned_to"), display_status(task.get("status")), due.strftime("%d %b %Y") if due else "-", days, "Management input required", "Management input required"])
    if len(risk_rows) == 1: risk_rows.append(["No current overdue tasks", "-", "-", "-", "-", "-", "-"])
    story += [_table(risk_rows, [49 * mm, 25 * mm, 21 * mm, 20 * mm, 18 * mm, 25 * mm, 22 * mm], s), Spacer(1, 5 * mm), Paragraph("Required recovery fields", s["h2"]), Paragraph("For each material exception: blocker/cause, stakeholder impact, revised recovery date, recovery confidence, next action, recovery owner and required leadership support.", s["callout"])]

    # Page 5: Governance.
    story += [PageBreak(), Paragraph("Portfolio Accountability and Governance", s["h1"]), Paragraph("A named stakeholder is not automatically an accountable owner or executive sponsor. Those roles remain separate and must be explicitly captured.", s["body"])]
    details = {item.get("id"): item for item in data.get("project_details") or []}
    gov = [["Project", "Owner", "Sponsor", "Health", "Tasks", "Closed", "Overdue", "Next milestone / issue"]]
    for project in sorted(model.projects, key=lambda p: _text(p.get("project_name")).casefold())[:14]:
        project_tasks = details.get(project.get("id"), {}).get("tasks") or []
        overdue_count = sum(1 for task in model.overdue_tasks if task.get("project_id") == project.get("id"))
        gov.append([project.get("project_name"), project.get("accountable_owner") or NOT_CAPTURED, project.get("executive_sponsor") or NOT_CAPTURED, project.get("health") or NOT_CAPTURED, len(project_tasks), sum(str(task.get("status") or "").upper() == "CLOSED" for task in project_tasks), overdue_count, project.get("next_milestone") or ("Management attention" if overdue_count else NOT_CAPTURED)])
    story += [_table(gov, [38 * mm, 24 * mm, 22 * mm, 18 * mm, 13 * mm, 14 * mm, 15 * mm, 36 * mm], s), Spacer(1, 4 * mm)]
    story.append(_table([["Governance indicator", "Result", "Meaning"], ["Task assignment coverage", f'{snapshot["assignment_coverage"] or 0:.1f}%', "Current named task owners"], ["Project stakeholder coverage", f'{snapshot["stakeholder_coverage"] or 0:.1f}%', "Current named stakeholders; not owner coverage"], ["Accountable-owner coverage", NOT_AVAILABLE, "Field not yet populated"], ["Data-hygiene flags", len(model.validation_flags), "Records requiring validation, not automatic deletion"]], [55 * mm, 33 * mm, 92 * mm], s))

    # Page 6: Outcomes and learning.
    story += [PageBreak(), Paragraph("Delivered Outcomes and Learning", s["h1"]), Paragraph("Task closure is a delivery output unless accepted outcome evidence demonstrates a business, customer or stakeholder result.", s["callout"])]
    closed = [task for task in model.tasks if str(task.get("status") or "").upper() == "CLOSED"][:4]
    outcome_rows = [["Delivery output", "Problem/objective", "Completion evidence", "Acceptance owner", "Outcome/impact", "Learning / next step"]]
    for task in closed:
        outcome_rows.append([f'{task.get("project_name")} / {task.get("task_title")}', task.get("strategic_objective") or NOT_CAPTURED, task.get("completion_evidence") or NOT_CAPTURED, task.get("acceptance_owner") or NOT_CAPTURED, task.get("realized_outcome") or NOT_CAPTURED, task.get("learning") or NOT_CAPTURED])
    if len(outcome_rows) == 1: outcome_rows.append(["No closed outputs in current snapshot", NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE])
    story += [Spacer(1, 5 * mm), _table(outcome_rows, [40 * mm, 28 * mm, 31 * mm, 24 * mm, 28 * mm, 29 * mm], s), Spacer(1, 6 * mm), Paragraph("Management outcome commentary", s["h2"]), Paragraph(commentary.get("outcomes", "No management-confirmed outcome narrative supplied."), s["body"])]

    # Page 7: Assurance and roadmap.
    story += [PageBreak(), Paragraph("Data Assurance, Definitions and Reporting Roadmap", s["h1"])]
    definitions = [["Metric", "Definition / source"], ["Current tasks", "Tasks in the authorized dashboard snapshot at cutoff."], ["Current closed-task rate", "Current Closed tasks divided by all current visible tasks."], ["Closure events in period", "TASK_CLOSED access-log events timestamped in the reporting window."], ["Overdue non-closed rate", "Current overdue non-closed tasks divided by all current non-closed tasks."], ["Recorded workflow events", "Recorded access-log events; demonstrates usage and traceability, not value or productivity."], ["Self-reported work-log hours", "Hours entered by users within the period; not an individual productivity measure."], ["Business timezone", "UTC in this export; audit timestamps retain UTC."]]
    story += [_table(definitions, [48 * mm, 132 * mm], s), Spacer(1, 4 * mm), Paragraph("Validation summary", s["h2"])]
    flags = [["Flag", "Record", "Review required"]] + [[flag["type"].replace("_", " ").title(), flag["record"], flag["message"]] for flag in model.validation_flags[:10]]
    if len(flags) == 1: flags.append(["No automated flags", "-", "Human assurance remains required"])
    story += [_table(flags, [42 * mm, 55 * mm, 83 * mm], s), Spacer(1, 4 * mm), Paragraph("Known limitations and roadmap", s["h2"])]
    limitations = [
        "Project and task creation timestamps are not consistently exposed in dashboard response objects; historical creation can be understated when events are missing.",
        "Work-log hours are self-reported. Event and hour volume must not be used for individual productivity rankings.",
        "Status and due-date accuracy depends on timely updates.",
        "Revenue, budget, cost, benefit, milestone, dependency, priority, risk, quality, defect, customer outcome and strategic-objective data are not consistently captured.",
        "The full immutable evidence register is available as a separate CSV export; this report includes only assurance summaries.",
    ]
    for item in limitations: story.append(Paragraph(f"- {item}", s["body"]))
    story += [Spacer(1, 3 * mm), Paragraph("Nexora has established a functioning and traceable delivery operating system with visible task ownership and recorded completion activity. The next stage is to improve predictability, data quality, strategic alignment and measurable outcome reporting.", s["callout"])]

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return out.getvalue()
