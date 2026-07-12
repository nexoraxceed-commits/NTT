from copy import deepcopy
from dataclasses import dataclass
from time import monotonic
from typing import Any


@dataclass
class CacheEntry:
    value: Any
    expires_at: float


class TTLCache:
    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}

    def get(self, key: str) -> Any | None:
        entry = self._entries.get(key)
        if not entry:
            return None

        if entry.expires_at <= monotonic():
            self._entries.pop(key, None)
            return None

        return deepcopy(entry.value)

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            return

        self._entries[key] = CacheEntry(
            value=deepcopy(value),
            expires_at=monotonic() + ttl_seconds,
        )

    def delete(self, key: str) -> None:
        self._entries.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        for key in list(self._entries):
            if key.startswith(prefix):
                self._entries.pop(key, None)

    def clear(self) -> None:
        self._entries.clear()


backend_cache = TTLCache()
