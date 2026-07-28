from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from html import escape
from io import BytesIO
from typing import Any

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


NAVY = colors.HexColor("#13233A")
BLUE = colors.HexColor("#2B6EF2")
CYAN = colors.HexColor("#30B8C4")
GREEN = colors.HexColor("#26A269")
AMBER = colors.HexColor("#F2A93B")
RED = colors.HexColor("#D94B4B")
INK = colors.HexColor("#26364A")
MUTED = colors.HexColor("#637083")
PALE = colors.HexColor("#F2F5F9")
WHITE = colors.white

TABLE_HEADER_STYLE = ParagraphStyle(
    "table-header",
    fontName="Helvetica-Bold",
    fontSize=7.2,
    leading=9.3,
    textColor=WHITE,
)
TABLE_CELL_STYLE = ParagraphStyle(
    "table-cell",
    fontName="Helvetica",
    fontSize=7.2,
    leading=9.3,
    textColor=INK,
    wordWrap="CJK",
)


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any):
    parsed = _parse_datetime(value)
    if parsed:
        return parsed.date()
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _name(item: dict, prefix: str) -> str:
    return str(item.get(f"{prefix}_name") or item.get(f"{prefix}_email") or "Unassigned")


def _truncate(value: Any, limit: int = 44) -> str:
    text = " ".join(str(value or "").split())
    return text or "-"


def _table_cell(value: Any, *, header: bool = False) -> Paragraph:
    text = escape(_truncate(value))
    return Paragraph(text, TABLE_HEADER_STYLE if header else TABLE_CELL_STYLE)


def _flatten(data: dict) -> tuple[list[dict], list[dict]]:
    projects = list(data.get("projects") or [])
    details = list(data.get("project_details") or [])
    tasks: list[dict] = []
    for project in details:
        for task in project.get("tasks") or []:
            tasks.append({**task, "project_name": project.get("project_name") or "Untitled project"})
    return projects, tasks


def _metric_card(label: str, value: str, note: str, accent=BLUE) -> Table:
    card = Table(
        [[Paragraph(label.upper(), ParagraphStyle("metric-label", fontName="Helvetica-Bold", fontSize=7, textColor=MUTED, leading=9)),
          Paragraph(value, ParagraphStyle("metric-value", fontName="Helvetica-Bold", fontSize=20, textColor=NAVY, leading=23))],
         [Paragraph(note, ParagraphStyle("metric-note", fontName="Helvetica", fontSize=7.5, textColor=MUTED, leading=10)), ""]],
        colWidths=[33 * mm, 18 * mm],
        rowHeights=[13 * mm, 10 * mm],
    )
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#DDE4ED")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("SPAN", (0, 1), (1, 1)),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return card


def _status_chart(status_counts: Counter) -> Drawing:
    labels = ["Open", "In progress", "Close review", "Closed"]
    values = [status_counts.get(key, 0) for key in ("OPEN", "IN PROGRESS", "CLOSE REQUESTED", "CLOSED")]
    drawing = Drawing(250, 145)
    pie = Pie()
    pie.x, pie.y, pie.width, pie.height = 16, 22, 100, 100
    pie.data = values if sum(values) else [1]
    pie.labels = None
    pie.slices.strokeWidth = 0.5
    palette = (BLUE, CYAN, AMBER, GREEN)
    for index, colour in enumerate(palette):
        pie.slices[index].fillColor = colour
    drawing.add(pie)
    legend_values = values if sum(values) else [0, 0, 0, 0]
    for index, (label, value, colour) in enumerate(zip(labels, legend_values, palette)):
        y = 102 - index * 20
        drawing.add(Rect(134, y - 1, 8, 8, fillColor=colour, strokeColor=colour))
        drawing.add(String(149, y, f"{label}  {value}", fontName="Helvetica", fontSize=7.5, fillColor=INK))
    drawing.add(String(10, 136, "Task portfolio by workflow stage", fontName="Helvetica-Bold", fontSize=10, fillColor=NAVY))
    return drawing


