import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app.backlog_service import load_backlog_config, next_run_at


class BacklogServiceTests(unittest.TestCase):
    def test_loads_service_properties(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "service.properties"
            path.write_text(
                "service.name=backlog\n"
                "backlog.time=23:59\n"
                "backlog.days=MONDAY,WEDNESDAY\n",
                encoding="utf-8",
            )

            config = load_backlog_config(path)

        self.assertEqual(config.service_name, "backlog")
        self.assertEqual(config.run_time.strftime("%H:%M"), "23:59")
        self.assertEqual(config.weekdays, frozenset({0, 2}))
        self.assertEqual(config.timezone_name, "Asia/Kolkata")

    def test_next_run_skips_unconfigured_days(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "service.properties"
            path.write_text(
                "service.name=backlog\nbacklog.time=23:59\nbacklog.days=WEDNESDAY\n",
                encoding="utf-8",
            )
            config = load_backlog_config(path)

        result = next_run_at(config, datetime(2026, 8, 3, 23, 59))

        self.assertEqual(result.replace(tzinfo=None), datetime(2026, 8, 5, 23, 59))
        self.assertEqual(result.utcoffset().total_seconds(), 5.5 * 60 * 60)

    def test_rejects_non_24_hour_time(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "service.properties"
            path.write_text(
                "service.name=backlog\nbacklog.time=11:59 PM\nbacklog.days=MONDAY\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "24-hour"):
                load_backlog_config(path)


if __name__ == "__main__":
    unittest.main()
