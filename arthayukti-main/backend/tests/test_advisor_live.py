"""Opt-in check against the real Gemini API, with the key in backend/.env. Skipped unless RUN_LIVE_GEMINI=1.

It proves the wiring (the bounded tool loop, the checks on the reply) against the real service. It asserts on the
safety of the outcome, not on what the model says, because that differs from run to run.
"""

import os

import pytest

from app.ai.gemini import ai_configured
from tests.api.test_advisor_api import BASE, save, stretched
from tests.helpers import authed_client

pytestmark = pytest.mark.skipif(os.environ.get("RUN_LIVE_GEMINI") != "1" or not ai_configured(), reason="live Gemini is opt-in")


def test_live_analysis_is_safe_whatever_the_model_says():
    client = authed_client("live")
    save(client, stretched())
    out = client.post(f"{BASE}/analyze", json={"use_ai": True, "language": "en"}).json()
    print("ai_status:", out["ai_status"], "| ai_used:", out["ai_used"], "| notes:", [n["code"] for n in out["validation_notes"]])
    assert out["ai_status"] in ("ok", "invalid_output", "failed")
    assert out["goal_date_comparison"] and out["report"]["recommendations"]
    known = {s["id"] for s in out["scenarios"]}
    for rec in out["report"]["recommendations"]:
        assert rec["scenario_id"] is None or rec["scenario_id"] in known  # nothing points at a calculation that was not run
        assert all(s["feasible"] for s in out["scenarios"] if s["id"] == rec["scenario_id"])
    answer = client.post(f"{BASE}/chat", json={"analysis_id": out["id"], "message": "What if I reduce discretionary spending by 5%?"}).json()
    print("chat ai_used:", answer["ai_used"])
    assert answer["scenarios"] and answer["answer"]
