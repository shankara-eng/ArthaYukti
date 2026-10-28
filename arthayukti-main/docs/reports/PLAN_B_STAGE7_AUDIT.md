# Plan B, Stage 7: final validation and demo readiness

Date: 2026-10-25. Branch `feat/tradeoffs` (base commit `e8563d9`). Nothing in Plan B is committed, pushed, merged or deployed.

## 1. What was verified

- The financial arithmetic, month by month, with a separate integer-paise script written from the research report (not the engine).
- Search, comparison, restoration, review and agreement behaviour, by reading the code and by new tests.
- The whole flow in the real local app (API on 8011, Vite on 5185, SQLite dev database, synthetic `@example.test` accounts).
- Backend and frontend suites, lint, types, build, SQLite and scratch PostgreSQL, migrations.
- Read-only deployment probes.

## 2. Independent month-by-month check

Convention: `cash_end = cash_start + income - mandatory - flexible - goal transfers`. Start cash ₹3,00,000, floor ₹1,80,000,
income ₹60,000 for six months. Monthly outflows: essentials 30,000, parents 10,000, EMI 10,000, insurance 5,000 (mandatory 55,000),
flexible 10,000, retirement 10,000, education 10,000, home 10,000. The script computed in integer paise and compared with
`/recovery/evaluate`: every month matched.

| Case | Month-end cash (₹), months 1 to 6 | Floor breaches |
| --- | --- | --- |
| No change | 2,65,000 · 2,30,000 · 1,95,000 · 1,60,000 · 1,25,000 · 90,000 | 2027-02 (month 4, ₹1,60,000) short 20,000; 2027-03 short 55,000; 2027-04 short 90,000 |
| Home paused | 2,75,000 · 2,50,000 · 2,25,000 · 2,00,000 · 1,75,000 · 1,50,000 | 2027-03 short 5,000; 2027-04 short 30,000 |
| Home paused + flexible cut to ₹5,000 | 2,80,000 · 2,60,000 · 2,40,000 · 2,20,000 · 2,00,000 · 1,80,000 | none (ends exactly at the floor, which passes) |
| 8 months, same adjustments | 2,80,000 · 2,60,000 · 2,40,000 · 2,20,000 · 2,00,000 · 1,80,000 · 1,60,000 · 1,40,000 | 2027-05 short 20,000; 2027-06 short 40,000 |

The 8-month case ends month 7 at ₹1,60,000 and month 8 at ₹1,40,000, a ₹40,000 shortfall at the end.

The ₹5,000 residual is not double counted: unspent income stays in cash and is never subtracted again. Education and retirement
contributions stay at ₹10,000 in every case; protected balances were never withdrawn (₹0.00).

## 3. Search and comparison (audit)

Verified by reading `recovery_search.py` / `recovery_compare.py` and by tests: excluded items never touched; protected and mandatory items
reported as ignored; duplicates removed by month-by-month vector; dominated plans removed; deterministic order and ids; status
`found` / `infeasible` (whole space checked) / `incomplete` (cut by limit, never called "no solution"); default limit 1500; wide ranges capped
at about 24 levels per item; no "best" claimed when plans give up different things.

Defect found and fixed (D3): at the maximum limit (20,000) a very wide space held a worker for about 68 s. A work budget of 100,000
candidate-months now bounds every search (same space: 8.1 s at limit 20,000, 2.1 s at the default 1,500), and the response says which limit applied.

## 4. Restoration and review (audit)

Verified: a review alone never restores; a date alone cannot restore; income, cash and confirmation conditions are ANDed; a failed condition
does not restore; partial and stepped restoration and the future-floor guard behave as documented.

Defects found and fixed:

- D1, review counted a pause allowance afresh from the review month, so reviewing again extended a pause. The review now counts months already
  paused (from the saved schedule) against `max_months`; if the allowance is used up the item resumes and the result says so and does not "fit".
- D2, a confirmation saved in the agreement was ignored by the review. It is now carried (a later date waits for its month).

Limitation (cannot be fixed with this data model): the review cannot take the person's real past. Balances and pause counts are rebuilt from
the saved schedule; the figures typed are cash at the start of the review month and income from then on.

## 5. Agreements

Covered by `test_recovery_api.py` (28 tests) and the browser run: create, read, other user denied (404), unauthorised update/delete rejected,
stale `expected_version` returns 409, repeated `client_token` returns the saved agreement, revisions are append-only, evaluation recomputed on
read, an infeasible plan is refused (422), 30-per-user cap, included in export, removed with the account. Migration `e4f5a6b7c8d9` is additive
and reversible (upgrade, check, downgrade, re-upgrade run on SQLite and scratch PostgreSQL, see section 7).

## 6. Browser run (real local app)

| Step | Result |
| --- | --- |
| Sign in through the form | works; a user with no saved plan is sent to onboarding (expected) |
| Open `#/plan-b` while signed out | redirected to `#/login`; nothing shown |
| Step 1 to 3 of the form with real values | validated and advanced |
| Saved agreement list and open | shows "Ananya job gap", version 1, figures recomputed |
| Edit floor to ₹1,70,000 and Recalculate | **crashed with "Too many re-renders" (D4, fixed)**; works after the fix |
| Save as new version | version 2 saved; "What changed": `Reserve floor: Rs 180,000.00 to Rs 170,000.00`; both versions listed |
| Open version 1 | still read-only with the original floor ₹1,80,000 |
| Review against today (cash ₹2,00,000, income ₹60,000, default review month) | "Needs recalculation"; names 2026-12, 2027-01 and 2027-02 as below the ₹1,70,000 floor |
| Sign out | session cleared |

Not repeated after the Stage 7 fixes through the browser (covered by automated tests instead): the search/reject/choose/save sequence on the
form. It was run in the browser on an earlier build with the demo account, and `PlanB.test.tsx` exercises it against a mocked service.

