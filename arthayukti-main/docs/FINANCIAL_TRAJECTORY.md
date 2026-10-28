# Financial Trajectory

One monthly timeline of cash, assets, liabilities, insurance and the goals a person chooses, built from the records they
already keep. It implements `ArthaYukti_Financial_Trajectory_Tab_Implementation_Specification.pdf` (v1.0, 25 Oct 2026) as far
as the records in this repository can support, and says where they cannot. Model version `trajectory-1.0`.

It answers: "If my recorded income, spending, debt payments, insurance schedules and selected goals continue under the
assumptions shown, how could my assets, debts, cash and net worth evolve?" It is deterministic for one set of records and one
request. It is not a forecast, a guarantee or a probability.

## 1. Repository map (G0, verified in code)

| Area | Where | Notes |
| --- | --- | --- |
| Plan (income, spending, loan payments, goals) | `schemas/plan.py`, `engine/flows.py`, `engine/setup.py` | One JSON document per saved plan. A plan may now have no goals |
| Goal allocation | `engine/projection.py` (`project_resolved`, new) | The existing policy, unchanged. Reused, not copied |
| Accounts, holdings, debts | `db/models.py` (`FinancialAccount`, `AssetInvestment`, `Liability`) | Typed balances. No rate, maturity or schedule fields for deposits |
| Holdings valuation | `api/ledger.py` `_valuation`, `adapters/market_data.py` | Stored snapshot (fresh/stale/unavailable) or the value the person entered |
| Debt amortization | `engine/debt.py` `calculate_amortization_schedule` | Reused for every loan |
| Insurance | `db/models.py` `InsurancePolicy` (+ free-form `policy_details`) | Premium amount and frequency, dates, status. No payment history, no benefit schedule |
| Household age | `HouseholdProfile.primary_earner_age` | An age, not a birth date |
| New | `engine/trajectory.py`, `schemas/trajectory.py`, `api/trajectory.py`, `POST /api/v1/trajectory/project` | No new table, no migration |
| UI | `pages/app/Trajectory.tsx`, `components/trajectory/*`, `lib/trajectory.ts`, `i18n/trajectory.ts` | Route `#/trajectory`, in the main navigation |

The trajectory stores nothing. Records stay where they are owned; a result is recomputed on request.

## 2. Source of truth (nothing is entered twice)

| Input | Read from | Not duplicated |
| --- | --- | --- |
| Income, raises, step-ups | Plan income streams (`month_flows`) | No growth input here |
| Spending, growth, schedules | Plan expense lines (`month_flows`) | |
| Plan loan payments | Plan commitments (`month_flows`) | Counted as spending: the split is not recorded |
| Spendable cash | Liquid savings, checking, wallet and other accounts | If none is recorded, `plan.unassigned_savings`, and never both |
| Deposits, investment accounts | Non-liquid or fixed-deposit/brokerage accounts | Held at the recorded balance |
| Shares, funds, gold, property, EPF/PPF | Holdings (valuation as above) | Value unknown stays unknown |
| Debts | Liability records | Principal, interest and payoff from the debt calculator |
| Premiums, ULIP fund value, benefits | Insurance policies (`policy_details`: `fund_value`, `maturity_benefit`, `maturity_date`) | A premium already in planned spending is counted once |
| Goals | The plan's goals, funded by the existing allocation | No parallel goal or savings plan |

## 3. Accounting rules (enforced by construction)

Every change to a balance is an event with a cash effect, an asset effect, a liability effect and a note. Balances move only
through events, so the ledger reconciles by construction (`summary.reconciles` is checked every month and fails loudly).

| Event | Cash | Other | Net worth |
| --- | --- | --- | --- |
| Cash to investment | falls | investment rises | unchanged (charges are expenses) |
| Loan payment | falls by the payment | liability falls by principal | falls by interest only |
| Premium | falls | none | falls (cover is not an asset) |
| Documented benefit | rises once, in its month | none | rises |
| Deposit principal maturing | rises | deposit falls | unchanged (only interest above the recorded balance is income) |
| Goal contribution | falls | goal fund rises | unchanged (a transfer, not an expense) |
| Goal effect: spend | none | goal fund falls | falls |
| Goal effect: asset purchase | none | fund becomes an asset | unchanged |
| Goal effect: debt reduction | none | fund and debt both fall | unchanged |
| Shortfall | cash floored at zero | unfunded shortfall (a liability line) rises | unchanged by the line, falls by the unpaid spending |

