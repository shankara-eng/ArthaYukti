"""AI help for Plan B, with a fake Gemini client: the suite never needs a key or the network.

What these pin: the key is backend-only and its absence is reported plainly; routes need a sign-in; the model's
output is validated (invented figures are dropped or refused); provider failures become clean errors; nothing
sensitive is logged or returned.
"""

import json
import logging
import urllib.error

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.ai import gemini
from app.ai.assist import numbers_in
from app.ai.gemini import AIFailure, HttpGeminiClient, get_gemini
from app.config import settings
from app.main import app
from tests.engine.test_recovery_eval import example
from tests.helpers import authed_client

BASE = "/api/v1/ai"
KEY = "test-key-NOT-REAL-0123456789"


class Fake:
    """Stands in for Gemini. `reply` is the parsed JSON it 'returns'; `seen` records the prompts it was given."""

    def __init__(self, reply=None, failure: AIFailure | None = None):
        self.reply, self.failure, self.seen = reply, failure, []

    def generate_json(self, system: str, user: str):
        self.seen.append((system, user))
        if self.failure:
            raise self.failure
        return self.reply(user) if callable(self.reply) else self.reply


@pytest.fixture()
def client() -> TestClient:
    ratelimit.reset_for_tests()
    c = authed_client("ai")
    yield c
    app.dependency_overrides.pop(get_gemini, None)


def use(fake: Fake) -> Fake:
    app.dependency_overrides[get_gemini] = lambda: fake
    return fake


TEXT = "My income falls from 1,00,000 to 60k for six months from next month. I cannot pause my loan EMI or insurance."
GOOD = {
    "disruption": "income_reduction",
    "start_month": "2026-11",
    "duration_months": 6,
    "income_before": 100000,
    "income_during": 60000,
    "new_monthly_cost": None,
    "cash_available": None,
    "cannot_change": ["loan EMI", "insurance"],
    "unclear": [],
}


def draft(client, text=TEXT, **kw):
    return client.post(f"{BASE}/situation-draft", json={"text": text, "current_month": "2026-10", **kw})


# ---- availability and sign-in ------------------------------------------------------------------------------------


def test_status_needs_a_sign_in_and_reports_no_key_without_revealing_anything(client, monkeypatch):
    assert TestClient(app).get(f"{BASE}/status").status_code == 401
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    assert client.get(f"{BASE}/status").json() == {"available": False}
    monkeypatch.setattr(settings, "GEMINI_API_KEY", KEY)
    response = client.get(f"{BASE}/status")
    assert response.json() == {"available": True} and KEY not in response.text


