"""scripts/cars_r2.py against a fake S3 client (spec 022 R8/R9)."""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path

import pytest

from app.cars.ingest import r2

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "cars_r2.py"
spec = importlib.util.spec_from_file_location("cars_r2", SCRIPT)
cars_r2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cars_r2)

ENV = {
    "CARS_R2_ACCOUNT_ID": "acc",
    "CARS_R2_ACCESS_KEY_ID": "k",
    "CARS_R2_SECRET_ACCESS_KEY": "s",
    "CARS_R2_BUCKET": "cars-private",
}


class FakeS3:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def upload_file(self, path, bucket, key):
        self.objects[key] = Path(path).read_bytes()

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}

    def head_bucket(self, Bucket):
        return {}

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        return {
            "KeyCount": len(keys),
            "Contents": [{"Key": k, "Size": len(self.objects[k])} for k in keys],
        }


@pytest.fixture
def configured(monkeypatch):
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    return FakeS3()


def test_check_reports_missing_names_without_values(capsys):
    assert cars_r2.main(["check"]) == 1
    out = capsys.readouterr().out
    assert "CARS_R2_ACCOUNT_ID" in out and "not configured" in out


def test_push_listings_pull_and_ls(configured, tmp_path, capsys, monkeypatch):
    fake = configured
    src = tmp_path / "listings.csv"
    src.write_text("snapshot_date,ad_id_or_url\n2026-10-31,u1\n", encoding="utf-8")
    monkeypatch.setenv("CARS_R2_LISTINGS_KEY", "listings/listings.csv")
    assert cars_r2.main(["push-listings", str(src)], client=fake) == 0
    assert fake.objects["listings/listings.csv"].startswith(b"snapshot_date")
    raw = tmp_path / "raw" / "listings_csv" / "2026-10-31"
    raw.mkdir(parents=True)
    (raw / "abc.csv").write_text("x", encoding="utf-8")
    assert cars_r2.main(["push-raw", str(tmp_path / "raw")], client=fake) == 0
    assert "raw/listings_csv/2026-10-31/abc.csv" in fake.objects
    dest = tmp_path / "back.csv"
    assert cars_r2.main(["pull", "listings/listings.csv", str(dest)], client=fake) == 0
    assert dest.read_text(encoding="utf-8") == src.read_text(encoding="utf-8")
    assert cars_r2.main(["ls", "raw/"], client=fake) == 0
    assert cars_r2.main(["check"], client=fake) == 0
    out = capsys.readouterr().out
    assert "1 object(s)" in out and "bucket reachable" in out
    assert "secret" not in out.lower()  # names are fine, values never printed


def test_env_file_fallback_fills_only_missing_cars_values(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "CARS_R2_ACCOUNT_ID=file-acc\nCARS_R2_ACCESS_KEY_ID=file-k\n"
        "CARS_R2_SECRET_ACCESS_KEY=file-s\nCARS_R2_BUCKET=file-bucket\nMAPBOX_TOKEN=nope\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(r2, "ENV_FILE", env_file)
    monkeypatch.setenv("CARS_R2_BUCKET", "real-bucket")
    e = r2.environ()
    assert e["CARS_R2_BUCKET"] == "real-bucket"  # process env wins
    assert e["CARS_R2_ACCOUNT_ID"] == "file-acc"
    assert "MAPBOX_TOKEN" not in e or e.get("MAPBOX_TOKEN") != "nope"  # only CARS_* are filled
    assert r2.configured() and r2.bucket() == "real-bucket"