Monthly calendar as in the goal engine. Order within a month: income and spending, growth, debt, insurance, planned investment
events, goal funding and effects, cash reconciliation. Growth, where the person gave an assumption, is applied at month end to
the balance the month opened with, at `rate / 12`, rounded to the paisa. Cash earns nothing. Goal funds earn the plan's
`savings_return_annual`. All money is `Decimal`; the API carries decimal strings.

## 4. Views

- **Baseline**: current income, spending, commitments, assets and debts. Future goals are excluded; what is already saved on a
  goal stays as a ring-fenced fund.
- **Selected goals**: the baseline plus the goals chosen, funded by the unchanged allocation policy. Surplus is not subtracted
  twice. `goal effects`: home buys an asset, education is spent, retirement and emergency fund are held, loan payoff is held unless
  a debt is named, a custom goal is held until the person chooses (never inferred from its label). The effect happens at the later
  of the goal's date and the month it is funded. A goal that reduces a debt is run to a fixed point with the loan schedule.
- **Scenario**: the same, with the planner's own scenario events. The baseline is computed separately and returned for
  comparison; it is never changed.

## 5. Assumptions and missing data

Every result carries `effective_assumptions`, `warnings`, `completeness` and `provenance`.

- Values are held constant unless the person gives a return for a holding or a class. **There is no default return**
  (the equity-return decision stays open, as the specification requires). An assumption names its scope (holding or class).
- A holding with no stored price and no entered value is left out and reported, never counted as zero.
- A stale stored price is used as the last good value and marked stale, with its source and date.
- A debt with a balance but no payment keeps its balance; its payoff is unknown. A recorded rate of 0% cannot be told from a
  rate never entered, so it is flagged. A payment below the interest lets the balance grow, and says so.
- Renewal premiums are held at today's amount (or the yearly rise the person sets), labelled as unknown renewal pricing.
- A ULIP's fund value counts once, as an asset, only if recorded; the sum assured is never an asset.
- `completeness.status`: `complete`, `partial`, or `insufficient` (nothing recorded: the UI shows an empty state, not ₹0).

## 6. API

`POST /api/v1/trajectory/project` (signed-in; the plan comes from `plan_id` of the caller's own saved plan or an explicit
`plan`). Request: `horizon` (months, or `target_age`, which needs the profile age and is otherwise refused), `view`,
`selected_goal_ids`, `scenario`, `return_assumptions`, `premium_growth_annual`, `premiums_in_spending`
(`auto|yes|no`), `linked_commitments`, `goal_effects`, `planned_events` (`investment_purchase`, `deposit_maturity`),
`include_monthly_ledger`, `include_events`, `input_snapshot_hash`. Result: `summary`, `checkpoints`, `monthly_ledger`
(opening and closing balances, events by group), `drivers`, `goals`, `comparison`, and the sections in section 5.
`input_snapshot_hash` fingerprints the inputs (quote ages and the clock are excluded); a request that names an older hash gets
`409 snapshot_changed`. Infeasibility is a result (a shortfall), not an error. Errors never echo the request.

## 7. Tests

`backend/tests/test_trajectory_engine.py` (46 tests, hand-checked) and `backend/tests/api/test_trajectory_api.py` (22 tests).
Reference cases from the specification: ₹50,000 bank-to-equity transfer (net worth unchanged); ₹10,000 EMI = ₹7,000 principal +
₹3,000 interest (cash −₹10,000 once, liability −₹7,000, net worth −₹3,000); premium linked to spending counted once; a
documented maturity benefit received once; ULIP value once; ₹1,00,000 deposit maturing (net worth unchanged); a home goal (cash
becomes a property asset, not an expense); an education goal (spent); a stale quote retaining its last value. Plus: loan
balances equal the debt calculator to the paisa; cash never negative; every month reconciles; identical inputs give identical
results; a projection never changes a record; ownership; the 600-month horizon.
Frontend: `lib/trajectory.test.ts` (12) and `pages/app/Trajectory.test.tsx` (20): loading hides old numbers, stale answers are
ignored, errors keep the choices and show no invented numbers, the empty, partial and stale states, views, goal effects,
assumptions, links, the ledger and sources.

