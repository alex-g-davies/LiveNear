"""Single-origin serving of the built SPA (006 R2, 025 R5)."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Client-side route prefixes. `cars` stays so old links reach the app, which
# redirects them to /drive-cheap.
SPA_PREFIXES = ("live-near", "drive-cheap", "cars")


def mount_spa(app: FastAPI, root: Path) -> None:
    """Serve the SPA from `root`; call after every API route is registered.

    A hard reload of a client-side route must get the SPA shell, not a 404
    from the static mount. Other unknown paths still return 404.
    """
    index = root / "index.html"

    def spa_shell(rest: str = "") -> FileResponse:
        return FileResponse(index)

    for prefix in SPA_PREFIXES:
        app.add_api_route(f"/{prefix}", spa_shell, include_in_schema=False)
        app.add_api_route(f"/{prefix}/{{rest:path}}", spa_shell, include_in_schema=False)

    app.mount("/", StaticFiles(directory=root, html=True), name="spa")
