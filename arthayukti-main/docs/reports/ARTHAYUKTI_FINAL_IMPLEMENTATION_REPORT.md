# ArthaYukti final implementation report

Pass: master-specification audit, implementation and verification. Local work only: nothing was pushed, merged or deployed, no
production setting or database was touched, and no secret was read or printed.

## 1. Repository state

| | |
| --- | --- |
| Starting commit | `7410951da034142adb28ce95c2b0054e2c75995c`, "feat: restructure financial planning experience" |
| Starting state | Branch `main`, working tree clean, one commit ahead of `origin/main` (`6826ff3`). Verified with `git status`, `git log` and `git rev-list` at the start |
| Code commit | `d9a853aabbbb3430b40ff0b0db51cb1fb065367b`, "feat: expenditure schedules, holdings ledger, debt trajectory, emergency default" (42 files) |
| Ending commit | The documentation commit that adds this report, the traceability matrix and the gap analysis directly after the code commit (a commit cannot name itself; `git log -2` shows both) |
| Recovery point | `7410951` is untouched and still the parent of the code commit |

The starting test baseline (668 backend, 223 frontend) came from the previous pass on this same tree; it was not re-run at the
start of this one, only superseded by the results below.

## 2. What was audited

159 requirements from the master specification, the UI restructuring brief and the audit brief, listed one by one in
`docs/reports/ARTHAYUKTI_REQUIREMENT_TRACEABILITY.md` with evidence and a status. Result: **95 PASS, 38 PARTIAL, 19 FAIL, 3 BLOCKED,
2 UNVERIFIED, 2 CONFLICT**. Seven conflicts between sources are recorded with the interpretation used. This report does not claim
the specification is complete: the master specification describes a target product that is much larger than the MVP in the
repository (see section 9).

## 3. What was implemented this pass

| Area | Change | Main files |
| --- | --- | --- |
| Expenditure schedules | Spending lines repeat monthly, quarterly or yearly, run between inclusive start and end months, carry a category and may grow at their own rate, otherwise the plan-wide rate. Plain lines are unchanged and the golden engine tests pass untouched. Yearly projection, essential/other split and CSV under Income and Expenditures, reconciled to the engine's monthly spending | `engine/expenditure.py`, `engine/flows.py`, `schemas/plan.py`, `schemas/expenditure.py`, `api/expenditure.py`, `pages/app/Expenditure.tsx`, `lib/expenditure.ts` |
| Holdings ledger | Actual buys, sales, splits, bonus units and dividends on a holding; FIFO lots, cost basis, realised gain, holding days, reconciliation with the holding record, CSV, an explicit update-the-record action, ownership, bounded size, export and cascade delete. Valuation states its source and never invents a price | `engine/ledger.py`, `api/ledger.py`, `schemas/ledger.py`, `db/models.py`, `pages/app/HoldingLedger.tsx` |
| Debt trajectory | Each recorded debt run to payoff on the existing amortization engine, summed by year, with the reason shown for any debt the record cannot support | `engine/debt_trajectory.py`, `api/debt.py` (`GET /debt/trajectory`), `pages/app/RecordedDebts.tsx` |
| Emergency Funds | Default 12-month target, labelled as a default until saved; scheduled spending that is not running yet is left out of today's essentials | `pages/app/Emergency.tsx`, `engine/emergency.py` |
| Holdings form | Optional market symbol, so a stored price can reach a holding entered in the interface | `pages/app/Records.tsx` |
| Documentation | Expenditure module and the inflation precedence (with the 6% conflict), holdings ledger, traceability, gap analysis, this report | `docs/*.md` |

Earlier in the same working session (committed before this pass, verified again here): the restructure (navigation, signup,
Calculators hub, Emergency Funds, Default Inflation Rate), Plan B, and Gemini help.

## 4. Schema, migration and API changes