def _activity_chart(activity_by_day: Counter, period_start: datetime, generated_at: datetime) -> Drawing:
    buckets = []
    cursor = period_start.date()
    while cursor <= generated_at.date():
        bucket_end = min(cursor + timedelta(days=6), generated_at.date())
        value = sum(activity_by_day.get(cursor + timedelta(days=offset), 0) for offset in range((bucket_end - cursor).days + 1))
        buckets.append((cursor.strftime("%d %b"), value))
        cursor = bucket_end + timedelta(days=1)
    drawing = Drawing(250, 145)
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 35, 30, 195, 88
    chart.data = [[value for _, value in buckets]]
    chart.categoryAxis.categoryNames = [label for label, _ in buckets]
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max([value for _, value in buckets] + [1]) * 1.15
    chart.valueAxis.valueStep = max(1, int(chart.valueAxis.valueMax / 4))
    chart.bars[0].fillColor = BLUE
    chart.bars[0].strokeColor = BLUE
    chart.categoryAxis.labels.fontSize = 6.5
    chart.valueAxis.labels.fontSize = 6.5
    drawing.add(chart)
    drawing.add(String(10, 136, "Recorded delivery events - last 30 days", fontName="Helvetica-Bold", fontSize=10, fillColor=NAVY))
    return drawing


