"""Move the cars module's private data to and from the owner's R2 bucket.

    python scripts/cars_r2.py check                      # config + bucket reachable
    python scripts/cars_r2.py push-listings              # contract listings.csv -> listings key
    python scripts/cars_r2.py push-raw                   # data/cars/private/raw/** -> raw/**
    python scripts/cars_r2.py push <local-file> <key>    # any single file
    python scripts/cars_r2.py pull <key> <local-file>
    python scripts/cars_r2.py ls [prefix]

Credentials come from CARS_R2_ACCOUNT_ID, CARS_R2_ACCESS_KEY_ID,
CARS_R2_SECRET_ACCESS_KEY and CARS_R2_BUCKET in the environment or in
backend/.env (gitignored). Values are never printed. The web service reads
the same bucket at startup (CARS_R2_LISTINGS_KEY, default
listings/listings.csv) to serve the per-cohort listing drill-down; the
fitted bundle itself ships with the repo.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.cars.ingest import r2  # noqa: E402

PRIVATE = BACKEND / "data" / "cars" / "private"
CONTRACT_LISTINGS = PRIVATE / "contract" / "listings.csv"
RAW_DIR = PRIVATE / "raw"


def listings_key() -> str:
    return r2.environ().get("CARS_R2_LISTINGS_KEY") or "listings/listings.csv"


def cmd_check(client) -> int:
    env = r2.environ()
    missing = [k for k in r2.REQUIRED if not str(env.get(k, "")).strip()]
    if missing:
        print("not configured; missing:", ", ".join(missing))
        print(f"set them in the environment or in {r2.ENV_FILE}")
        return 1
    client.head_bucket(Bucket=r2.bucket())
    resp = client.list_objects_v2(Bucket=r2.bucket(), MaxKeys=1)
    print(f"ok: bucket reachable, {'non-empty' if resp.get('KeyCount') else 'empty'}")
    print(f"listings key: {listings_key()}")
    return 0


def cmd_push(client, local: Path, key: str) -> int:
    if not local.is_file():
        print(f"no such file: {local}")
        return 1
    r2.upload_file(local, key, client=client)
    print(f"uploaded {local} -> {key} ({local.stat().st_size} bytes)")
    return 0


def cmd_push_raw(client, root: Path) -> int:
    files = sorted(p for p in root.rglob("*") if p.is_file())
    if not files:
        print(f"nothing under {root}")
        return 1
    for p in files:
        key = "raw/" + p.relative_to(root).as_posix()
        r2.upload_file(p, key, client=client)
        print(f"uploaded {key}")
    print(f"{len(files)} file(s)")
    return 0


def cmd_pull(client, key: str, local: Path) -> int:
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(r2.download_text(key, client=client), encoding="utf-8", newline="")
    print(f"downloaded {key} -> {local}")
    return 0


def cmd_ls(client, prefix: str) -> int:
    token = None
    n = 0
    while True:
        kw = {"Bucket": r2.bucket(), "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        for obj in resp.get("Contents", []):
            print(f"{obj['Size']:>10}  {obj['Key']}")
            n += 1
        token = resp.get("NextContinuationToken")
        if not token:
            break
    print(f"{n} object(s)")
    return 0


def main(argv: list[str] | None = None, client=None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    pl = sub.add_parser("push-listings")
    pl.add_argument("path", nargs="?", type=Path, default=CONTRACT_LISTINGS)
    pr = sub.add_parser("push-raw")
    pr.add_argument("dir", nargs="?", type=Path, default=RAW_DIR)
    pp = sub.add_parser("push")
    pp.add_argument("local", type=Path)
    pp.add_argument("key")
    pu = sub.add_parser("pull")
    pu.add_argument("key")
    pu.add_argument("local", type=Path)
    ls = sub.add_parser("ls")
    ls.add_argument("prefix", nargs="?", default="")
    a = p.parse_args(argv)

    if a.cmd == "check" and not r2.configured():
        return cmd_check(None)
    try:
        c = client or r2._client()
    except RuntimeError as exc:
        print(exc)
        return 1
    if a.cmd == "check":
        return cmd_check(c)
    if a.cmd == "push-listings":
        return cmd_push(c, a.path, listings_key())
    if a.cmd == "push-raw":
        return cmd_push_raw(c, a.dir)
    if a.cmd == "push":
        return cmd_push(c, a.local, a.key)
    if a.cmd == "pull":
        return cmd_pull(c, a.key, a.local)
    return cmd_ls(c, a.prefix)


if __name__ == "__main__":
    sys.exit(main())
