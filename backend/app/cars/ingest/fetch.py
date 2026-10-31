"""Fetch and archive raw responses (spec 022 R8).

Every raw body is stored with its URL, fetch time and sha256 under
    <raw_dir>/<source>/<YYYY-MM-DD>/<sha256[:12]>.<ext>
plus a sidecar `<same>.meta.json`. With `r2=True` the same key goes to the
owner's R2 bucket (`raw/<source>/<date>/<sha12>.<ext>`). Local files the
owner supplies (CSVs) are archived the same way via `archive_bytes` so every
stored row can point at a `snapshot_sha256`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from . import USER_AGENT, r2

_EXT_BY_TYPE = {
    "application/json": "json",
    "text/csv": "csv",
    "text/html": "html",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/xml": "xml",
    "text/xml": "xml",
}


@dataclass(frozen=True)
class RawSnapshot:
    url: str
    fetched_at: datetime
    sha256: str
    path: Path
    source: str
    r2_key: str | None = None

    def read_bytes(self) -> bytes:
        return Path(self.path).read_bytes()

    def read_text(self, encoding: str = "utf-8") -> str:
        return self.read_bytes().decode(encoding, errors="replace")

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["fetched_at"] = self.fetched_at.isoformat()
        d["path"] = str(self.path)
        return d


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def ext_for(content_type: str | None, url: str, default: str = "bin") -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _EXT_BY_TYPE:
        return _EXT_BY_TYPE[ct]
    tail = url.split("?")[0].rsplit(".", 1)
    if len(tail) == 2 and 1 <= len(tail[1]) <= 5 and tail[1].isalnum():
        return tail[1].lower()
    return default


def archive_bytes(
    body: bytes,
    *,
    source: str,
    raw_dir: Path,
    url: str,
    fetched_at: datetime,
    ext: str,
    r2_upload: bool = False,
    r2_client: Any | None = None,
) -> RawSnapshot:
    digest = sha256_hex(body)
    day = fetched_at.date().isoformat()
    folder = Path(raw_dir) / source / day
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{digest[:12]}.{ext}"
    path.write_bytes(body)
    key = None
    if r2_upload:
        key = f"raw/{source}/{day}/{digest[:12]}.{ext}"
        r2.upload_file(path, key, client=r2_client)
    snap = RawSnapshot(
        url=url, fetched_at=fetched_at, sha256=digest, path=path, source=source, r2_key=key
    )
    path.with_suffix(path.suffix + ".meta.json").write_text(
        json.dumps(snap.to_dict(), indent=1), encoding="utf-8"
    )
    return snap


def fetch(
    url: str,
    source: str,
    raw_dir: Path,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json_body: Any | None = None,
    ext: str | None = None,
    client: httpx.Client | None = None,
    timeout: float = 30.0,
    r2_upload: bool = False,
    r2_client: Any | None = None,
    now: datetime | None = None,
) -> RawSnapshot:
    """GET/POST `url` with a descriptive User-Agent, archive the body, return
    the snapshot. Raises `httpx.HTTPStatusError` on non-2xx."""
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    own = client is None
    c = client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        resp = c.request(method, url, headers=hdrs, params=params, json=json_body)
        resp.raise_for_status()
        body = resp.content
        content_type = resp.headers.get("content-type")
    finally:
        if own:
            c.close()
    fetched_at = now or datetime.now(UTC)
    return archive_bytes(
        body,
        source=source,
        raw_dir=raw_dir,
        url=url,
        fetched_at=fetched_at,
        ext=ext or ext_for(content_type, url),
        r2_upload=r2_upload,
        r2_client=r2_client,
    )