## 8. Specification traceability

| Specification section | Status | Where / why |
| --- | --- | --- |
| 1, 4 Architecture, one source of truth | Done | Assembler in `api/trajectory.py`, engine in `engine/trajectory.py`, no stored copy |
| 5 Provenance, snapshot hash | Done | `provenance[]`, `input_snapshot_hash`, `409 snapshot_changed`; the UI ignores answers for old inputs |
| 6 Accounting invariants | Done | Section 3; tested |
| 7 Monthly order, growth timing | Done | Stated in `effective_assumptions` and tested at zero and positive rates |
| 8, 9 Insurance | Partial | Premium schedule, status, expiry, documented benefit and ULIP value are modelled. Not in the records: payment history, claims, nominees, riders, survival-benefit schedules, grace periods, renewal pricing. Reported, not invented |
| 10, 11 Debt | Partial | Amortization on the existing engine, payoff, interest/principal split, below-interest, no-payment, prepayment by a goal. Not in the records: moratorium, floating-rate resets, fees, linked property, category-specific fields |
| 12, 13 Equities | Partial | Valuation from stored snapshot or entered value, stale handling, optional return assumption. Future SIPs, dividends, corporate actions, XIRR/CAGR are not projected: no schedule or dated history is recorded for the future |
| 14 Deposits and fixed income | Partial | Held at recorded balance; a documented maturity can be applied through `planned_events`. FD/RD/PPF/EPF/NPS contract terms are not recorded |
| 14 Physical assets | Done | Constant by default; property and loan shown on both sides |
| 15 Goals | Done | Baseline, selected goals, scenario; goal-type effects; allocation reused |
| 16 UI | Done | Header, metrics, view selector, five charts, drivers, goal impact, comparison, checkpoints, event timeline, input health, monthly detail, assumptions and sources; loading, empty, partial, error, stale and incomplete states; English and Hindi |
| 17 API | Done | Suggested shapes followed, additive, contract generated |
| 18 Missing-data policy | Done | Section 5 |
| 19 Tests and gates | Done | Section 7 |
| 20 Privacy | Done within scope | Owner-scoped reads; no request bodies or figures logged by the new code; no new storage. Not claimed: legal or regulatory compliance |

## 9. Known limitations

- The records cannot express most of the specification's insurance, debt, deposit and equity field inventories. Those fields
  need new record types before they can be projected; until then they appear as warnings and missing-data items.
- Plan loan payments and recorded debts are two sources. Equal payments are flagged as a possible duplicate and can be linked
  in the tab; otherwise both are counted.
- Goal savings recorded on a goal and an account balance that holds the same money are counted twice; the tab says so.
- Age views use the age on the profile (whole years), not a date of birth.
- A shortfall is never repaid by later surplus: it stays as an unfunded line (the same convention as the goal engine).
- Checked in the in-app browser against a local API and a scratch SQLite database (seeded account: accounts, a fixed deposit, gold, a priced-but-stale holding, two debts, a policy, a profile age): figures matched hand calculations, and 375 px and 320 px widths showed no horizontal overflow. Not checked on a physical device, in dark mode or in Hindi, nor against a hosted database. No deployment, migration or production change was made by this work.

## Update: inflation-adjusted net worth, the year-by-year table, spending source

- `inflation_annual` (optional): restates net worth in today's money as `net_worth / (1 + inflation)^(months ahead / 12)`. It changes
  no cash flow. The result adds `summary.inflation_annual`, `summary.horizon_net_worth_real`, `checkpoints[].net_worth_real` and
  `yearly[].closing_net_worth_real`. With no rate given these are null: no inflation is assumed. The rate is part of the input
  snapshot hash.
- `yearly`: one row per calendar year of the horizon, built only from the monthly ledger: opening and closing cash, cash in and out
  (total and by group), interest and principal of debt payments, closing balances by class, opening and closing net worth, the change,
  and `reconciles` (the change equals the sum of the year's events' net-worth effects). Each year's closing figures equal the next
  year's opening figures. Age is the age at the end of the year.
- `spending_source`: see `EXPENDITURE_PROJECTION.md`.
- Still not in the table as separate columns: investment growth versus contributions (they are in the group totals and the event
  ledger), and a physical-asset purchases/sales split. The records do not carry a physical-asset growth rate, so assets are held constant.
