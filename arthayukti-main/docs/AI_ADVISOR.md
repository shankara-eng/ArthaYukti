# AI Financial Advisor

Lives at **AI advisor** in the app. It reads the signed-in person's own records, assesses every goal at its saved date and
exactly three years later, tries alternative paths in isolated scenarios, and (when Gemini is set up) lets the model propose
paths and word the result. **Every number is calculated by ArthaYukti's engine; Gemini never calculates.** No record changes
unless the person confirms the exact edits.

## What was inspected first (verified code versus documents)

| Area | State before this work |
| --- | --- |
| Goals | Live in the saved plan (`saved_plans.plan_json` → `Plan.goals`), with priority, target date, today's-money flag and flexibility. There is no separate goals table. |
| Goal allocation | `engine/projection.py` (`project_resolved`): one surplus, allocated by priority, nothing counted twice. |
| Trajectory | `engine/trajectory.py` (event-ledger accounting, loans, premiums, deposits, goal effects), `POST /trajectory/project`. |
| Gemini | `ai/gemini.py` (backend-only key, one HTTPS call, no SDK), `ai/assist.py` (situation reader, explainer). |
| Not present | Any snapshot assembler for advice, +3-year assessment, scenario tools, recommendation storage, advisor UI. |

## How it works

1. **Snapshot** (`api/advisor.py: build_snapshot`): a compact typed profile (no name, e-mail, phone, account name, policy number
   or insurer) with a snapshot id and hash. The hash covers the plan, balances, holdings, debts, policies and the profile facts, so
   any change marks the analysis **stale** and blocks new scenarios on it (scenarios are never mixed across snapshots).
2. **Baseline**: the trajectory with every goal included and no change (`engine/advisor.py: Lab`).
3. **Goal dates** (`goal_date_comparison`): for every goal, an assessment at the saved month and at +36 calendar months. The later
   date is its own engine run (a goal override on that one goal), never a copy. The saved date is never edited. Months have no
   day, so there is no leap-day case; `plus_three_years_date` clamps a non-existent day (29 Feb) to the month's last day.
   Today's-money goals are inflated to each date at the goal's rate; fixed goals are not. Competing goals are re-allocated and the
   effect on the others is reported. Retirement carries a caveat (retirement period and spending are not modelled); education and
   emergency funds, or goals whose allowed delay is under 36 months, are flagged time-sensitive.
   Status: **achievable** (funded by the date, cash never short before it), **at risk** (funded late within the allowed delay, or cash
   short before the date), **underfunded** (not funded, or later than allowed), **cannot assess** (the engine cannot project it, or
   the later date is beyond 600 months). With no recorded balance the assessment still runs from the plan's own savings and says so.
4. **Scenario tools** (isolated, read-only on records): `simulate_expense_change` (optional spending only, never essentials),
   `simulate_investment_change` (a transfer from cash to investments: net worth unchanged, infeasible if cash runs short),
   `simulate_goal_change`, `simulate_debt_strategy` (amortisation from the loan's recorded terms; goal effects are not modelled and
   it says so), `simulate_assumption_change`, `compare_scenarios`. A path is **infeasible** if it creates a cash shortfall or makes
   a goal worse that it did not set out to move.
5. **Engine paths** run without any model: 5% and 10% of optional spending, extending the most pressed goal, a combined path, a
   lower savings return as a stress test, an affordable investment (sized from the lowest cash balance), extra payment on the
   highest-rate loan. Recommendation cards are written from these results.
6. **Gemini** (optional): a bounded tool loop (3 rounds, 4 calls a round, 10 in all) with only the approved tools. The final report
   is parsed and checked: an invented scenario id, a path the engine rejected, a category that contradicts its calculation, or a
   figure above 31 that appears in no fact or result is **removed and reported** under "Removed by the checks". If nothing usable
   is left, or the provider fails or times out, the engine's own report is shown and the state says why.
7. **Decisions**: save, accept, dismiss, complete. Accepting returns the exact edits and a confirmation token (a hash of those edits
   and the snapshot); they are applied to the saved plan only when the same request is repeated with `apply_changes` and that
   token, and only if nothing changed in the meantime. The analysis then reads as stale.

## API (all signed in, all owner-scoped; another person's id is 404)

`POST /advisor/analyze`, `GET /advisor/analyses/latest`, `GET /advisor/analyses/{id}`, `POST /advisor/scenarios`,
`GET /advisor/scenarios/{id}`, `POST /advisor/compare`, `POST /advisor/recommendations/{id}/decision?analysis_id=`,
`POST /advisor/chat`. Rate limited per person (20 analyses or chats and 60 scenarios per 10 minutes); at most 40 scenarios per
analysis. Tables (migration `c9d0e1f2a3b4`, additive): `advisor_analyses`, `advisor_scenarios`, `advisor_decisions`. They keep
references, the result and the snapshot hash, never the key, the prompt or the raw model reply.

## Safety

The key is read from the backend environment only (`GEMINI_API_KEY`, placeholder in `.env.example`) and is never returned,
logged, or put in a prompt. Labels the person typed are sent as data under a rule that they are never instructions. The advisor has
no SQL, no code execution, and no tool that changes a record. Projections are not guarantees and no probability of success is given.

## Not done / limits

- Text the server writes (findings, recommendations) is English; Hindi appears only when the model is asked for it and the screen's
  own words are Hindi (first draft, to be checked by a native reader).
- Spending changes need optional lines in the plan; when spending comes from Expenditure plans the advisor says it cannot tell which
  part is optional.
- Debt paths do not model how goals change; income paths are not offered because no income tool is approved.
- Applying an accepted spending cut edits the plan's lines for every month, not only the months modelled (the card says so).

## Run and test

```bash
cd backend && pytest tests/engine/test_advisor_engine.py tests/api/test_advisor_api.py
cd frontend && npx vitest run src/lib/advisor.test.ts src/pages/app/Advisor.test.tsx
```

All Gemini calls in the suite are faked. A live check is opt-in: `RUN_LIVE_GEMINI=1 pytest tests/test_advisor_live.py` (uses
the key in `backend/.env`; it is skipped otherwise).
