"""Bounded LRU map for the Mapbox client caches (004 follow-up).

isochrone/geocode/commute each cached upstream responses in a plain module
dict: entries expired by TTL but were never *evicted*, so a long-lived
process leaked memory under a grid sweep (snapping bounds the key space,
but ~500 m cells nationwide is still millions of keys). BoundedCache keeps
the same surface those call sites use (get / [key] = / clear / len) and
adds a hard entry cap with least-recently-used eviction.

TTL checks stay at the call sites (values are (expires_at, payload)
tuples) and expired entries are deliberately NOT purged here: the
isochrone router serves a stale payload when Mapbox is down, so stale
entries must survive until capacity pressure evicts them.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class BoundedCache(Generic[K, V]):
    """Dict-like LRU map holding at most `max_entries` items."""

    def __init__(self, max_entries: int) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be >= 1")
        self.max_entries = max_entries
        self._data: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        """Return the value (refreshing its recency) or None."""
        try:
            self._data.move_to_end(key)
        except KeyError:
            return None
        return self._data[key]

    def __setitem__(self, key: K, value: V) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        elif len(self._data) >= self.max_entries:
            self._data.popitem(last=False)  # evict least recently used
        self._data[key] = value

    def __contains__(self, key: K) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        self._data.clear()


class ByteBudgetCache:
    """LRU map of `bytes` values capped by their total size, not their count.

    For payloads whose size varies by orders of magnitude (a car scenario
    response is 0.5 MB for 3 cars and 7 MB for 36), an entry cap does not
    bound memory. Storing the serialised bytes rather than the model also
    keeps each entry ~6x smaller than the equivalent pydantic object tree,
    and lets the allocator hand freed blocks back to the OS. A value larger
    than the whole budget is simply not cached.
    """

    def __init__(self, max_bytes: int) -> None:
        if max_bytes < 1:
            raise ValueError("max_bytes must be >= 1")
        self.max_bytes = max_bytes
        self.total_bytes = 0
        self._data: OrderedDict[str, bytes] = OrderedDict()

    def get(self, key: str) -> bytes | None:
        """Return the value (refreshing its recency) or None."""
        try:
            self._data.move_to_end(key)
        except KeyError:
            return None
        return self._data[key]

    def __setitem__(self, key: str, value: bytes) -> None:
        old = self._data.pop(key, None)
        if old is not None:
            self.total_bytes -= len(old)
        if len(value) > self.max_bytes:
            return
        while self._data and self.total_bytes + len(value) > self.max_bytes:
            _, evicted = self._data.popitem(last=False)  # least recently used
            self.total_bytes -= len(evicted)
        self._data[key] = value
        self.total_bytes += len(value)

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        self._data.clear()
        self.total_bytes = 0
