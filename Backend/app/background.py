"""Run slow side effects (web push, email) after the response is sent."""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

_logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ntt-notify")


def run_in_background(func: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    def _safe() -> None:
        try:
            func(*args, **kwargs)
        except Exception:  # noqa: BLE001 - a failed push or email must never surface to users
            _logger.exception("Background notification task failed")

    try:
        _executor.submit(_safe)
    except RuntimeError:
        # Executor is shutting down; fall back to running inline.
        _safe()
