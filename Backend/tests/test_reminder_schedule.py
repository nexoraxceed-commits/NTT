import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://x.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "k")
os.environ.setdefault("SUPABASE_SECRET_KEY", "k")

from app.main import reminder_schedule  # noqa: E402


class ReminderScheduleTest(unittest.TestCase):
    def test_juniors_daily_with_escalation(self):
        reminded = [d for d in range(1, 12) if reminder_schedule("JUNIOR", d)["remind"]]
        escalated = [d for d in range(1, 12) if reminder_schedule("JUNIOR", d)["escalate"]]
        self.assertEqual(reminded, list(range(1, 12)))
        self.assertEqual(escalated, [3, 7, 11])
        self.assertFalse(reminder_schedule("JUNIOR", 5)["witty"])
        oversee = [d for d in range(1, 12) if reminder_schedule("JUNIOR", d)["oversee"]]
        self.assertEqual(oversee, [1, 4, 7, 10])
        self.assertFalse(any(reminder_schedule("SENIOR", d)["oversee"] for d in range(1, 12)))

    def test_seniors_every_second_day_then_witty(self):
        reminded = [d for d in range(1, 10) if reminder_schedule("SENIOR", d)["remind"]]
        witty = [d for d in range(1, 10) if reminder_schedule("ADMIN", d)["witty"]]
        self.assertEqual(reminded, [1, 3, 5, 7, 9])
        self.assertEqual(witty, [5, 7, 9])
        self.assertFalse(any(reminder_schedule("SENIOR", d)["escalate"] for d in range(1, 12)))

    def test_not_overdue_or_unknown(self):
        self.assertFalse(reminder_schedule("JUNIOR", 0)["remind"])
        self.assertFalse(reminder_schedule("REDUNDANT_USER", 4)["remind"])


if __name__ == "__main__":
    unittest.main()
