"""Overdue reminders actually go out to active juniors.

Regression test for Nov 2026: the reminder job reported 0 reminders every
day because the user lookup didn't return the account status, so every
assignee looked inactive and was skipped.
"""
from datetime import date

import app.main as main


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.row = db, table, [], None

    def select(self, *_a, **_k):
        return self

    def insert(self, row):
        self.row = row
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: r.get(key) == value)
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) < value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def limit(self, _n):
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.row is not None:
            if self.table not in self.db["_existing"]:
                raise Exception(f'relation "public.{self.table}" does not exist')
            key = (self.row.get("task_id"), self.row.get("recipient_user_id") or self.row.get("recipient_email"),
                   self.row.get("reminder_type") or self.row.get("kind"),
                   self.row.get("sent_for_date") or self.row.get("sent_on"))
            if key in self.db["_keys"]:
                raise Exception("duplicate key value violates unique constraint")
            self.db["_keys"].add(key)
            rows.append(dict(self.row))
            return _Result([self.row])
        return _Result([r for r in rows if all(f(r) for f in self.filters)])


class _Supabase:
    def __init__(self, db):
        self.db = db

    def table(self, name):
        return _Query(self.db, name)


def _setup(monkeypatch, existing_tables, juniors=3):
    tasks = [
        {"id": i, "project_id": 7, "task_title": "Get started on NTT", "end_date": "2026-10-30",
         "status": "OPEN", "assigned_to": f"uid-{i}"}
        for i in range(1, juniors + 1)
    ]
    db = {"TASKS": tasks, "_existing": set(existing_tables), "_keys": set()}
    users = {
        f"uid-{i}": {"user_id": f"j{i}@x.in", "user_name": f"Junior {i}", "auth_uid": f"uid-{i}",
                     "user_class": "JUNIOR", "status": "NORMAL"}
        for i in range(1, juniors + 1)
    }
    sent = []
    monkeypatch.setattr(main, "TASKS_TABLE", "TASKS")
    monkeypatch.setattr(main, "get_project_by_id", lambda _s, _pid: {"id": 7, "status": "OPEN"})
    monkeypatch.setattr(main, "ensure_project_is_active", lambda _p: None)
    monkeypatch.setattr(main, "get_ref_users_by_auth_uids", lambda _s, _a, ids: {i: users[i] for i in ids if i in users})
    monkeypatch.setattr(main, "get_ref_user", lambda *_a: {"auth_uid": "uid-sec", "user_id": "sec@x.in", "status": "NORMAL"})
    monkeypatch.setattr(main, "notify_user_ids", lambda *a, **k: set())
    monkeypatch.setattr(main, "get_project_team", lambda *_a: [])
    monkeypatch.setattr(main, "get_project_watchers", lambda *_a: [])
    monkeypatch.setattr(main, "send_mailjet_notification", lambda _s, email, *_a, **_k: sent.append(email) or True)

    class _Settings:
        signup_allowed_users_email_column = "user_id"
        signup_allowed_users_status_column = "status"

    return _Supabase(db), _Settings(), sent


def test_juniors_three_days_overdue_get_emailed_without_premature_escalation(monkeypatch):
    supabase, settings, sent = _setup(monkeypatch, {"TASK_REMINDER_LOG"})
    summary = main.send_daily_task_reminders(supabase, settings, date(2026, 11, 2))
    assert summary["reminders"] == 3
    assert summary["emails_sent"] == 3
    assert sorted(sent) == ["j1@x.in", "j2@x.in", "j3@x.in"]
    # Never reminded before today, so the secretary isn't told they ignored reminders.
    assert summary["escalations"] == 0
    # Running again the same day sends nothing new.
    again = main.send_daily_task_reminders(supabase, settings, date(2026, 11, 2))
    assert again["reminders"] == 0 and again["skipped"]["reminder_duplicate"] == 3


def test_falls_back_to_daily_reminders_table(monkeypatch):
    supabase, settings, sent = _setup(monkeypatch, {"TASK_DAILY_REMINDERS"}, juniors=2)
    summary = main.send_daily_task_reminders(supabase, settings, date(2026, 11, 2))
    assert summary["reminders"] == 2 and len(sent) == 2


def test_no_log_table_sends_nothing_and_says_why(monkeypatch):
    supabase, settings, sent = _setup(monkeypatch, set(), juniors=2)
    summary = main.send_daily_task_reminders(supabase, settings, date(2026, 11, 2))
    assert summary["reminders"] == 0 and not sent
    assert summary["skipped"]["reminder_no_log_table"] == 2


def test_escalates_once_a_reminder_was_actually_sent(monkeypatch):
    supabase, settings, sent = _setup(monkeypatch, {"TASK_REMINDER_LOG"}, juniors=1)
    main.send_daily_task_reminders(supabase, settings, date(2026, 11, 5))  # day 6: reminder only
    summary = main.send_daily_task_reminders(supabase, settings, date(2026, 11, 6))  # day 7: escalation day
    assert summary["escalations"] == 1
    assert "sec@x.in" in sent
