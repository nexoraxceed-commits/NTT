import unittest

from pydantic import ValidationError

from app.profiles import ProfileUpdateRequest


class ProfileValidationTest(unittest.TestCase):
    def test_normalises_fields(self):
        p = ProfileUpdateRequest(vertical="ipr", roll_no=" b26182 ", phone="98765 43210", linkedin_url="linkedin.com/in/x", skills="  research ")
        self.assertEqual((p.vertical, p.roll_no, p.phone, p.linkedin_url, p.skills),
                         ("IPR", "B26182", "9876543210", "https://linkedin.com/in/x", "research"))

    def test_blank_optional_fields_become_none(self):
        p = ProfileUpdateRequest(vertical="VAD", roll_no="H26138", phone="", linkedin_url=" ", skills="")
        self.assertIsNone(p.phone)
        self.assertIsNone(p.linkedin_url)
        self.assertIsNone(p.skills)

    def test_rejects_bad_values(self):
        for bad in ({"vertical": "HR"}, {"roll_no": "hello"}, {"phone": "123"}, {"linkedin_url": "example.com"}):
            with self.assertRaises(ValidationError):
                ProfileUpdateRequest(**bad)


if __name__ == "__main__":
    unittest.main()
