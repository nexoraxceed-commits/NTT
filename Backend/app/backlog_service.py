import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from pathlib import Path
from threading import Event, Thread
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


logger = logging.getLogger(__name__)

WEEKDAYS = {
    "MONDAY": 0,
    "TUESDAY": 1,
    "WEDNESDAY": 2,
    "THURSDAY": 3,
    "FRIDAY": 4,
    "SATURDAY": 5,
    "SUNDAY": 6,
}


@dataclass(frozen=True)
class BacklogConfig:
    service_name: str
    run_time: time
    weekdays: frozenset[int]
    timezone: tzinfo
    timezone_name: str


def load_backlog_config(path: Path) -> BacklogConfig:
    properties: dict[str, str] = {}
    if not path.exists():
        raise RuntimeError(f"Backlog configuration file does not exist: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator:
            properties[key.strip()] = value.strip()

    service_name = properties.get("service.name", "").lower()
    if service_name != "backlog":
        raise RuntimeError("service.name must be 'backlog'.")

    raw_time = properties.get("backlog.time", "23:59")
    try:
        run_time = datetime.strptime(raw_time, "%H:%M").time()
    except ValueError as exc:
        raise RuntimeError("backlog.time must use 24-hour HH:mm format.") from exc

    raw_days = properties.get("backlog.days", "")
    day_names = {value.strip().upper() for value in raw_days.split(",") if value.strip()}
    invalid_days = day_names.difference(WEEKDAYS)
    if invalid_days:
        raise RuntimeError(
            f"Unsupported backlog.days value(s): {', '.join(sorted(invalid_days))}."
        )
    if not day_names:
        raise RuntimeError("backlog.days must contain at least one weekday.")

    timezone_name = properties.get("backlog.timezone", "Asia/Kolkata")
    try:
        service_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        if timezone_name in {"Asia/Kolkata", "Asia/Calcutta"}:
            service_timezone = timezone(timedelta(hours=5, minutes=30), "Asia/Kolkata")
        else:
            raise RuntimeError(
                f"Unsupported backlog.timezone value: {timezone_name}."
            ) from exc

    return BacklogConfig(
        service_name=service_name,
        run_time=run_time,
        weekdays=frozenset(WEEKDAYS[name] for name in day_names),
        timezone=service_timezone,
        timezone_name=timezone_name,
    )


def next_run_at(config: BacklogConfig, now: datetime) -> datetime:
    if now.tzinfo is None:
        now = now.replace(tzinfo=config.timezone)
    else:
        now = now.astimezone(config.timezone)
    for days_ahead in range(8):
        candidate_date = now.date() + timedelta(days=days_ahead)
        candidate = datetime.combine(candidate_date, config.run_time, config.timezone)
        if candidate.weekday() in config.weekdays and candidate > now:
            return candidate
    raise RuntimeError("Unable to calculate the next backlog run time.")


class BacklogService:
    def __init__(self, config: BacklogConfig, run_batch: Callable[[date], int]):
        self.config = config
        self.run_batch = run_batch
        self._stop_event = Event()
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self._run, name="backlog-service", daemon=True)
        self._thread.start()
        logger.info("Backlog service started; next run is %s.", next_run_at(self.config, datetime.now(self.config.timezone)))

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            now = datetime.now(self.config.timezone)
            scheduled_at = next_run_at(self.config, now)
            wait_seconds = max(0.0, (scheduled_at - now).total_seconds())
            if self._stop_event.wait(wait_seconds):
                return
            try:
                sent_count = self.run_batch(scheduled_at.date())
                logger.info("Backlog service sent %s overdue-task reminder(s).", sent_count)
            except Exception:
                logger.exception("Backlog service run failed.")