- **Migration** `a7b8c9d0e1f2` (new table `investment_transactions`, nothing else). Single head. Upgrade, drift check
  (`alembic check`), one-step downgrade and re-upgrade all passed on a scratch PostgreSQL and on throwaway SQLite. Indexes on
  `holding_id` and `user_id`; foreign keys cascade.
- **Plan schema** (additive, optional): `Expense` gains `category`, `amount`, `frequency`, `start_month`, `end_month`,
  `annual_growth`; the cap on spending lines rises from 12 to 60. A plan saved before this pass loads and projects identically.
- **New endpoints**: `POST /expenditure/projection` and `/csv`; `GET/POST /financials/investments/{id}/transactions`,
  `DELETE …/transactions/{tid}`, `GET …/position`, `GET …/ledger.csv`, `POST …/apply-ledger`; `GET /debt/trajectory`.
  Changed: `POST /emergency-fund/analyze` accepts an optional `as_of`; the data export gains `investment_transactions`.
- **Contract check**: comparing `contracts/openapi.json` with the starting commit: no path or schema removed, no existing path
  changed, no new required field; four schemas gained optional fields only.

## 5. Test commands and exact outcomes (final working tree)

| Command | Result |
| --- | --- |
| `cd backend && .venv/Scripts/python.exe -m pytest -q` (SQLite) | **754 passed**, 1 warning (a starlette/httpx deprecation) |
| `TEST_DATABASE_URL=<scratch PostgreSQL> … pytest -q` | **754 passed** |
| `… -m ruff check .` | All checks passed |
| `… -m pytest tests/test_contract.py` | 1 passed (the contract matches the backend) |
| `… -m alembic upgrade head / check / downgrade -1 / upgrade head / check` (PostgreSQL and SQLite) | all succeeded; "No new upgrade operations detected"; one head `a7b8c9d0e1f2` |
| `cd frontend && npx tsc -b` | exit 0 |
| `npx oxlint src` | exit 0, no findings |
| `npx vitest run --pool=forks` | **241 passed**, 23 files |
| `npm run build` | built |

The suite grew from 668 to 754 backend tests and from 223 to 241 frontend tests. The PostgreSQL database was a disposable local
server; a hosted database (Neon) was not tested.

## 6. Independent financial checks

| Check | How it was done | Result |
| --- | --- | --- |
| Plan B golden scenarios | Integer-paise script written from the research brief (it does not import the engine), compared with the live API every month, rerun this pass | All four scenarios match: 6 months no change ends ₹90,000 (floor breached from month 4 at ₹1,60,000); home paused ends ₹1,50,000; home paused and flexible cut to ₹5,000 ends exactly ₹1,80,000 with no breach; 8 months breaches in months 7 and 8 at ₹1,60,000 and ₹1,40,000 |
| Loan EMI | Standard formula by hand: ₹1,00,000 at 12% over 12 months | ₹8,884.88, matched in tests, in the calculator and in the browser; balance after month 2 ₹84,151.39 |
| Debt trajectory | Hand totals for one and two loans | Interest, principal and balance by year match; principal sums back to the amount borrowed; payments equal principal plus interest; the trajectory equals the calculator for the same loan |
| Holdings ledger | A six-transaction history worked by hand | 80 units, cost ₹1,525.00, average ₹19.0625, realised gain ₹3,295.00, dividends ₹540.00, fees ₹230.00, lots held 172 and 122 days; the live API returned the same figures |
| Expenditure | Hand cases for each frequency, bounded windows, growth precedence, partial years, rounding (₹100 a year = 12 × 8.33 = 99.96) | All match; the yearly totals equal the engine's own monthly spending |
| Emergency Funds | ₹2,00,000 ÷ ₹30,000 = 6.7 months; 9 × ₹30,000 = ₹2,70,000 target, 74% | Matched in the browser against the real backend |
| Conflict arithmetic | 1.05¹⁰ = 1.6289 against (1 + 0.05/12)¹²⁰ = 1.6470 | Recorded in the conflict register, not "fixed" |

## 7. Browser checks actually performed

