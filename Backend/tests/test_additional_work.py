import unittest

from app.main import get_or_create_additional_work_project, is_additional_work_project


class _Query:
    def __init__(self, table):
        self.table = table
        self.inserted = None

    def select(self, *_a, **_k):
        return self

    def ilike(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def insert(self, row):
        self.inserted = row
        return self

    def execute(self):
        if self.inserted is not None:
            row = {"id": 77, **self.inserted}
            self.table.rows.append(row)
            return type("R", (), {"data": [row]})()
        return type("R", (), {"data": list(self.table.rows)})()


class _Table:
    def __init__(self, rows):
        self.rows = rows


class _Supabase:
    def __init__(self, rows):
        self._table = _Table(rows)

    def table(self, _name):
        return _Query(self._table)


class AdditionalWorkTests(unittest.TestCase):
    def test_name_match_is_case_insensitive(self):
        self.assertTrue(is_additional_work_project({"project_name": " additional WORK "}))
        self.assertFalse(is_additional_work_project({"project_name": "Sponsor outreach"}))

    def test_reuses_open_bucket(self):
        supabase = _Supabase([{"id": 5, "project_name": "Additional work", "status": "OPEN"}])
        self.assertEqual(get_or_create_additional_work_project(supabase, "u1")["id"], 5)

    def test_creates_bucket_when_only_closed_exists(self):
        supabase = _Supabase([{"id": 5, "project_name": "Additional work", "status": "CLOSED"}])
        project = get_or_create_additional_work_project(supabase, "u1")
        self.assertEqual(project["id"], 77)
        self.assertEqual(project["created_by"], "u1")
        self.assertIsNone(project["stakeholder_id"])


if __name__ == "__main__":
    unittest.main()
