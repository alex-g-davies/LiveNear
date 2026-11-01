"""FastAPI application entry point.

Run from backend/:  uvicorn app.main:app --reload
"""

import logging
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .cars import data_bundle
from .cars.data_bundle import BundleError
from .config import Settings, get_settings
from .data_loader import DataLoadError, get_data_store, load_regions
from .logging_setup import setup_logging
from .ratelimit import client_ip, limiter
from .routers import cars, commute, geocode, housing, isochrone

settings = get_settings()
setup_logging(settings.log_format)
access_logger = logging.getLogger("livenear.access")
logger = logging.getLogger(__name__)

# Loud startup signal for a missing token (021 R3): a freshly created Render
# service starts with no dashboard secrets, and the symptom — one static
# contour that ignores the pin — is easy to misread as a frontend bug.
if settings.isochrone_mode == "fixture":
    logger.warning(
        "MAPBOX_TOKEN not set: /api/isochrone serves the committed fixture (local dev); "
        "geocode and commute endpoints return 503"
    )
elif settings.isochrone_mode == "unavailable":
    logger.warning(
        "MAPBOX_TOKEN not set in production: isochrone, geocode and commute endpoints "
        "return 503 until the token is configured in the service environment"
    )

app = FastAPI(title="LiveNear", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],  # POST: stateless cars scenario runs (022 R10)
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

HEALTH_PATH = "/api/health"


@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:
    """Access log with timing + client IP (004 R5). Health probes are skipped
    to keep platform-probe noise out of the logs."""
    start = time.perf_counter()
    response = await call_next(request)
    if request.url.path != HEALTH_PATH:
        access_logger.info(
            "%s %s -> %d",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                "client_ip": client_ip(request),
            },
        )
    return response


app.include_router(housing.router)
app.include_router(isochrone.router)
app.include_router(geocode.router)
app.include_router(commute.router)
app.include_router(cars.router)


@app.get(HEALTH_PATH)
def health(cfg: Settings = Depends(get_settings)) -> JSONResponse:
    """Platform health probe (004 R6): verifies the region index parses and at
    least one state store loads. Fast after first call — stores are cached.
    Also reports the isochrone mode (021 R2) so a missing production token is
    visible from a single curl."""
    try:
        regions = load_regions()
        if regions:
            get_data_store(regions[0]["code"])
    except (DataLoadError, OSError, ValueError, KeyError):
        regions = []
    if not regions:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    # Cars bundle (022 R9): report its vintage and where listings come from, so
    # a deploy without R2 credentials is visible from one curl, never papered over.
    try:
        bundle = data_bundle.get_bundle(production=bool(cfg.static_dir.strip()))
        cars_info = {
            "bundle_as_of": bundle.meta.bundle_as_of.isoformat(),
            "listings": bundle.listings_mode,
        }
    except BundleError as exc:
        cars_info = {"bundle_as_of": None, "listings": "unavailable", "error": str(exc)}
    return JSONResponse(
        content={
            "status": "ok",
            "version": app.version,
            "states": len(regions),
            "isochrone": cfg.isochrone_mode,
            "cars": cars_info,
        }
    )


# Single-origin production serving (006 R2): the container sets STATIC_DIR to
# the built SPA; mounted last so /api/* keeps routing to the API. Local dev
# leaves it unset and runs the Vite dev server instead.
if settings.static_dir and Path(settings.static_dir).is_dir():
    _static_root = Path(settings.static_dir)
    _index = _static_root / "index.html"

    @app.get("/cars", include_in_schema=False)
    @app.get("/cars/{rest:path}", include_in_schema=False)
    def spa_cars(rest: str = "") -> FileResponse:
        """Client-side routes under /cars (022 R1): a hard reload of a deep
        link must serve the SPA shell, not a 404 from the static mount."""
        return FileResponse(_index)

    app.mount("/", StaticFiles(directory=_static_root, html=True), name="spa")
