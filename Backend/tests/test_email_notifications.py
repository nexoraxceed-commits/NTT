import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.email_notifications import send_mailjet_notification


class MailjetNotificationTests(unittest.TestCase):
    def setUp(self):
        self.settings = SimpleNamespace(
            mailjet_api_key="public-key",
            mailjet_secret_key="private-key",
            mailjet_from_email="notifications@example.com",
            mailjet_from_name="Nexora",
            frontend_origin="https://nexora.example",
        )

    @patch("app.email_notifications.httpx.post")
    def test_sends_task_link_through_v31_api(self, post):
        post.return_value.raise_for_status.return_value = None

        sent = send_mailjet_notification(
            self.settings,
            "user@example.com",
            "User",
            "Task assigned",
            'You were assigned "Prepare report".',
            "/task?id=42",
        )

        self.assertTrue(sent)
        request = post.call_args
        self.assertEqual(request.args[0], "https://api.mailjet.com/v3.1/send")
        message = request.kwargs["json"]["Messages"][0]
        self.assertEqual(message["To"][0]["Email"], "user@example.com")
        self.assertIn("https://nexora.example/task?id=42", message["HTMLPart"])

    @patch("app.email_notifications.httpx.post")
    def test_skips_email_when_credentials_are_missing(self, post):
        self.settings.mailjet_api_key = None

        sent = send_mailjet_notification(
            self.settings,
            "user@example.com",
            None,
            "Task assigned",
            "You were assigned a task.",
        )

        self.assertFalse(sent)
        post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
