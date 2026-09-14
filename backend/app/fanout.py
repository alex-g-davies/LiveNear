"""Bounded parallel fan-out for the Mapbox clients (spec 020 follow-up).

A drive-mode reach update makes three Isochrone calls and a commute estimate
makes six Directions calls; run sequentially each interaction waited N round
trips. Running one batch concurrently on a small shared thread pool brings the
wait down to roughly one round trip while spending exactly the same number of
upstream calls — the budget breaker and caches are untouched.

The pool is deliberately small: the per-IP rate limiter already bounds how
many batches can be in flight, and Mapbox's own per-token ceilings are far
above what this pool can produce.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

T = TypeVar("T")

# Enough to run one drive-mode commute (6 calls) plus one isochrone batch (3)
# fully in parallel; further batches queue rather than opening more sockets.
MAX_WORKERS = 12

_pool = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="mapbox")


def run_parallel(tasks: Sequence[Callable[[], T]]) -> list[T | BaseException]:
    """Run zero-arg callables concurrently; return their results in order.

    A task that raises contributes its exception object instead of a value
    (asyncio.gather(return_exceptions=True) semantics), so callers decide per
    task whether a failure is fatal or merely skipped."""
    if not tasks:
        return []
    if len(tasks) == 1:
        try:
            return [tasks[0]()]
        except Exception as exc:  # noqa: BLE001 — mirrored back to the caller
            return [exc]
    futures = [_pool.submit(task) for task in tasks]
    out: list[T | BaseException] = []
    for fut in futures:
        exc = fut.exception()
        out.append(exc if exc is not None else fut.result())
    return out
