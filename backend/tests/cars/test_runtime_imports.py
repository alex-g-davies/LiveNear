"""The web image installs requirements.txt only (no pandas, statsmodels,
scipy, hypothesis). Importing the app must not pull them in: CI's Docker
smoke failed on exactly this on 2026-11-01."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
DEV_ONLY = ("pandas", "statsmodels", "scipy", "hypothesis", "playwright", "selectolax")


def test_app_import_does_not_need_dev_only_packages():
    code = (
        "import sys, json; import app.main; "
        f"print(json.dumps(sorted(m for m in {DEV_ONLY!r} if m in sys.modules)))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, check=True
    )
    assert json.loads(out.stdout.strip().splitlines()[-1]) == []
