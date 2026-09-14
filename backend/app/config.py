"""Application settings.

This module is the ONLY place the Mapbox token and work location are read. The
token comes from the environment and must never be serialized into a response or
logged (R5).
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    """Settings loaded from environment / .env.

    `mapbox_token` is optional in LOCAL DEV: when blank we serve the committed
    isochrone fixture instead of calling Mapbox (fixture-first mode). In
    production (STATIC_DIR set) a blank token disables the commute endpoints
    instead — see `serve_fixture` (spec 021).
    """

    mapbox_token: str = ""
    # Default work location: the Museum of Flight, Seattle. Used when the client
    # does not pass an explicit lat/lon (the frontend lets users move the point).
    work_lat: float = 47.5180
    work_lon: float = -122.2966
    contour_minutes: int = 30
    use_fixture: bool = False

    # Frontend dev origin allowed through CORS. In production the SPA is served
    # same-origin by this app (spec 006), so this matters for local dev only.
    # Env format: CORS_ORIGINS='["https://example.com"]'
    cors_origins: list[str] = ["http://localhost:5173"]

    # Hard daily cap on upstream Mapbox calls across all endpoints (spec 004 R3).
    # Cache hits spend nothing. 0 disables the breaker.
    mapbox_daily_call_budget: int = 2000

    # "text" (human-readable, default) or "json" (single-line JSON for cloud
    # log ingestion). Read once at startup.
    log_format: str = "text"

    # When set to a directory, the built SPA is served from it at "/" (single
    # origin, spec 006 R2). Empty in local dev — Vite serves the frontend.
    static_dir: str = ""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def serve_fixture(self) -> bool:
        """True when the isochrone endpoint should serve the committed fixture
        rather than calling Mapbox: forced via USE_FIXTURE, or no token set in
        local dev (no STATIC_DIR). In production a missing token must NOT be
        papered over with a static Seattle polygon that ignores the pin
        (021 R1) — the endpoint returns 503 and /api/health reports it."""
        if self.use_fixture:
            return True
        return not self.mapbox_token.strip() and not self.static_dir.strip()

    @property
    def isochrone_mode(self) -> str:
        """'live' (token set), 'fixture' (committed polygon), or 'unavailable'
        (production with no token) — surfaced by /api/health (021 R2)."""
        if self.serve_fixture:
            return "fixture"
        return "live" if self.mapbox_token.strip() else "unavailable"


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor used as a FastAPI dependency (overridable in tests)."""
    return Settings()
