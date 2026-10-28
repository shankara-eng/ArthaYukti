# Plan B: commitment-aware financial replanning

Protect what matters. Change what is flexible. Know when to restart.

A separate workflow from Rescue (opened from the Rescue page, route `#/plan-b`). Deterministic: no AI chooses,
checks or explains a number. It is a calculation from the person's own inputs, not a guarantee.

## Where things are

| Part | Files |
| --- | --- |
| Month-by-month evaluator and restoration | `backend/app/engine/recovery_eval.py`, `backend/app/schemas/recovery.py` |
| Bounded search | `backend/app/engine/recovery_search.py` |
| Comparison, ranking, explanations | `backend/app/engine/recovery_compare.py` |
| Review against today's figures | `backend/app/engine/recovery_review.py` |
| Search and agreement shapes | `backend/app/schemas/recovery_plan.py` |
| API | `backend/app/api/recovery.py` (`/api/v1/recovery/...`) |
| Storage | tables `recovery_agreements`, `recovery_agreement_versions` (migration `e4f5a6b7c8d9`) |
| Frontend | `frontend/src/pages/app/PlanB.tsx`, `components/planb/`, `lib/planb.ts`, `i18n/planb.ts` |
| Tests | `backend/tests/engine/test_recovery_*.py`, `backend/tests/api/test_recovery_api.py`, `frontend/src/lib/planb.test.ts`, `frontend/src/pages/app/PlanB.test.tsx` |

## Accounting conventions

- `liquid_end = liquid_start + income - mandatory - flexible - goal transfers`. Mandatory (essentials, debt,
  protected obligations) is paid first; a shortfall is reported, never covered by borrowing, sale or withdrawal.
- A goal contribution is a transfer into a protected balance: it lowers cash but is saving, not spending.
- Unspent income stays in cash. (The research example's "additional reserve contribution" is that residual, not an outflow.)
- The reserve floor is checked on cash at the end of every month; exactly at the floor passes.
- Protected balances are never withdrawn. No returns, inflation, borrowing or asset sales are modelled.
- Income comes only from the schedule entered. A reduction with no end month is assumed to continue to the end of the
  modelled period (and says so). Income is never assumed to recover.

## Restoration

An adjustment with no end month lasts "until restored". Its rule needs every condition true (income at least X, cash
at the last month-end at least Y, the person's own confirmation) and a date can never be the only condition. Steps back
up can be all at once or staged; with the affordability guard a step is deferred if cash would fall below the floor this
month or in any later month (assuming nothing else changes). A review month only reports the state; it restores nothing.

## Search

Per allowed item: no change, pauses of 1..max months, reductions in steps (at most about 24 levels) over the chosen
window, and "until restored" twins when the item has a restoration rule. Candidates are visited in order of total
sacrifice, evaluated, de-duplicated by what they change month by month, and filtered so no kept plan is beaten on every
month by another feasible plan. Result states: `found`, `infeasible` (the whole supported space was checked) or
`incomplete` (the candidate limit was reached with nothing found; never reported as "no solution"). Items the person
refuses are never touched; protected, mandatory or refused items are reported as ignored.

## Ranking and explanations

Plans are ordered by total rupees given up (flexible spending not spent plus goal contributions not made), ties by the
larger cushion above the floor. Up to three different plans are shown (smallest sacrifice, largest cushion, keeps goal
contributions going). If they give up different things the response says there is no single best plan. Goal delays are
not calculated, because the existing goal projection cannot represent fixed or paused contributions; deferred rupees
are shown instead.

## Agreements

A saved agreement stores only the draft (situation, chosen adjustments, restoration rules, review month, the person's
words). The evaluation is recomputed on every read. Editing adds a version (older versions are kept); `expected_version`
guards against stale edits (409). A repeated save with the same `client_token` returns the agreement already saved. A
plan that breaks the person's own rules cannot be saved. Agreements belong to one user and are in the data export and
removed with the account.

## Known limitations

- The review takes the cash at the start of the review month and the income from then on. Earlier months come from the
  agreement as saved: protected balances are rebuilt from its schedule, and months already paused count against each
  permitted pause length (a pause that used its whole allowance resumes, and the result says so). If the person did not
  follow the saved schedule, those rebuilt figures are not what really happened; real past figures cannot be entered.
- Server-written sentences (adjustment descriptions, limitations, review messages) are English only, even in Hindi.
- The restoration guard looks ahead assuming no other change happens.
- Goal delays are not calculated.
- Prefill from a saved plan reads income, expenses, commitments and goal balances; contribution amounts must be entered.
- Hindi copy has not had a native-speaker review.

## AI help

Optional Gemini help (describe a situation in words; explain a plan in words) is documented in `docs/AI_GEMINI.md`. It never decides a figure.
