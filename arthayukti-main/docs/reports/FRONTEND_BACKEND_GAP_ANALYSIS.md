# Frontend and backend gap analysis

Findings from auditing the repository against the master specification and the two later briefs. Companion to
`docs/reports/ARTHAYUKTI_REQUIREMENT_TRACEABILITY.md` (requirement by requirement) and
`docs/reports/ARTHAYUKTI_FINAL_IMPLEMENTATION_REPORT.md` (what changed and how it was verified). Items marked *closed this pass* were
fixed in the same pass that found them.

## 1. Architecture and integration

| # | Gap | Effect | Status |
| --- | --- | --- | --- |
| 1.1 | **Two sources for debts.** The plan holds `commitments` (a monthly payment for N months); Calculators, Debts holds `liabilities` (balance, rate, EMI). Nothing links them. | The same loan can be entered twice, once in each, and then counted in the surplus and shown in the debt trajectory. Emergency essentials read the plan's commitments only. | Open. The debt trajectory page now says the two are separate. Remedy: convert a recorded debt into a plan commitment explicitly |
| 1.2 | **Two sources for investments.** Holding records (a value the person types), the ledger (units and cost from transactions) and the calculators (assumed growth) do not feed each other. | Net worth uses the typed value; the ledger shows a cost basis and, when a stored price exists, a different value. | By design for now: the ledger changes the record only through the explicit "update the holding record" action, never the value |
| 1.3 | **The plan is one JSON document.** Income, spending and goals are not rows. | No history of plan changes, no per-field provenance, no scenario tables, harder to query. | Open (DB-02, DB-07) |
| 1.4 | **No persisted scenarios.** Three fixed situations (normal, no income, an expense). | The central master-spec workflow of named scenario tabs with dated events does not exist. | Open: the largest structural gap (SC-01) |
| 1.5 | **Household planned events are stored but unused.** | A planned child or caregiving cost entered in the profile changes no projection. | Open (HP-04) |
| 1.6 | **Emergency target lives in the household profile; the reserve is a goal.** | A person can have a goal target and a months target that disagree. The page shows both and counts the reserve once. | Documented; reconcile by deriving the goal target from the months target if wanted |
| 1.7 | **No market-data provider or refresh.** The adapter only reads snapshots that something else stored. | Valuation falls back to the typed value; there is nothing to mark stale in a normal install. | Blocked on choosing a provider (MD-03) |
| 1.8 | **Holdings entered in the interface had no symbol field**, so no stored price could ever apply to them. | Valuation from a snapshot was unreachable from the UI. | *Closed this pass* (optional market symbol on the form) |
| 1.9 | Frontend sends the whole plan on every projection and re-requests after each edit. | Fine at current sizes; many spending lines multiply the work. | Acceptable; lines are capped at 60 |

## 2. Missing functionality (highest value first)

1. Persisted, named scenarios with dated events and a comparison view (SC-01, SC-02, TJ-07).
2. A versioned, effective-dated tax rule engine (TX-01); today one flat rate per calculator investment.
3. An investment trajectory (TJ-02): the page states it is not available.
4. Staged CSV and XLSX import with mapping, review and confirmation (IM-01, IM-02).
5. Emergency reserve allocations from assets, with accessibility classes (EF-03); physical-asset sale willingness (PA-01).
6. Selected-target fields for goals (GI-03); named priority tiers (GP-01).
7. Richer debt, insurance and household records (DB-11, DB-13, HP-01 to HP-07); debt investments (DB-12).
8. Whole-picture AI risk analysis and research mode (RK-04, V-05), once a key and a privacy summary exist.
9. Trajectory readiness checklists (TJ-08) and household and goal CSV exports (TJ-09).
10. Switches, mergers and reinvested dividends in the ledger; a market data provider.

## 3. Security and data-integrity risks