def _data_table(rows: list[list[Any]], widths: list[float], repeat_rows: int = 1) -> Table:
    wrapped_rows = [
        [_table_cell(cell, header=row_index < repeat_rows) for cell in row]
        for row_index, row in enumerate(rows)
    ]
    table = Table(wrapped_rows, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D8E0EA")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def build_board_report(data: dict, generated_for: str | None = None) -> bytes:
    generated_at = datetime.now(timezone.utc)
    period_start = generated_at - timedelta(days=30)
    projects, tasks = _flatten(data)
    status_counts = Counter(str(task.get("status") or "OPEN").upper() for task in tasks)
    today = generated_at.date()
    overdue = [task for task in tasks if str(task.get("status") or "").upper() != "CLOSED" and _parse_date(task.get("end_date")) and _parse_date(task.get("end_date")) < today]
    unassigned = [task for task in tasks if not task.get("assigned_to_email") and not task.get("assigned_to_name")]
    work_logs = [(task, log) for task in tasks for log in task.get("work_logs") or []]
    access_logs = [(task, log) for task in tasks for log in task.get("access_logs") or []]
    period_events = [(task, log, parsed) for task, log in access_logs if (parsed := _parse_datetime(log.get("created_at"))) and parsed >= period_start]
    period_work = [(task, log, parsed) for task, log in work_logs if (parsed := _parse_datetime(log.get("created_at") or log.get("work_date"))) and parsed >= period_start]
    hours_30d = sum(float(log.get("hours") or 0) for _, log, _ in period_work)
    closed_30d = sum(1 for _, log, _ in period_events if str(log.get("event_type") or "").upper() == "TASK_CLOSED")
    created_30d = sum(1 for _, log, _ in period_events if str(log.get("event_type") or "").upper() == "TASK_CREATED")
    progress_events = {"TASK_CREATED", "TASK_WORK_STARTED", "TASK_CLOSE_REQUESTED", "TASK_CLOSED", "TASK_WORK_LOGGED", "TASK_COMMENT_ADDED", "TASK_ASSIGNEE_CHANGED", "TASK_DUE_DATE_CHANGED"}
    delivery_events = [(task, log, parsed) for task, log, parsed in period_events if str(log.get("event_type") or "").upper() in progress_events]
    activity_by_day = Counter(parsed.date() for _, _, parsed in delivery_events)
    contributor_events: Counter[str] = Counter()
    contributor_hours: Counter[str] = Counter()
    for _, log, _ in delivery_events:
        actor = _name(log, "actor")
        if actor != "Unassigned":
            contributor_events[actor] += 1
    for _, log, _ in period_work:
        contributor_hours[_name(log, "logged_by")] += float(log.get("hours") or 0)
    active_contributors = set(contributor_events) | {name for name in contributor_hours if name != "Unassigned"}
    stakeholder_coverage = sum(1 for project in projects if project.get("stakeholder_name") or project.get("stakeholder_email"))
    completion_rate = (status_counts.get("CLOSED", 0) / len(tasks) * 100) if tasks else 0

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=18 * mm,
        bottomMargin=17 * mm,
        title="Nexora Board Delivery Report",
        author="Nexora Task Tracker",
        subject="Board-level evidence of delivery activity and execution",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle("board-title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=WHITE, alignment=TA_LEFT)
    subtitle = ParagraphStyle("board-subtitle", parent=styles["Normal"], fontSize=10, leading=14, textColor=colors.HexColor("#D9E5F5"))
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=4, spaceAfter=8)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=BLUE, spaceBefore=7, spaceAfter=5)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=8.6, leading=12.4, textColor=INK, spaceAfter=5)
    small = ParagraphStyle("small", parent=body, fontSize=7.2, leading=10, textColor=MUTED)
    callout = ParagraphStyle("callout", parent=body, fontSize=10, leading=14, textColor=NAVY, alignment=TA_CENTER)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D9E1EB"))
        canvas.line(15 * mm, 13 * mm, 195 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, 8.5 * mm, "NEXORA  -  BOARD DELIVERY REPORT  -  INTERNAL")
        canvas.drawRightString(195 * mm, 8.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    story = []
    cover = Table([
        [Paragraph("NEXORA", ParagraphStyle("brand", fontName="Helvetica-Bold", fontSize=10, textColor=CYAN, leading=12))],
        [Spacer(1, 15 * mm)],
        [Paragraph("Board Delivery<br/>Report", title)],
        [Paragraph("Evidence of work, execution momentum and delivery health", subtitle)],
        [Spacer(1, 15 * mm)],
        [Paragraph(f"REPORTING WINDOW<br/><b>{period_start:%d %B %Y} - {generated_at:%d %B %Y}</b>", ParagraphStyle("period", fontName="Helvetica", fontSize=8, leading=14, textColor=WHITE))],
        [Spacer(1, 46 * mm)],
        [Paragraph(f"Generated {generated_at:%d %B %Y, %H:%M UTC}" + (f"<br/>Prepared for {generated_for}" if generated_for else ""), subtitle)],
    ], colWidths=[180 * mm], rowHeights=[8 * mm, 15 * mm, 35 * mm, 18 * mm, 15 * mm, 20 * mm, 46 * mm, 20 * mm])
    cover.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 14 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 14 * mm), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [cover, PageBreak(), Paragraph("Executive view", h1)]
    story.append(Paragraph("This report translates Nexora's operational records into board-level evidence of work. Snapshot KPIs describe the current authorized portfolio; movement KPIs use recorded events and work logs from the last 30 days.", body))
    cards = [
        _metric_card("Active portfolio", str(len(projects)), "Projects visible in this report", BLUE),
        _metric_card("Delivery pipeline", str(len(tasks)), "Tasks across all workflow stages", CYAN),
        _metric_card("Closed in period", str(closed_30d), "Recorded closure events in 30 days", GREEN),
    ]
    story += [Table([cards], colWidths=[60 * mm] * 3, style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]), Spacer(1, 4 * mm)]
    cards2 = [
        _metric_card("Delivery events", str(len(delivery_events)), "Recorded progress signals in 30 days", BLUE),
        _metric_card("Work evidenced", f"{hours_30d:,.1f}h", "Hours logged in the period", CYAN),
        _metric_card("Contributors", str(len(active_contributors)), "People with events or hours in period", GREEN),
    ]
    story += [Table([cards2], colWidths=[60 * mm] * 3, style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]), Spacer(1, 5 * mm)]
    signals = []
    if created_30d:
        signals.append(f"{created_30d} task{'s were' if created_30d != 1 else ' was'} added to the delivery pipeline in the period.")
    if closed_30d:
        signals.append(f"{closed_30d} task{'s reached' if closed_30d != 1 else ' reached'} closure, providing an auditable completion signal.")
    if overdue:
        signals.append(f"{len(overdue)} open task{'s are' if len(overdue) != 1 else ' is'} past due and should receive management attention.")
    if unassigned:
        signals.append(f"{len(unassigned)} task{'s lack' if len(unassigned) != 1 else ' lacks'} a named assignee, creating an ownership gap.")
    if not signals:
        signals.append("No exception or movement signal could be derived from the currently visible records.")
    story += [Paragraph("Board interpretation", h2), Paragraph(" ".join(signals), callout), Spacer(1, 4 * mm)]
    story.append(Table([[_status_chart(status_counts), _activity_chart(activity_by_day, period_start, generated_at)]], colWidths=[90 * mm, 90 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDE4ED"))]))

    story += [PageBreak(), Paragraph("Delivery health", h1)]
    health_rows = [
        ["Indicator", "Result", "Board meaning"],
        ["Portfolio completion", f"{completion_rate:.1f}%", f"{status_counts.get('CLOSED', 0)} of {len(tasks)} visible tasks are closed."],
        ["Work in motion", str(status_counts.get("IN PROGRESS", 0) + status_counts.get("CLOSE REQUESTED", 0)), "Tasks actively being worked or awaiting closure review."],
        ["Overdue exposure", str(len(overdue)), "Open tasks whose end date is before the report date."],
        ["Unassigned exposure", str(len(unassigned)), "Tasks without a named accountable assignee."],
        ["Stakeholder coverage", f"{stakeholder_coverage}/{len(projects)}", "Projects with a named stakeholder."],
        ["Recorded work", f"{hours_30d:,.1f} hours", "Work-log hours created or dated within the last 30 days."],
        ["Recorded movement", str(len(delivery_events)), "Task creation, workflow, work-log, comment, assignment and due-date events."],
    ]
    story += [_data_table(health_rows, [42 * mm, 28 * mm, 110 * mm]), Spacer(1, 6 * mm)]
    story += [Paragraph("Management attention", h2)]
    exception_rows = [["Project", "Task", "Owner", "Status", "Due date", "Signal"]]
    for task in sorted(overdue + [task for task in unassigned if task not in overdue], key=lambda item: (_parse_date(item.get("end_date")) or today, item.get("project_name", "")))[:20]:
        signals_for_task = []
        if task in overdue:
            signals_for_task.append("Overdue")
        if task in unassigned:
            signals_for_task.append("Unassigned")
        exception_rows.append([_truncate(task.get("project_name"), 24), _truncate(task.get("task_title"), 34), _truncate(_name(task, "assigned_to"), 24), task.get("status") or "OPEN", str(task.get("end_date") or "-"), ", ".join(signals_for_task)])
    if len(exception_rows) == 1:
        exception_rows.append(["-", "No overdue or unassigned tasks", "-", "-", "-", "No current exception"])
    story.append(_data_table(exception_rows, [28 * mm, 48 * mm, 31 * mm, 24 * mm, 22 * mm, 27 * mm]))

    story += [PageBreak(), Paragraph("People and participation", h1)]
    story.append(Paragraph("Participation is evidenced by named task events and work logs. Event volume is an activity signal, not a proxy for individual performance or value delivered.", body))
    people = sorted(active_contributors, key=lambda name: (contributor_events[name] + contributor_hours[name]), reverse=True)
    people_rows = [["Contributor", "Recorded events", "Hours logged", "Evidence mix"]]
    for person in people[:25]:
        evidence = []
        if contributor_events[person]:
            evidence.append("workflow/activity")
        if contributor_hours[person]:
            evidence.append("work logs")
        people_rows.append([_truncate(person, 42), contributor_events[person], f"{contributor_hours[person]:,.1f}", " + ".join(evidence)])
    if len(people_rows) == 1:
        people_rows.append(["No named contributor activity in period", "0", "0.0", "No evidence available"])
    story += [_data_table(people_rows, [68 * mm, 33 * mm, 32 * mm, 47 * mm]), Spacer(1, 6 * mm), Paragraph("Project accountability", h2)]
    project_rows = [["Project", "Status", "Stakeholder", "Watchers", "Tasks", "Closed", "Exceptions"]]
    details_by_id = {project.get("id"): project for project in data.get("project_details") or []}
    for project in projects:
        project_tasks = list((details_by_id.get(project.get("id")) or {}).get("tasks") or [])
        exceptions = sum(1 for task in project_tasks if task in overdue or task in unassigned)
        watchers = project.get("watchers") or []
        project_rows.append([_truncate(project.get("project_name"), 32), project.get("status") or "ACTIVE", _truncate(_name(project, "stakeholder"), 26), str(len(watchers)), str(len(project_tasks)), str(sum(1 for task in project_tasks if str(task.get("status") or "").upper() == "CLOSED")), str(exceptions)])
    if len(project_rows) == 1:
        project_rows.append(["No projects visible", "-", "-", "0", "0", "0", "0"])
    story.append(_data_table(project_rows, [43 * mm, 22 * mm, 43 * mm, 18 * mm, 17 * mm, 17 * mm, 20 * mm]))

    story += [PageBreak(), Paragraph("Evidence register", h1)]
    story.append(Paragraph("The latest recorded events provide traceability from portfolio claims back to operational actions. Up to 40 events from the reporting window are shown.", body))
    event_rows = [["When (UTC)", "Project", "Task", "Event", "Actor", "Evidence note"]]
    for task, log, parsed in sorted(delivery_events, key=lambda item: item[2], reverse=True)[:40]:
        event_rows.append([parsed.strftime("%d %b %Y\n%H:%M"), _truncate(task.get("project_name"), 22), _truncate(task.get("task_title"), 27), _truncate(str(log.get("event_type") or "").replace("_", " ").title(), 24), _truncate(_name(log, "actor"), 22), _truncate(log.get("event_note"), 38)])
    if len(event_rows) == 1:
        event_rows.append(["-", "-", "No events in period", "-", "-", "-"])
    story.append(_data_table(event_rows, [23 * mm, 31 * mm, 39 * mm, 31 * mm, 29 * mm, 27 * mm]))

    story += [PageBreak(), Paragraph("Metric definitions and data assurance", h1)]
    definitions = [
        ("Active portfolio", "Count of projects returned by the authorized dashboard snapshot."),
        ("Delivery pipeline", "Count of tasks returned across those projects, regardless of status."),
        ("Closed in period", "Count of TASK_CLOSED access-log events timestamped in the last 30 days."),
        ("Delivery events", "Task creation, work start, close request, closure, work logging, comment, assignment change and due-date change events in the last 30 days."),
        ("Contributors", "Distinct named actors in delivery events plus named people with work logs in the period."),
        ("Overdue", "A non-closed task with an end date before the UTC report date."),
        ("Completion", "Current closed tasks divided by all current visible tasks; this is a portfolio snapshot, not period throughput."),
    ]
    story.append(_data_table([["Metric", "Definition"]] + [[name, definition] for name, definition in definitions], [42 * mm, 138 * mm]))
    story += [Spacer(1, 6 * mm), Paragraph("Data assurance notes", h2)]
    notes = [
        "This PDF is generated from the same authorized dashboard dataset available to the requesting user; it is not based on client-entered report figures.",
        "The repository does not currently expose project/task creation timestamps in dashboard response objects. Period creation is therefore derived from TASK_CREATED access events; historical records without backfilled events may be understated.",
        "No budget, cost, revenue, benefit, milestone, dependency, priority, risk, quality/defect, customer outcome or strategic objective fields exist in the reviewed product. The report must not imply financial or outcome performance from activity alone.",
        "Work-log hours are self-reported operational evidence. Event and hour volume should not be used as an individual productivity ranking.",
        "Status and due-date accuracy depends on timely user updates. Board interpretation should be accompanied by management commentary for material projects.",
    ]
    for note in notes:
        story.append(Paragraph(f"- {note}", body))
    story += [Spacer(1, 5 * mm), Paragraph("Recommended next reporting capabilities", h2), Paragraph("Add strategic objective, sponsor, accountable owner, planned/actual milestone dates, priority, health/RAG, budget/forecast/actual, expected benefit, realized outcome, dependency, risk, issue and quality fields. Preserve immutable lifecycle timestamps and publish a server-side reporting API with explicit period and portfolio filters. These additions would move the report from evidence of activity to evidence of strategic execution and value.", body)]

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
