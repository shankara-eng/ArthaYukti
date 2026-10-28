"""Write the OpenAPI document to contracts/openapi.json (run with: python -m app.export_openapi)."""

import json
from pathlib import Path

from app.main import app

OPENAPI_PATH = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OPENAPI_PATH.write_text(render(), encoding="utf-8")
    print(f"Wrote {OPENAPI_PATH}")
