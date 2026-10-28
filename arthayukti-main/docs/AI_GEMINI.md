# AI help (Gemini) in Plan B

Optional. With no key set, the app behaves exactly as before and Plan B shows a short note that AI help is off.

## What it does

| Where | Route | What the model is asked to do |
| --- | --- | --- |
| Top of Plan B | `POST /api/v1/ai/situation-draft` | Read a typed description ("my income falls to 60k for six months from next month, I cannot pause my EMI") into a **suggested** form draft: kind of change, start month, duration, incomes, new cost, cash, and the things the person said cannot change. |
| Each plan option | `POST /api/v1/ai/explain-recovery` | Put an already-evaluated plan into plain words: what stays, what changes, when the original plan comes back. |
| Both | `GET /api/v1/ai/status` | `{available: true/false}`. The page uses it to hide controls that would not work. |

All three need a signed-in user.

## What it never does

- It never decides feasibility or produces a number. The deterministic engine does that.
- For an explanation the **server** evaluates the plan (`evaluate_recovery`) and gives the model only the results. The browser cannot supply a result.
- The reply is checked before it is shown. A figure above 31 that is not among the engine's figures causes the whole explanation to be refused (`ai_unverified`); the calculated figures on the page are unaffected.
- A description's figures are kept only if the person's own text contains them (`50k`, `1.5 lakh`, `six months` and commas are understood). Anything else is dropped and turned into a question. Missing details are asked for in server-written sentences, never guessed. A "cannot change" phrase is kept only if the person actually wrote it.
- The draft only fills editable form fields. Nothing is searched, saved or calculated until the person continues, and filling the form makes earlier results stale.
- It cannot move money, save an agreement, or change a protected commitment.

## Privacy and security

- `GEMINI_API_KEY` is read only by the backend and sent only in the `x-goog-api-key` header of the request to Google. It is not in any `VITE_*` variable, response, log line, error message or the OpenAPI document (tests check this).
- What is sent: the typed description and the current month, or the evaluated plan facts (amounts, months, item labels the person typed, adjustments). Not sent: email, password, token, user id.
- Prompts and replies are not logged; only the kind of failure is.
- Limits: 1,500 characters of input (`AI_MAX_INPUT_CHARS`), 20 AI calls per account per 10 minutes, a 20 s timeout, and a 200 KB reply cap.
- The description text is treated as data. Whatever the model returns is validated against fixed shapes, so an instruction hidden in the text can at worst produce a wrong suggestion that the person sees and can edit.

## Failure behaviour

Provider and key problems become the app's normal error shape and a plain message on the page; calculations and saved agreements are unaffected.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `ai_not_configured` | 503 | No key (or an invalid model name) on this server. |
| `ai_rate_limited` | 429 | The provider or the per-account limit is busy. |
| `ai_timeout` | 504 | No answer in time. |
| `ai_unavailable` | 503 / 502 | Bad key, wrong model name, blocked project, or a provider error. |
| `ai_bad_response` | 502 | The reply was not the expected JSON. |
| `ai_unverified` | 502 | The wording used an uncalculated figure, so it was not shown. |

## Setup

1. Create a key in Google AI Studio (https://aistudio.google.com/apikey).
2. Put it in `backend/.env` (never in the frontend, never committed; `.env` is git-ignored):
   ```
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-2.5-flash
   ```
3. Restart the API. `GET /api/v1/ai/status` (signed in) should now say `available: true`.
4. In production set the same variable in the host's environment settings (Render), not in the repository.

`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`, which answered a live key on 2026-10-26 (the advisor's analysis, tool calls and follow-up chat all worked). If Google retires the name, the first call fails with `ai_unavailable`; change the variable, no code change needed.

## Testing without a key

`backend/tests/api/test_ai_assist_api.py` replaces the client with a fake (`app.dependency_overrides[get_gemini]`) and checks the HTTP client against a stubbed `urlopen`. `frontend/src/pages/app/PlanB.test.tsx` ("AI help") mocks the three routes. Neither needs a key or the network.

## Not verified

- The automated suite never calls Google: every test uses a fake client. A live check is opt-in (`RUN_LIVE_GEMINI=1 pytest tests/test_advisor_live.py`) and was run once against a real key; the model's wording varies from run to run, so it asserts only on safety (no invented ids, no rejected paths recommended).
- Quality of the model's reading of real descriptions (especially Hindi or mixed-language ones).

## Not built

A product-wide assistant. The only AI surfaces are the two above. The existing `/ai/consult` and `/ai/parse-intent` routes and the Advisor page are unchanged keyword rules and still say so. Other pages (calculators, scenario comparison) could reuse `app/ai/gemini.py` for explanations the same way; that is follow-up work.
