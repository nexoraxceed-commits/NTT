import unittest

from app.access_policy import is_request_allowed_for_user_class


class ReadOnlyUserTests(unittest.TestCase):
    def setUp(self):
        self.user_class = "REDUNDANT_USER"

    def test_allows_read_requests(self):
        self.assertTrue(
            is_request_allowed_for_user_class(self.user_class, "GET", "/projects")
        )
        self.assertTrue(
            is_request_allowed_for_user_class(self.user_class, "HEAD", "/health")
        )

    def test_allows_logout(self):
        self.assertTrue(
            is_request_allowed_for_user_class(
                self.user_class, "POST", "/auth/logout"
            )
        )

    def test_blocks_application_mutations(self):
        for method, path in (
            ("POST", "/tasks/1/comments"),
            ("PATCH", "/tasks/1/comments/2"),
            ("DELETE", "/notifications/1"),
        ):
            with self.subTest(method=method, path=path):
                self.assertFalse(
                    is_request_allowed_for_user_class(
                        self.user_class, method, path
                    )
                )

    def test_does_not_restrict_other_user_classes(self):
        self.assertTrue(
            is_request_allowed_for_user_class("JUNIOR", "POST", "/tasks/1/comments")
        )


if __name__ == "__main__":
    unittest.main()
