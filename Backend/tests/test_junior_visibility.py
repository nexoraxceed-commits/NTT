import unittest

from app.visibility import filter_tasks_for_junior, junior_may_open_task

CLASSES = {
    "senior@x.in": "SENIOR",
    "admin@x.in": "ADMIN",
    "junior@x.in": "JUNIOR",
    "other.junior@x.in": "JUNIOR",
}


def task(task_id, status, assignee, **extra):
    base = {
        "id": task_id,
        "status": status,
        "assigned_to_email": assignee,
        "stakeholder_email": "admin@x.in",
        "watchers": [],
        "work_logs": [{"hours": 2, "work_date": "2026-10-20", "logged_by_email": assignee, "logged_by_name": "N", "work_note": "secret note"}],
        "access_logs": [
            {"event_type": "TASK_CREATED"},
            {"event_type": "TASK_SENT_BACK", "event_note": "redo this"},
            {"event_type": "TASK_CLOSED"},
        ],
    }
    base.update(extra)
    return base


class JuniorVisibilityTest(unittest.TestCase):
    def test_senior_open_and_overdue_tasks_are_hidden_but_hours_kept(self):
        tasks = [
            task(1, "OPEN", "senior@x.in"),
            task(2, "IN PROGRESS", "admin@x.in", end_date="2020-01-01"),
            task(3, "CLOSE REQUESTED", "senior@x.in"),
        ]
        visible, merits = filter_tasks_for_junior(tasks, "junior@x.in", CLASSES)
        self.assertEqual(visible, [])
        self.assertEqual(len(merits), 3)
        self.assertNotIn("work_note", merits[0])

    def test_juniors_see_each_other_fully(self):
        tasks = [task(4, "OPEN", "other.junior@x.in", end_date="2020-01-01")]
        visible, merits = filter_tasks_for_junior(tasks, "junior@x.in", CLASSES)
        self.assertEqual([t["id"] for t in visible], [4])
        self.assertEqual(len(visible[0]["access_logs"]), 3)
        self.assertEqual(merits, [])

    def test_involved_junior_sees_senior_task(self):
        watched = task(5, "OPEN", "senior@x.in", watchers=[{"email": "Junior@x.in"}])
        reviewer = task(6, "OPEN", "senior@x.in", stakeholder_email="junior@x.in")
        visible, _ = filter_tasks_for_junior([watched, reviewer], "junior@x.in", CLASSES)
        self.assertEqual([t["id"] for t in visible], [5, 6])

    def test_closed_senior_task_shown_without_review_notes(self):
        visible, _ = filter_tasks_for_junior([task(7, "CLOSED", "senior@x.in")], "junior@x.in", CLASSES)
        self.assertEqual(len(visible), 1)
        events = [log["event_type"] for log in visible[0]["access_logs"]]
        self.assertEqual(events, ["TASK_CREATED", "TASK_CLOSED"])

    def test_unassigned_tasks_visible(self):
        visible, _ = filter_tasks_for_junior([task(8, "OPEN", None)], "junior@x.in", CLASSES)
        self.assertEqual(len(visible), 1)

    def test_direct_open_blocked(self):
        self.assertFalse(junior_may_open_task(task(9, "OPEN", "senior@x.in"), "junior@x.in", CLASSES))
        self.assertTrue(junior_may_open_task(task(9, "CLOSED", "senior@x.in"), "junior@x.in", CLASSES))


if __name__ == "__main__":
    unittest.main()
