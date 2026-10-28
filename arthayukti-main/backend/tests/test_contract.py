from app.export_openapi import OPENAPI_PATH, render


def test_committed_openapi_matches_the_code():
    assert OPENAPI_PATH.exists(), "contracts/openapi.json is missing: run `make gen-api`"
    assert OPENAPI_PATH.read_text(encoding="utf-8") == render(), (
        "contracts/openapi.json is stale: run `make gen-api` and commit the result"
    )
