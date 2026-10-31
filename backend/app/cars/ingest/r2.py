"""Cloudflare R2 (S3-compatible) client for raw snapshots and private
listings (spec 022 R8, R9).

Configuration from the environment only (never logged):
  CARS_R2_ACCOUNT_ID, CARS_R2_ACCESS_KEY_ID, CARS_R2_SECRET_ACCESS_KEY,
  CARS_R2_BUCKET.  Endpoint: https://<account>.r2.cloudflarestorage.com

Tests inject a fake client through the `client=` argument or by
monkeypatching `_client`; nothing here touches the network at import time.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

ENV_ACCOUNT = "CARS_R2_ACCOUNT_ID"
ENV_KEY_ID = "CARS_R2_ACCESS_KEY_ID"
ENV_SECRET = "CARS_R2_SECRET_ACCESS_KEY"
ENV_BUCKET = "CARS_R2_BUCKET"
REQUIRED = (ENV_ACCOUNT, ENV_KEY_ID, ENV_SECRET, ENV_BUCKET)


def configured(env: dict[str, str] | None = None) -> bool:
    e = env if env is not None else os.environ
    return all(str(e.get(k, "")).strip() for k in REQUIRED)


def endpoint_url(account_id: str) -> str:
    return f"https://{account_id}.r2.cloudflarestorage.com"


def bucket(env: dict[str, str] | None = None) -> str:
    e = env if env is not None else os.environ
    return str(e.get(ENV_BUCKET, "")).strip()


def _client(env: dict[str, str] | None = None) -> Any:
    """A boto3 S3 client for R2. Raises RuntimeError when not configured so
    callers can report "unavailable" instead of failing silently."""
    e = env if env is not None else os.environ
    if not configured(e):
        missing = [k for k in REQUIRED if not str(e.get(k, "")).strip()]
        raise RuntimeError(f"R2 not configured: missing {', '.join(missing)}")
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url(e[ENV_ACCOUNT].strip()),
        aws_access_key_id=e[ENV_KEY_ID].strip(),
        aws_secret_access_key=e[ENV_SECRET].strip(),
        region_name="auto",
    )


def upload_file(path: Path | str, key: str, client: Any | None = None) -> str:
    c = client or _client()
    c.upload_file(str(path), bucket(), key)
    return key


def upload_text(
    text: str, key: str, client: Any | None = None, content_type: str = "text/plain"
) -> str:
    c = client or _client()
    c.put_object(Bucket=bucket(), Key=key, Body=text.encode("utf-8"), ContentType=content_type)
    return key


def download_text(key: str, client: Any | None = None) -> str:
    c = client or _client()
    obj = c.get_object(Bucket=bucket(), Key=key)
    body = obj["Body"].read()
    return body.decode("utf-8") if isinstance(body, bytes | bytearray) else str(body)
