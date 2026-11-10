"""SPA fallback (025 R5): client-side routes reload; other unknown paths 404."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import mount_spa

SHELL = "<!doctype html><title>shell</title>"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text(SHELL, encoding="utf-8")
    (tmp_path / "brand").mkdir()
    (tmp_path / "brand" / "logo.svg").write_text("<svg/>", encoding="utf-8")
    app = FastAPI()
    app.add_api_route("/api/ping", lambda: {"ok": True})
    mount_spa(app, tmp_path)
    return TestClient(app, follow_redirects=False)


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/live-near",
        "/drive-cheap",
        "/drive-cheap/market",
        "/drive-cheap/option/a%2Fb",
        "/cars",
        "/cars/compare",
        "/cars/compare/curves",
    ],
)
def test_client_routes_serve_the_shell(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert response.text == SHELL


def test_static_assets_are_not_shadowed(client: TestClient) -> None:
    response = client.get("/brand/logo.svg")
    assert response.status_code == 200
    assert response.text == "<svg/>"


def test_api_routes_are_not_shadowed(client: TestClient) -> None:
    assert client.get("/api/ping").json() == {"ok": True}


def test_other_unknown_paths_return_404(client: TestClient) -> None:
    assert client.get("/nope").status_code == 404
