"""BoundedCache eviction semantics + the isochrone nesting-fallback warning
(004 follow-up): the Mapbox client caches must stay dict-compatible for
their call sites while never growing past their entry cap."""

import pytest
from shapely.geometry import Polygon

from app.bounded_cache import BoundedCache
from app.isochrone import enforce_nesting


def test_evicts_least_recently_used_at_capacity() -> None:
    cache: BoundedCache[str, int] = BoundedCache(2)
    cache["a"] = 1
    cache["b"] = 2
    cache["c"] = 3  # capacity 2 -> "a" (oldest) evicted
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3
    assert len(cache) == 2


def test_get_refreshes_recency() -> None:
    cache: BoundedCache[str, int] = BoundedCache(2)
    cache["a"] = 1
    cache["b"] = 2
    assert cache.get("a") == 1  # touch "a" -> "b" becomes LRU
    cache["c"] = 3
    assert cache.get("b") is None
    assert cache.get("a") == 1


def test_overwrite_does_not_evict() -> None:
    cache: BoundedCache[str, int] = BoundedCache(2)
    cache["a"] = 1
    cache["b"] = 2
    cache["a"] = 10  # update in place -> no eviction
    assert len(cache) == 2
    assert cache.get("a") == 10
    assert cache.get("b") == 2


def test_contains_and_clear() -> None:
    cache: BoundedCache[str, int] = BoundedCache(4)
    cache["a"] = 1
    assert "a" in cache
    assert "b" not in cache
    cache.clear()
    assert len(cache) == 0
    assert cache.get("a") is None


def test_rejects_nonpositive_capacity() -> None:
    with pytest.raises(ValueError):
        BoundedCache(0)


def test_stale_entries_survive_until_capacity_pressure() -> None:
    # The isochrone router deliberately serves stale payloads when Mapbox is
    # down (004 R4): an expired-but-uncontested entry must still be readable.
    cache: BoundedCache[str, tuple[float, str]] = BoundedCache(8)
    cache["k"] = (0.0, "stale-payload")  # expires_at in the past
    assert cache.get("k") == (0.0, "stale-payload")


def test_nesting_fallback_logs_warning(caplog: pytest.LogCaptureFixture) -> None:
    # Two disjoint bands -> empty intersection -> the inner band is kept
    # unclipped and the violation is surfaced in logs (not silent).
    outer = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
    inner = Polygon([(5, 5), (6, 5), (6, 6), (5, 6)])
    with caplog.at_level("WARNING", logger="app.isochrone"):
        result = enforce_nesting([("offpeak", outer), ("peak", inner)])
    assert result[1][1].equals(inner)  # fallback: unclipped
    assert any("nesting fallback" in r.message for r in caplog.records)