In the in-app browser against my own local API and Vite server (emulation, not a physical device):

- Signed up a brand-new account: landed on the dashboard with guidance. Swept 30 routes as the empty account: no crashes.
- Signed in as a demo account: Income and Expenditures showed the engine's projection; added a bounded line through the form and saw 2027 rise by exactly ₹15,000 and 2028 stay unchanged.
- Equities, Holdings: the ledger showed the hand-checked position from a history created through the API.
- Emergency Funds, Settings (Default Inflation Rate), the Debts calculator: used against the real backend.
- Widths: 320 px on dashboard, Income and Expenditures, Calculators, Debts, Equities (calculator and holdings), Emergency Funds, Settings, Plan B and the Debt outlook, measured for horizontal overflow: none.

**Not browser-checked**: the new Debt trajectory page against the real backend (covered by API and mocked-frontend tests only),
the market-symbol field on the holdings form (tested with a mock), and any page in dark mode or Hindi this pass. No physical
device was available.

## 8. Gemini

No key exists in this environment. Verified: the key is backend-only and absent from the contract, responses and logs; missing key,
rate limit, timeout, malformed and unverified outputs are handled; the interface hides or notes AI controls when it is off and
everything else works. **Not verified**: any live call, the request format (written from public documentation from memory, run only
against a stub), and the default model name. To finish: set `GEMINI_API_KEY` in `backend/.env`, run one call per route, confirm
the model name. Gemini is used in Plan B only; whole-picture risk analysis and research mode are not built.

## 9. Requirements that remain open

Full lists are in the traceability matrix. The largest:

- **FAIL**: persisted named scenarios with dated events (SC-01); versioned tax rule engine (TX-01); investment trajectory (TJ-02);
  trajectory readiness checklists; emergency reserve allocations and accessibility classes (EF-03); physical-asset sale
  willingness (PA-01); selected goal target (GI-03); debt investments (DB-12); claim, nominee and coverage-need insurance
  records; XLSX import; AI audit tables; automated browser end-to-end tests; profile provenance.
- **PARTIAL**: CSV import has no mapping or confirm step; household planned events do not affect projections; custom trajectory is
  four flows; returns have no date-range schedules; SIP steps are by investment year, not date; liability, insurance and household
  records are thinner than the master specification.
- **BLOCKED**: a live market-data provider (none chosen); a live Gemini call (no key); production persistence and deployment
  (needs your approval and credentials; nothing was changed).
- **CONFLICT**: the 6% expenditure default (not in the master specification in the repository, which forbids a silent default);
  the dashboard tax overview against the removed Taxes page. Others (goal-inflation compounding, priority tiers, calculator
  placement, whole-picture AI versus privacy) are in the register.
- **UNVERIFIED**: encryption at rest on a real database; physical-device behaviour.

## 10. Known limitations and risks

See `docs/reports/FRONTEND_BACKEND_GAP_ANALYSIS.md`. The ones to know before a demo: recorded debts and the plan's own loan payments are
two separate sources (a loan entered twice would count twice); periodic spending is spread evenly, so a month-specific cash dip is
smoothed away; the ledger computes no tax; several compute endpoints are public by design; the hosted site's persistence was
not rechecked; projections need at least one goal, so a new account sees explanatory notes until it adds one.

## 11. Recommended next steps

1. Decide the 6% default (C1) and the goal-inflation convention (C4): both change numbers people see.
2. Link recorded debts to plan commitments explicitly.
3. Build persisted scenarios with dated events, then a tax rule engine and an investment trajectory.
4. Production work that needs your approval: persistent PostgreSQL, a strong signing key, production mode, migration rollout
   (two new migrations since the last deploy: `f5a6b7c8d9e0` and `a7b8c9d0e1f2`), health checks. A push to `main` redeploys the
   hosted site.
5. Add Playwright end-to-end tests and a native-speaker review of the Hindi copy.
6. Supply the separate Expenditure and calculators specifications and the reference PDF, which were not in the repository.
