"""Provenance recording (spec 022 R5).

Line-item code reads every outside value through `Ctx.use(input)`, which
unwraps the value and records which input ids the current line item used.
The arithmetic never sees ids, sources or statuses.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .models import In, Range, Status


@dataclass(frozen=True)
class InputRecord:
    id: str
    value: Any
    source: str
    as_of: date
    status: Status
    basis: str | None
    range: Range | None


@dataclass
class Ctx:
    records: dict[str, InputRecord] = field(default_factory=dict)
    used_by: dict[str, set[str]] = field(default_factory=dict)  # input id -> item keys
    _current: set[str] | None = None
    _current_key: str | None = None

    def use(self, inp: In[Any]) -> Any:
        if inp.id not in self.records:
            self.records[inp.id] = InputRecord(
                inp.id, inp.value, inp.source, inp.as_of, inp.status, inp.basis, inp.range
            )
        if self._current is not None and self._current_key is not None:
            self._current.add(inp.id)
            self.used_by.setdefault(inp.id, set()).add(self._current_key)
        return inp.value

    def note(
        self,
        id: str,
        value: Any,
        source: str,
        as_of: date,
        status: Status = "live",
        basis: str | None = None,
    ) -> Any:
        """Record a value that is not an `In` (e.g. a tax rule) and return it."""
        if id not in self.records:
            self.records[id] = InputRecord(id, value, source, as_of, status, basis, None)
        if self._current is not None and self._current_key is not None:
            self._current.add(id)
            self.used_by.setdefault(id, set()).add(self._current_key)
        return value

    @contextmanager
    def item(self, key: str) -> Iterator[set[str]]:
        prev, prev_key = self._current, self._current_key
        bucket: set[str] = set()
        self._current, self._current_key = bucket, key
        try:
            yield bucket
        finally:
            self._current, self._current_key = prev, prev_key

    def is_estimate(self, ids: set[str]) -> bool:
        return any(self.records[i].status == "estimate" for i in ids if i in self.records)