| # | Risk | Notes |
| --- | --- | --- |
| 3.1 | Several compute endpoints are public by design so the no-account demo works (`/projections`, `/fixes`, `/compare`, `/tradeoffs`, `/rescue/analyze`, `/debt/amortize`, `/ai/consult`, `/ai/parse-intent`). | They hold no user data, but they are unauthenticated CPU. The in-process rate limiter covers sign-in and AI only. Consider limits before a public launch |
| 3.2 | Rate limits are per process and reset on restart; behind several instances each keeps its own counts. | Already documented in `ratelimit.py` and PRODUCTION_READINESS.md |
| 3.3 | A token cannot be revoked before it expires (24 hours). | Known; sign-out only clears the tab |
| 3.4 | The hosted API had temporary storage and no signing key at the last inspection (not rechecked this pass). | Production work, not done (SE-06) |
| 3.5 | Encryption at rest and protection of policy and account identifiers depend on the database host. | Unverified (SE-05) |
| 3.6 | Audit logging is thin: no before/after, and not every override. | DB-05 |
| 3.7 | The ledger replayed an unbounded history on every request. | *Closed this pass*: at most 1,000 transactions per holding |
| 3.8 | Gemini: only a typed description or evaluated figures leave the server; output is validated; the key is backend-only. | Verified by tests; a live call is unverified because there is no key |
| 3.9 | Ownership: every new route (expenditure, ledger, debt trajectory, preferences, emergency) is owner-scoped and tested for cross-user access. | Verified |

## 4. Financial-calculation risks

| # | Risk | Notes |
| --- | --- | --- |
| 4.1 | **Goal inflation convention.** The engine compounds monthly; the master spec writes annual compounding. At 5% over ten years the factors are 1.6470 versus 1.6289. | Conflict C4; unchanged so existing results do not move. Needs a decision |
| 4.2 | **Periodic spending is spread evenly.** A yearly bill is not shown in the month it falls due, so a month-specific cash dip is smoothed away. | Disclosed on the page. Matters most to any floor check built on projected cash; Plan B models its own items month by month and is unaffected |
| 4.3 | Spending growth is an annual step from the later of the line's start and the plan's start; legacy lines step from the plan start. | Documented and tested; differs from monthly compounding by design |
| 4.4 | The ledger reports gains and holding days but computes no tax; bonus units carry zero cost and the bonus date. | Real tax treatment depends on rules not modelled |
| 4.5 | Reverse splits that do not divide evenly round to six decimals and no cash-in-lieu is modelled. | Documented |
| 4.6 | The holding record's `purchase_price` has no defined meaning (total or per unit). The form uses it as the amount invested, and "update from ledger" writes the total cost to match. | Rename or define the field |
| 4.7 | The debt engine forces a loan closed at its recorded tenure when the balance is under 1.5 times the payment, so the last payment can be larger. | The trajectory flags loans that take longer than recorded; inherited engine behaviour, left alone |
| 4.8 | Plan B's restoration guard looks ahead assuming nothing else changes; a review rebuilds the past from the saved schedule. | Documented limitation (PLAN_B.md) |
| 4.9 | Premiums count only if entered as spending. | IN-04 |
| 4.10 | The 6% expenditure default cannot be reconciled with the master spec in the repository. | Conflict C1 |

## 5. User-experience gaps

- Several Financial Outlook pages are thin: the investment trajectory is an apology plus a table, the custom trajectory has four flows, the scenario comparison is limited to three situations.
- Hindi copy has had no native review, and some server-written sentences (Plan B descriptions, limitations, ledger error messages) are English only.
- No automated browser end-to-end tests; browser checks were manual and scripted in the in-app browser, at 320 to 1024 px, never on a physical phone.
- The Debts calculator, the debt trajectory and the plan's own loan payments are three views of debt; the pages now say how they differ but a person has to read the notes.
- Projections need at least one goal (the engine looks ahead as far as its goals do), so a brand-new account sees notes instead of spending and income projections until it adds one. The pages say so.

## 6. Prioritised remediation

| Priority | Work | Why first |
| --- | --- | --- |
| P0 | Decide the open conflicts C1 (6%) and C4 (inflation convention) | They change numbers people see |
| P0 | Link recorded debts to plan commitments explicitly (1.1) | Removes a real double-counting trap |
| P1 | Persisted scenarios with dated events (1.4) | The core promise of the specification |
| P1 | Tax rule engine and investment trajectory (2.2, 2.3) | The two biggest visible holes in Financial Outlook |
| P1 | Production database, signing key, migration rollout, health checks | Nothing persists on the hosted site until done |
| P2 | Staged import, emergency allocations, physical-asset willingness | Spec workflows that today are shortcuts |
| P2 | Add Playwright end-to-end tests; review Hindi with a native speaker | Verification and quality |
| P3 | Richer records, ledger extensions, a market provider | Breadth |
