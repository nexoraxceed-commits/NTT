import unittest
from types import SimpleNamespace

from app.email_codes import email_codes_available, make_code, verify_code

S = SimpleNamespace(supabase_secret_key="secret", mailjet_api_key="k", mailjet_secret_key="s", mailjet_from_email="a@b.c")


class EmailCodeTest(unittest.TestCase):
    def test_round_trip_and_window(self):
        t = 1_700_000_000
        code = make_code(S, "signup", "A@x.in", now=t)
        self.assertEqual(len(code), 6)
        self.assertTrue(verify_code(S, "signup", "a@x.in", code, now=t))
        self.assertTrue(verify_code(S, "signup", "a@x.in", code, now=t + 600))
        self.assertFalse(verify_code(S, "signup", "a@x.in", code, now=t + 1300))

    def test_scoped_by_purpose_email_and_secret(self):
        t = 1_700_000_000
        code = make_code(S, "signup", "a@x.in", now=t)
        self.assertFalse(verify_code(S, "reset", "a@x.in", code, now=t))
        self.assertFalse(verify_code(S, "signup", "b@x.in", code, now=t))
        other = SimpleNamespace(**{**S.__dict__, "supabase_secret_key": "other"})
        self.assertFalse(verify_code(other, "signup", "a@x.in", code, now=t))

    def test_rejects_junk(self):
        self.assertFalse(verify_code(S, "signup", "a@x.in", "12ab"))
        self.assertFalse(verify_code(S, "signup", "a@x.in", ""))

    def test_available_needs_all_keys(self):
        self.assertTrue(email_codes_available(S))
        self.assertFalse(email_codes_available(SimpleNamespace(**{**S.__dict__, "mailjet_from_email": None})))


if __name__ == "__main__":
    unittest.main()