### Widths, theme, language

Agreement view, horizontal overflow measured as `scrollWidth` against `clientWidth`: 320 (320/320), 360 (360/360), 390 (390/390),
768 (753/753), 1024 (1009/1009). No overflow. Hindi at 320 and light theme at 320: no overflow, labels readable. Every input in the
agreement view has an associated label (12 of 12). Errors use `role="alert"`. Two "Open" buttons in the versions list are 38 px high, below
the 44 px target used elsewhere (minor, not changed). A real phone was not available; everything above is browser emulation.

Hindi note: sentences written by the server (adjustment descriptions, limitations, review messages) are English even in Hindi.

## 7. Test commands and results

All run from the repository after the last code change in this stage.

| Command (from `backend/` unless noted) | Result |
| --- | --- |
| `pytest -q` (SQLite) | **598 passed**, 1 warning (a starlette/httpx deprecation, pre-existing) |
| `TEST_DATABASE_URL=<scratch PostgreSQL> pytest -q` | **598 passed** |
| `pytest tests/test_contract.py` | 1 passed (the OpenAPI contract is unchanged by this stage) |
| `ruff check .` | All checks passed |
| `alembic upgrade head`, `check`, `downgrade -1`, `upgrade head`, `check` on scratch PostgreSQL | all succeeded; "No new upgrade operations detected" both times |
| Same sequence on a throwaway SQLite file | all succeeded; no drift |
| `npx tsc -b` (from `frontend/`) | no errors |
| `npx oxlint src` | no findings |
| `npx vitest run --pool=forks` | 21 files, **192 passed** |
| `npm run build` | built; one chunk-size advisory (pre-existing) |

Targeted Plan B tests are part of the totals: the evaluator, restoration, review (6), search, compare and API (28) tests on the backend; `planb.test.ts` (12)
and `PlanB.test.tsx` (12) on the frontend. No failure in this run, so no pre-existing failure had to be separated from a new one. `backend/arthayukti.db`
was not touched. The databases used were scratch PostgreSQL (localhost only, guarded by `tests/db_guard.py`) and throwaway SQLite files.

Checks not run: a real phone; Neon or any hosted PostgreSQL; the deployed site (it does not contain Plan B); screen-reader testing.

## 8. Defects, fixes and regression tests

| # | Defect | Files | Regression test |
| --- | --- | --- | --- |
| D1 | Review let a pause run past its allowance | `backend/app/engine/recovery_review.py` | `test_recovery_review.py` (6 tests) |
| D2 | Review ignored a saved confirmation | same | `test_a_confirmation_saved_in_the_agreement_still_counts_in_a_review` |
| D3 | Search could hold a worker about 68 s at the maximum limit | `backend/app/engine/recovery_search.py` | `test_a_long_search_is_held_to_a_work_budget_whatever_limit_was_asked_for` |
| D4 | After changing inputs the old results stayed choosable and savable | `PlanB.tsx`, `Results.tsx`, `i18n/planb.ts` | "marks results stale when the inputs change…" in `PlanB.test.tsx` |
| D5 | Recalculate in the agreement editor crashed the page (state updated during render) | `frontend/src/components/planb/Agreements.tsx` | "recalculates an edited agreement without crashing the page" (fails without the fix, passes with it) |

`Modules.test.tsx` line 162 was narrowed from "no POST at all" to "no POST to `/financials*`". The test still checks its purpose (a page of
that module must not write ledger data); the old form also failed on unrelated background `/projections` and `/fixes` POSTs.

## 9. Remaining limitations

- Review cannot take real past figures (section 4).
- The restoration guard looks ahead assuming nothing else changes.
- Goal delays are not calculated (deferred rupees are shown).
- Prefill reads income, expenses, commitments and goal balances; contribution amounts are typed.
- Server-written text is English only; Hindi copy has no native review.
- No real-phone testing; Neon / production PostgreSQL untested.
- After saving a revision, the previous "Recalculate" figures panel stays visible until the page is left (cosmetic).

## 10. Final counts

Backend 598 passed (SQLite) and 598 passed (PostgreSQL); frontend 192 passed; ruff, tsc, oxlint and build clean. Zero failures.

## 11. Local versus production readiness

Local: demo-ready (see recommendation). Production, observed read-only on this date:

- The live API (`arthayukti-api-y7ah.onrender.com`) has no `/health/ready` and no `/recovery/...` routes (404): it is running a build before Plan B and before the PostgreSQL work.
- At the last inspection of the Render environment only `ALLOWED_ORIGINS`, `FRONTEND_BASE_URL` and `PYTHON_VERSION` were set: no `DATABASE_URL`, `SECRET_KEY` or `ENVIRONMENT`. That means ephemeral SQLite, a throwaway signing key and development mode. Agreements saved there would not survive a restart.
- Needed before Plan B can be shown on the hosted site: a persistent PostgreSQL URL, a strong `SECRET_KEY`, `ENVIRONMENT=production`, running `alembic upgrade head` as part of the deploy, pointing the readiness check at `/health/ready`, merging to `main`, and confirming `VITE_API_BASE_URL` / `ALLOWED_ORIGINS` match. None of this was changed.
- No email or other external service is used by Plan B.

## 12. Recommendation

**Demo-ready locally, with disclosed limitations.** The arithmetic matches an independent calculation to the paisa, five defects were found by
checking and fixed with regression tests, and the whole flow works in the real local app. It is **not** demo-ready on the hosted site: that
build predates Plan B and has no durable database, so the demo should run from the local stack (or after the production steps in section 11 are
approved and done). The limitations in section 9 (especially that a review cannot use real past figures, and English-only server text in Hindi)
should be said out loud rather than discovered by a judge.