def test_without_a_key_the_ai_routes_say_so_and_everything_else_still_works(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    response = draft(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "ai_not_configured"
    # Plan B itself does not depend on the AI.
    assert client.post("/api/v1/recovery/evaluate", json=example()).status_code == 200


def test_the_ai_routes_need_a_sign_in(client):
    use(Fake(GOOD))
    anonymous = TestClient(app)
    assert anonymous.post(f"{BASE}/situation-draft", json={"text": "x", "current_month": "2026-10"}).status_code == 401
    assert anonymous.post(f"{BASE}/explain-recovery", json={"input": example()}).status_code == 401


# ---- reading a description ---------------------------------------------------------------------------------------


def test_a_description_becomes_a_checked_draft_with_the_protected_items_kept(client):
    fake = use(Fake(GOOD))
    body = draft(client).json()
    assert body["disruption"] == "income_reduction" and body["start_month"] == "2026-11"
    assert body["duration_months"] == 6
    assert body["income_before"] == "100000" or float(body["income_before"]) == 100000.0
    assert float(body["income_during"]) == 60000.0
    assert body["cannot_change"] == ["loan EMI", "insurance"]
    assert body["generated"] is True and "Check every value" in body["notice"]
    assert body["clarifications"] == []
    # Only the person's words and the month went out: no token, email or id.
    prompt = fake.seen[0][1]
    assert "Bearer" not in prompt and "@example.test" not in prompt and "2026-10" in prompt


def test_a_figure_that_is_not_in_the_description_is_dropped_and_asked_for_not_invented(client):
    reply = {**GOOD, "income_before": 70000, "cash_available": 500000}
    use(Fake(reply))
    body = draft(client).json()
    assert body["income_before"] is None and body["cash_available"] is None
    asked = " ".join(body["clarifications"])
    assert "your income before the change" in asked and "savings you can use" in asked
    assert "What was your monthly take-home income before the change?" in body["clarifications"]


def test_a_missing_detail_produces_a_question_never_a_guess(client):
    use(Fake({**GOOD, "duration_months": None, "start_month": None, "income_during": None}))
    asked = draft(client, text="My income is going down.").json()["clarifications"]
    assert "How many months will it last? You can also say you do not know." in asked
    assert "When does the change begin?" in asked
    assert "What will your monthly take-home income be during the change?" in asked


def test_phrases_the_person_did_not_use_and_control_characters_never_get_through(client):
    use(Fake({**GOOD, "cannot_change": ["loan EMI", "sell my house", "insu\x00rance"]}))
    assert draft(client).json()["cannot_change"] == ["loan EMI"]


def test_figures_written_as_k_lakh_words_and_commas_are_recognised():
    assert {50000, 150000, 6, 12, 100000, 2500000}.issubset(
        {int(n) for n in numbers_in("50k, 1.5 lakh, six months, a year, 1,00,000 and 25 lakh")}
    )


@pytest.mark.parametrize("reply", [["not", "an", "object"], "text", None])
def test_an_answer_that_is_not_the_expected_shape_is_refused(client, reply):
    use(Fake(reply))
    response = draft(client)
    assert response.status_code == 502 and response.json()["error"]["code"] == "ai_bad_response"


@pytest.mark.parametrize(
    "failure,status,code",
    [
        (AIFailure(429, "ai_rate_limited", "busy"), 429, "ai_rate_limited"),
        (AIFailure(504, "ai_timeout", "slow"), 504, "ai_timeout"),
        (AIFailure(503, "ai_unavailable", "down"), 503, "ai_unavailable"),
    ],
)
def test_provider_failures_become_clean_errors(client, failure, status, code):
    use(Fake(failure=failure))
    response = draft(client)
    assert response.status_code == status and response.json()["error"]["code"] == code


def test_the_description_is_validated_before_anything_is_sent(client):
    fake = use(Fake(GOOD))
    assert draft(client, text="   ").status_code == 422
    assert draft(client, text="x" * (settings.AI_MAX_INPUT_CHARS + 1)).status_code == 422
    assert draft(client, current_month="next month").status_code == 422
    assert fake.seen == []


def test_one_account_cannot_use_up_the_ai_budget(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    use(Fake(GOOD))
    codes = [draft(client).status_code for _ in range(22)]
    assert codes[:20] == [200] * 20 and codes[20:] == [429, 429]


# ---- explaining a plan -------------------------------------------------------------------------------------------


def plan_input():
    data = example(months=6, income_months=6, home_pause_max=12)
    data["permissions"] = [{"item_id": "home", "action": "pause", "max_months": 12}]
    data["adjustments"] = [{"item_id": "home", "action": "pause", "from_month": "2026-11", "to_month": "2027-04"}]
    return data


def facts_of(user_prompt: str) -> dict:
    return json.loads(user_prompt.split("FACTS:\n", 1)[1])


def wording(user_prompt: str) -> dict:
    facts = facts_of(user_prompt)
    return {
        "summary": f"Your cash ends at {facts['cash_at_end']} and the lowest month-end is {facts['lowest_month_end_cash']['amount']}.",
        "kept_as_is": [f"{label} is paid as usual." for label in facts["protected_and_unchanged"][:3]],
        "changed": [f"{line}." for line in facts["adjustments"]],
        "returns_to_plan": "Nothing comes back by itself.",
        "caution": "This describes your own numbers only.",
    }


def test_the_explanation_is_worded_from_figures_the_server_calculated(client):
    fake = use(Fake(wording))
    # The client supplies only the plan; a wrong or invented result cannot be injected.
    response = client.post(f"{BASE}/explain-recovery", json={"input": plan_input(), "language": "en"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["generated"] is True and "not a calculation" in body["notice"]
    facts = facts_of(fake.seen[0][1])
    evaluated = client.post("/api/v1/recovery/evaluate", json=plan_input()).json()
    assert facts["cash_at_end"] == evaluated["final_liquid"] and facts["feasible"] == evaluated["feasible"]
    assert facts["lowest_month_end_cash"]["amount"] == evaluated["minimum_liquid"]
    assert facts["protected_balances_withdrawn"] == "0.00"
    assert evaluated["final_liquid"] in body["summary"]


def test_wording_that_uses_a_figure_the_engine_did_not_produce_is_refused(client):
    def invented(prompt):
        return {**wording(prompt), "summary": "You will have 9,99,999 rupees left, which is plenty."}

    use(Fake(invented))
    response = client.post(f"{BASE}/explain-recovery", json={"input": plan_input()})
    assert response.status_code == 502 and response.json()["error"]["code"] == "ai_unverified"


def test_an_explanation_with_no_summary_is_refused(client):
    use(Fake(lambda p: {**wording(p), "summary": "  "}))
    assert client.post(f"{BASE}/explain-recovery", json={"input": plan_input()}).status_code == 502


def test_an_invalid_plan_is_rejected_before_the_model_is_asked(client):
    fake = use(Fake(wording))
    bad = plan_input()
    bad["adjustments"][0]["item_id"] = "emi"  # a protected item
    assert client.post(f"{BASE}/explain-recovery", json={"input": bad}).status_code == 422
    assert fake.seen == []


def test_an_infeasible_plan_is_reported_as_infeasible_to_the_model(client):
    fake = use(Fake(wording))
    unchanged = example(months=6, income_months=6)
    assert client.post(f"{BASE}/explain-recovery", json={"input": unchanged}).status_code == 200
    facts = facts_of(fake.seen[0][1])
    assert facts["feasible"] is False and facts["problems"][0]["kind"] == "reserve_floor"


# ---- the Gemini client itself ------------------------------------------------------------------------------------


class _Response:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n=-1):
        return self._payload


def _ok(text: str) -> _Response:
    return _Response(json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]}).encode())


def test_the_http_client_sends_the_key_only_as_a_header_and_parses_the_answer(monkeypatch):
    sent = {}

    def urlopen(request, timeout):
        sent["url"], sent["headers"], sent["body"], sent["timeout"] = request.full_url, dict(request.header_items()), request.data, timeout
        return _ok('{"a": 1}')

    monkeypatch.setattr(gemini.urllib.request, "urlopen", urlopen)
    assert HttpGeminiClient(KEY, "gemini-test", 7.0).generate_json("system", "user") == {"a": 1}
    assert KEY not in sent["url"] and KEY.encode() not in sent["body"]
    assert sent["headers"]["X-goog-api-key"] == KEY and sent["timeout"] == 7.0
    assert b'"responseMimeType": "application/json"' in sent["body"]


@pytest.mark.parametrize(
    "error,status,code",
    [
        (urllib.error.HTTPError("u", 429, "x", {}, None), 429, "ai_rate_limited"),
        (urllib.error.HTTPError("u", 403, "x", {}, None), 503, "ai_unavailable"),
        (urllib.error.HTTPError("u", 500, "x", {}, None), 502, "ai_unavailable"),
        (urllib.error.URLError("no route"), 504, "ai_timeout"),
        (TimeoutError(), 504, "ai_timeout"),
    ],
)
def test_the_http_client_turns_provider_errors_into_clean_failures(monkeypatch, caplog, error, status, code):
    def urlopen(request, timeout):
        raise error

    monkeypatch.setattr(gemini.urllib.request, "urlopen", urlopen)
    with caplog.at_level(logging.DEBUG), pytest.raises(AIFailure) as caught:
        HttpGeminiClient(KEY, "m", 1.0).generate_json("system PROMPT-SECRET", "user PROMPT-SECRET")
    assert (caught.value.status_code, caught.value.code) == (status, code)
    # Neither the key nor the prompt reaches the message or the logs.
    assert KEY not in caught.value.message and KEY not in caplog.text and "PROMPT-SECRET" not in caplog.text


@pytest.mark.parametrize("payload", [b"not json", b'{"candidates": []}', json.dumps({"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}).encode()])
def test_the_http_client_refuses_malformed_replies(monkeypatch, payload):
    monkeypatch.setattr(gemini.urllib.request, "urlopen", lambda request, timeout: _Response(payload))
    with pytest.raises(AIFailure) as caught:
        HttpGeminiClient(KEY, "m", 1.0).generate_json("s", "u")
    assert caught.value.code == "ai_bad_response"


def test_an_oversized_reply_is_refused(monkeypatch):
    monkeypatch.setattr(gemini.urllib.request, "urlopen", lambda request, timeout: _Response(b"x" * (gemini.MAX_REPLY_BYTES + 5)))
    with pytest.raises(AIFailure):
        HttpGeminiClient(KEY, "m", 1.0).generate_json("s", "u")


def test_the_dependency_needs_a_key_and_a_sane_model_name(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", KEY)
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-2.5-flash")
    assert isinstance(get_gemini(), HttpGeminiClient)
    monkeypatch.setattr(settings, "GEMINI_MODEL", "../evil?x=1")
    with pytest.raises(Exception) as caught:
        get_gemini()
    assert getattr(caught.value, "code", "") == "ai_not_configured"


def test_the_key_never_appears_in_the_api_contract_or_responses():
    schema = json.dumps(app.openapi())
    assert "GEMINI" not in schema and KEY not in schema


def test_http_client_retries_transient_503_and_succeeds(monkeypatch):
    calls = []

    def urlopen(request, timeout):
        calls.append(request)
        if len(calls) == 1:
            raise urllib.error.HTTPError("u", 503, "Unavailable", {}, None)
        return _ok('{"retried": true}')

    monkeypatch.setattr(gemini.urllib.request, "urlopen", urlopen)
    client = HttpGeminiClient(KEY, "m", 2.0, max_retries=1, retry_delay=0.01)
    res = client.generate_json("s", "u")
    assert res == {"retried": True}
    assert len(calls) == 2


def test_http_client_does_not_retry_rate_limit_429(monkeypatch):
    calls = []

    def urlopen(request, timeout):
        calls.append(request)
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(gemini.urllib.request, "urlopen", urlopen)
    client = HttpGeminiClient(KEY, "m", 2.0, max_retries=1, retry_delay=0.01)
    with pytest.raises(AIFailure) as caught:
        client.generate_json("s", "u")
    assert caught.value.code == "ai_rate_limited"
    assert len(calls) == 1


def test_http_client_refuses_unsafe_finish_reason(monkeypatch):
    payload = json.dumps({
        "candidates": [
            {
                "finishReason": "SAFETY",
                "content": {"parts": [{"text": '{"bad": true}'}]},
            }
        ]
    }).encode()
    monkeypatch.setattr(gemini.urllib.request, "urlopen", lambda request, timeout: _Response(payload))
    client = HttpGeminiClient(KEY, "m", 2.0)
    with pytest.raises(AIFailure) as caught:
        client.generate_json("s", "u")
    assert caught.value.code == "ai_bad_response"


def test_gemini_config_defaults_and_limits():
    assert settings.GEMINI_TIMEOUT_SECONDS > 0
    assert settings.AI_MAX_INPUT_CHARS == 1500
    assert settings.GEMINI_MODEL in ("gemini-2.5-flash", "gemini-3.5-flash-lite")

