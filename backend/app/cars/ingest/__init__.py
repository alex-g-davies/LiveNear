"""Ingestion core (spec 022 R8): fetch -> parse -> validate -> reconcile -> store.

    python -m app.cars.ingest.runner --help

Runs on the owner's laptop or in GitHub Actions, never in the web container.
Terms per source are recorded in docs/cars/sources.md before a source is
automated. There is no FINN adapter (CLAUDE.md hard constraint): used-car
listings arrive as the owner's CSV.
"""

from __future__ import annotations

USER_AGENT = "LiveNear-cars/0.1 (+https://github.com/alex-g-davies/LiveNear)"


class IngestError(RuntimeError):
    """A stage failed in a way that must stop the run."""


class SourceDisabled(RuntimeError):
    """The source cannot run here: missing key, pending terms check, or wrong host."""


__all__ = ["USER_AGENT", "IngestError", "SourceDisabled"]
