# ArthaYukti requirement traceability

Audit of the repository against the master specification (`docs/spec/ArthaYukti_Master_Specification.txt`, cited as M), the UI restructuring brief (U) and the audit and implementation brief (A). Written against baseline `7410951` and the code commit `d9a853a` of this pass; see the final report.

Status means: **PASS** works end to end and has test or browser evidence; **PARTIAL** exists but misses part of the requirement; **FAIL** not implemented; **BLOCKED** needs a credential, provider or decision outside the repository; **UNVERIFIED** may be true but was not checked; **CONFLICT** two sources disagree (see the conflict register). A requirement is never PASS because a page, route or test name exists.

## Summary

| Status | Count |
| --- | --- |
| PASS | 95 |
| PARTIAL | 38 |
| FAIL | 19 |
| BLOCKED | 3 |
| UNVERIFIED | 2 |
| CONFLICT | 2 |
| **Total** | **159** |

The master specification describes a target product of about sixty tables, named scenario tabs, a tax rule engine, a staged import pipeline and whole-picture AI analysis. The repository is a hackathon MVP with a different, smaller shape. The headline gaps are in section C and D: persisted scenarios (SC-01), a tax rule engine (TX-01), an investment trajectory (TJ-02), staged import (IM-01), asset allocation to the emergency reserve (EF-03) and the richer household, insurance and debt records. Rows marked NEW were added in this pass.

## A. Vision and AI boundaries

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| V-01 | M 1 | Show the current financial position and its future trajectory | PASS | Dashboard.tsx, Outlook.tsx; browser sweep of 30 routes |  |
| V-02 | M 1, 4.1 | Estimate whether goals can be achieved under explicit assumptions | PASS | engine/projection.py; test_golden.py, test_projection.py |  |
| V-03 | M 1 | Explain shortfalls and trade-offs | PASS | engine/tradeoffs.py, fixes.py; test_fixes.py |  |
| V-04 | M 1, 4.9 | Test changes in independent scenarios | PARTIAL | Three fixed situations (normal, no income, an expense) can be compared (Compare, Outlook scenario comparison) | No persisted, named scenario tabs or dated events (see SC-01) |
| V-05 | M 1, 4.16 | AI analyses the complete relevant financial picture | PARTIAL | Gemini helps in Plan B only (situation reading, plan explanation) | No whole-picture analysis; risk capacity is deterministic rules only (RK-04) |
| V-06 | M 3, 4.16 | The deterministic engine is authoritative; AI never calculates | PASS | app/ai/assist.py rejects wording with an uncalculated figure; test_ai_assist_api.py |  |

## B. Household profile and risk (master section 2)

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| HP-01 | M 2 | Date of birth or age, with reference date and approximate flag | PARTIAL | HouseholdProfile.primary_earner_age (integer, 18 to 100) | No date of birth, reference date or approximate flag |
| HP-02 | M 2 | Parent commitments: Yes/No/Unsure with optional amount, dates, notes | PARTIAL | supports_mother, supports_father (yes/no/unsure), monthly_family_support | No start date, review date, medical budget or notes |
| HP-03 | M 2 | Children: whether, how many, optional ages | PARTIAL | has_children, children_count, children_ages_json | No per-child financial responsibility or linked education goals |
| HP-04 | M 2, 4.9 | Planned children and family events as uncertain scenarios, not facts | PARTIAL | planned_events (years ahead, lump sum, ongoing cost) stored on the profile | Not applied to any plan or scenario, no certainty flag, no base-versus-alternative comparison |
| HP-05 | M 2 | Other financial dependants | PARTIAL | dependants_count, financial_dependants, dependants_details_json | No relationship categories or schedules as cash-flow events |
| HP-06 | M 2, 4.13 | Household income from the Income module, no member management | PASS | IncomeSection; income streams in the plan |  |
| HP-07 | M 2, 5.1 | Profile completeness and provenance (user-entered, confirmed, last updated) | FAIL | Only created_at and updated_at | Add completeness and per-field provenance |
| HP-08 | M 2 | Prefer-not-to-say and unknown answers | PARTIAL | unsure / not_sure values on several fields | Not on every field |
| RK-01 | M 2 | Risk capacity kept separate from risk tolerance | PASS | GET /household/risk-capacity (capacity) versus /risk/assessment (tolerance); test_profile_and_risk.py |  |
| RK-02 | M 2 | Risk need as a third, separate notion | FAIL | Not present | Define and add if wanted |
| RK-03 | M 2 | Deterministic quantitative indicators for capacity | PARTIAL | Reserve coverage in months, recommended reserve months, factor explanations | No debt-payment burden, income concentration or adverse-scenario shortfall indicator |
| RK-04 | M 2, 4.16 | Gemini interprets the indicators and explains trade-offs | FAIL | Not built | Needs a risk-capacity prompt with the privacy summary; blocked on a live key to verify |
| RK-05 | M 2 | Original and more conservative recommendation variants | PASS | recommendations.py; ConservativeRecommendationsView; test_recommendation_fixtures.py |  |
| RK-06 | M 2 | A suggestion to take more risk is checked against capacity and reserves | PARTIAL | Recommendation fixtures reference reserve guidelines | Not verified end to end against every constraint listed |
| RK-07 | M 2, 9 | Factors shown; score not presented as a guarantee | PASS | Explanation lists in the risk-capacity response |  |
| RK-08 | A 3.9, U | A new user is not forced through a questionnaire to reach the dashboard | PASS | Auth.test.tsx; Restructure.test.tsx; browser signup |  |

## C. Architecture and data (master sections 3 and 5; audit 3.1)

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| AR-01 | M 3 | Modular architecture with separated responsibilities | PASS | backend/app (api, engine, schemas, ai, adapters); frontend (pages, components, state, lib) |  |
| AR-02 | M 3 | One chronological engine for household, goals and the filtered trajectories | PASS | Outlook pages read the same monthly projection rows |  |
| AR-03 | M 3 | Projections reproducible from versioned inputs and snapshots | PARTIAL | calculation_runs table is written by the rescue analysis only; MODEL_VERSION exists | No input snapshots; other projections are recomputed on request |
| DB-01 | M 5, A 3.1 | PostgreSQL with versioned migrations and one head | PASS | alembic head a7b8c9d0e1f2; upgrade, check, downgrade, re-upgrade on scratch PostgreSQL and SQLite this pass | Hosted PostgreSQL (Neon) untested |
| DB-02 | M 5 | Normalised model of about sixty tables (income, expense, goals, scenarios, tax, AI, research, import) | FAIL | About twenty tables; the plan (income, expenses, goals) is one JSON document per saved plan | Deliberate MVP shape; migrating to the full blueprint is post-hackathon work |
| DB-03 | M 5, A 3.2 | Decimal money and rates, never binary floating point | PASS | Numeric columns, Decimal engine, decimal-string API; test_money.py |  |
| DB-04 | M 5, 9, A 3.1 | Per-user isolation | PASS | test_auth_and_tenancy.py, per-module ownership tests (recovery, ledger, expenditure, debt trajectory, preferences) |  |
| DB-05 | M 5.10 | Audit trail with before/after references | PARTIAL | audit_logs written for sign-in events and, now, ledger changes | No before/after diffs; not written for every override |
| DB-06 | A 3.1 | Account export and deletion | PASS | GET /auth/export-data includes plans, accounts, policies, holdings, ledger, calculators, agreements, preference; delete cascades; test_export.py, test_hardening.py, test_holdings_ledger_api.py |  |
| DB-07 | M 5.9 | Scenario, projection-run, input-snapshot and trajectory-definition tables | FAIL | Not present | See SC-01 |
| DB-08 | M 5.4, A 3.5 | Holdings with transactions, lots and corporate actions | PARTIAL | NEW this pass: investment_transactions (buy, sell, split, bonus, dividend), FIFO lots computed, reconciliation, CSV; test_ledger_engine.py (13), test_holdings_ledger_api.py (29) | No switches, mergers, reinvested-dividend lots, FX, persisted tax lots |
| DB-09 | M 4.11, 5.4 | Dated price snapshots with source, timestamps, stale and failure status | PARTIAL | market_data_snapshots (symbol, price, currency, source, fetched_at, is_stale); adapter reports fresh, stale or unavailable | No instrument table, no separate market and retrieval timestamps, no provider-health table |
| DB-10 | M 5.4, A 3.6 | Mutual-fund schemes, NAV history and holdings | PARTIAL | A mutual fund is a holding of type mutual_fund; the ledger takes fractional units and a NAV as the price; exports work | No scheme code or ISIN, no NAV history source |
| DB-11 | M 4.18, 5.5 | Detailed liability model | PARTIAL | liabilities: name, type, principal, balance, rate, EMI, dates, remaining months | No lender, rate type, fees, collateral, prepayment rules, rate periods or stored schedules |
| DB-12 | A 3.7 | Debt investments represented separately from liabilities | FAIL | Not present | Add instrument types for deposits and bonds |
| DB-13 | M 4.19, 5.7 | Full insurance model (members, assets, claims, nominees, renewals, events) | PARTIAL | insurance_policies, coverage_escalations and history, reminders | No insured members, assets, claims, nominees, renewal quotes or coverage-need estimates |
| DB-14 | M 4.10, 5.8 | Versioned, effective-dated tax rule tables and overrides | FAIL | Not present | See TX-01 |
| DB-15 | M 5.10 | ai_analysis_runs, ai_recommendations, research_sources tables | FAIL | Not present | Gemini use is stateless and not recorded |
| DB-16 | A 3.1 | Safe handling of legacy records and saved plans | PASS | All new plan fields are optional; golden and legacy tests unchanged; additive migrations |  |
| DB-17 | A 3.1 | Explicit units, dates, currency and valuation conventions | PASS | docs/FINANCIAL_MODEL.md, INCOME_MODULE.md, EXPENDITURE_MODULE.md, HOLDINGS_LEDGER.md, CALCULATORS_MODULE.md |  |

## D. Financial rules (master section 4)

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| GP-01 | M 4.1 | Five named priority tiers with ranking inside each tier | PARTIAL | Goals carry a numeric priority 1 to 8, strictly ordered | CONFLICT C6: no named tiers |
| GP-02 | M 4.1 | Fund goals strictly in priority order, never proportionally | PASS | FINANCIAL_MODEL.md section 6; test_golden.py |  |
| GP-03 | M 4.1, 4.17 | Protect essential spending and required payments before goals | PASS | Surplus is income minus spending and loan payments before any goal is funded |  |
| GP-04 | M 4.1 | Test alternatives and classify goals feasible, feasible with adjustments, unrealistic | PARTIAL | fixes.py tests levers and re-runs the engine; statuses on_track, delayed, not_achievable | No explicit three-way classification label |
| GI-01 | M 4.2 | Goal inflation default 5%, formula target x 1.05^years | PARTIAL | Engine inflates monthly: target x (1 + r/12)^months (FINANCIAL_MODEL.md section 4); onboarding defaults to 5% | CONFLICT C4: monthly nominal versus annual effective compounding |
| GI-02 | M 4.2 | Show entered and inflation-adjusted amounts | PASS | GoalOutcome.target_amount_today and inflated_target_at_deadline |  |
| GI-03 | M 4.2, 5.3 | User chooses which amount is the target; original, calculated and chosen amounts kept | FAIL | Not present | Add selected-target fields |
| GI-04 | M 4.2 | Today's money versus future nominal basis stated | PASS | Goal.inflation_linked |  |
| EI-01 | M 4.3, A 3.4 | Spending: constant, one rate, per-line growth, custom schedules | PARTIAL | NEW: per-line annual_growth with plan-wide default; engine/expenditure.py; test_expenditure_module.py (25) | No custom period-by-period growth schedules; no per-category growth (per-line instead) |
| EI-02 | M 4.3 | No silent default expenditure inflation | PASS | expense_growth_annual starts at an explicit 0 and is editable on the Expenditures panel |  |
| EI-03 | A 3.4 | Default expenditure inflation of 6% | CONFLICT | C1: not in the master specification in the repository, which forbids a silent default | Awaiting the product owner; see EXPENDITURE_MODULE.md |
| EX-01 | A 3.4 | Categories and individual spending streams | PASS | NEW: Expense.category and scheduled lines; ExpenditureSection |  |
| EX-02 | A 3.4 | Monthly, quarterly, yearly frequencies with correct normalisation | PASS | test_frequencies_are_spread_evenly_to_their_monthly_equivalent; rounding test (99.96) | Quarterly and yearly bills are spread evenly, not lumped (disclosed) |
| EX-03 | A 3.4 | Temporary versus permanent, ongoing versus bounded schedules | PASS | start_month and end_month inclusive; tests for bounded and later-starting lines |  |
| EX-04 | A 3.4 | Correct partial-year treatment | PASS | test_partial_years_only_count_the_months_inside_the_plan; months_included in the response |  |
| EX-05 | A 3.4 | No double application of inflation | PASS | One rate per line (own or plan-wide); precedence table in EXPENDITURE_MODULE.md |  |
| EX-06 | A 3.4 | Cumulative chart, annual and monthly tables, CSV | PARTIAL | Yearly bars, yearly table with running total, essential split, CSV (test and browser) | No monthly table or monthly CSV for spending (Outlook shows monthly rows) |
| EX-07 | A 3.4 | Integration with cash flow, goals, emergency funds and outlook | PASS | flows.py uses line_amount; emergency essentials ignore lines not running yet; reconciliation test against project() |  |
| IG-01 | M 4.4, A 3.3 | Income streams with growth schedules, step-ups, frequencies, calendar years | PASS | docs/INCOME_MODULE.md; test_income_module.py | Technical cap of 200 streams versus unlimited |
| IG-02 | M 4.4 | Constant income when no growth, and say so | PASS | Blank growth means constant (INCOME_MODULE.md) |  |
| IG-03 | A 3.3 | Step-up precedence, annual charts and tables, CSV, integration; actual income kept apart from forecast | PASS | Step-up replaces the base; growth then compounds from it; test_income_module.py; ledger transactions never feed the forecast |  |
| EF-01 | M 4.5 | Emergency target defaults to 12 months, editable | PASS | NEW: Emergency page shows 12 until the person saves their own (Audit.test.tsx) |  |
| EF-02 | M 4.5 | Track current, target, shortfall, expected completion | PASS | POST /emergency-fund/analyze; test_settings_emergency_api.py; browser check by hand |  |
| EF-03 | M 4.5, 5.6 | Allocate eligible assets to the reserve with accessibility classes | FAIL | Reserve is the emergency-fund goal's saved balance | Add allocations with accessibility, cost and settlement time |
| EF-04 | M 4.5, A 4 | Reserve counted once, never double counted | PASS | Bank balances are never added; test_the_reserve_is_counted_once_and_bank_balances_are_never_added |  |
| PA-01 | M 4.6 | Physical assets with sale willingness Yes/No/Maybe and a residence flag | FAIL | asset types include real_estate and gold; only is_liquid | Add willingness, residence and sale-cost fields |
| IR-01 | M 4.7 | Expected return per holding, with dated return schedules | PARTIAL | Per-investment growth in the calculators | None on holdings; no date-range schedules or precedence rules |
| IR-02 | M 4.7, A 3.2 | Estimated returns kept separate from actual observed performance | PARTIAL | Ledger holds actuals; calculators hold assumptions; labelled | No realised-return or XIRR report |
| SP-01 | M 4.8 | Multi-step SIP schedules, consistent across views | PARTIAL | Calculator step-ups by investment year | Date-based steps and use in household projections are not built |
| SC-01 | M 4.9, 5.9 | Named scenario tabs with isolated assumptions and dated events, saved | FAIL | Fixed situations only | Largest structural gap: needs scenario tables and an event model |
| SC-02 | M 4.9 | Side-by-side comparison of feasibility, net worth, cash flow, debt-free dates | PARTIAL | Compare and Outlook scenario comparison for the three situations | Not for saved scenarios |
| TX-01 | M 4.10 | Versioned, effective-dated, instrument-specific tax rule engine | FAIL | Calculators apply one tax rate per investment, once, at the valuation date | Needs a rule-set model and sources; research must be user-enabled |
| TX-02 | A 3.10, U | Tax calculation kept in the calculators after the Taxes page was removed | PASS | tax_rate in the calculators; test_calculators_engine.py |  |
| TX-03 | M 4.10 | Tax shown as an estimate with assumptions | PARTIAL | Calculator copy labels tax and valuation conventions (CALCULATORS_MODULE.md) | No explicit not-tax-advice notice on every tax figure |
| MD-01 | M 4.11 | Market adapter with cache, manual refresh and stale marking | PARTIAL | Read-only adapter returning fresh, stale or unavailable | No provider, no refresh endpoint |
| MD-02 | M 4.11, A 3.5 | Never fabricate a price | PASS | get_market_quote returns unavailable; ledger valuation says its basis; tests |  |
| MD-03 | M 4.11 | A live provider integration | BLOCKED | No provider chosen, no credentials; the spec asks to verify the proposed repository's terms first | Choose and verify a provider, then implement behind the adapter |
| IM-01 | M 4.12 | CSV import with column mapping, review and confirm before it affects records | PARTIAL | POST /financials/transactions/import validates, skips duplicates and reports | No mapping step, staged review or confirm; imported rows go straight to the ledger |
| IM-02 | M 4.12 | XLSX import | FAIL | CSV only |  |
| TJ-01 | M 4.14 | Household trajectory | PASS | HouseholdTrajectoryPage over the engine's monthly rows |  |
| TJ-02 | M 4.14 | Investment trajectory | FAIL | InvestmentTrajectoryPage states it is not available and lists holdings | Needs an investment projection engine; the calculators are separate |
| TJ-03 | M 4.14, A 3.7 | Debt trajectory with interest, repayments, balances and debt-free dates | PASS | NEW: GET /debt/trajectory on the amortization engine; test_debt_trajectory.py (9); Outlook Debt page | Debts the record cannot support are listed as limited |
| TJ-04 | M 4.14 | Expenditure trajectory | PARTIAL | Outlook page by line; new yearly projection under Income and Expenditures | Outlook page still reads flat monthly lines |
| TJ-05 | M 4.14 | Custom trajectory with signs, components, definition and pre/post-tax | PARTIAL | Four flows with add, subtract or ignore; row-by-row table | No component selection beyond four flows, no tax columns, no saved definitions |
| TJ-06 | M 4.14 | Goal feasibility page | PASS | GoalFeasibilityPage; empty-account state added earlier |  |
| TJ-07 | M 4.14 | Scenario comparison page | PARTIAL | ScenarioComparisonPage for the three situations | See SC-02 |
| TJ-08 | M 4.14 | Trajectory-specific required-field checklist before calculating | FAIL | Not present |  |
| TJ-09 | M 4.14, A 3.10 | CSV export of relevant results | PARTIAL | Income, expenditure, calculators and holding ledger; account data JSON | No household or goal trajectory export |
| DN-01 | M 4.15 | Dashboard as one scrolling command centre with jump navigation | PASS | SectionNavigator; sections summary to alerts |  |
| DN-02 | M 4.15 | Tax overview section on the dashboard | CONFLICT | C2: removed on the user's instruction when the Taxes page was removed | Reinstate only if wanted |
| DN-03 | M 4.15 | Persistent sidebar on desktop, compact on small screens | PASS | AppShell.tsx; mobile drawer checked at 320 px |  |
| DN-04 | M 4.15 | Financial Outlook group with seven pages | PASS | OUTLOOK_ITEMS in lib/nav.ts |  |
| CF-01 | M 4.17 | Default cash hierarchy: essentials, mandatory payments, emergency fund, goals, optional spending and prepayments | PARTIAL | First four are in the engine; optional spending and prepayment optimisation are not |  |
| DT-01 | M 4.18, A 3.7 | EMI and amortization correct; interest, principal and balances reconcile | PASS | test_debt_engine.py; test_settings_emergency_api.py; hand check 8,884.88; trajectory reconciliation tests |  |
| DT-02 | A 3.7 | Extra payments and repayment strategies | PASS | Avalanche and snowball comparison; UI added; tests |  |
| DT-03 | A 3.7 | Zero balance and insufficient payment give sensible results | PASS | debt_invalid and payment_too_low (422); limited status in the trajectory |  |
| DT-04 | M 4.18 | Rate periods, fees, prepayment penalties, secured obligations | FAIL | Not modelled |  |
| DT-05 | A 3.7 | Calculators never alter saved debts | PASS | The calculator only posts to /debt/amortize; no writes |  |
| IN-01 | M 4.19, A 3.8 | Policy details, premiums, coverage, frequency, dates | PASS | test_insurance_api.py, test_health_insurance.py, test_other_policies.py |  |
| IN-02 | A 3.8 | Premium and coverage escalation schedules | PASS | test_insurance_escalation.py (simple, compound, fixed, step-up, inflation-linked) |  |
| IN-03 | A 3.8 | Renewal reminders | PASS | insurance_reminders; Alerts page |  |
| IN-04 | M 4.19 | Premium cash flows included in household projections | PARTIAL | Premiums count only if the person adds them as spending (stated on the page) | No automatic link |
| IN-05 | M 4.19 | Coverage-gap detection and editable need estimates | FAIL | Not present | Needs user inputs and assumptions; never claim adequacy without them |
| IN-06 | A 3.8 | No claim that coverage is adequate without data | PASS | Insurance module note |  |

## E. Calculators (audit 3.10)

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| CA-01 | A 3.10 | Lump sum and SIP with monthly, quarterly, annual contributions | PASS | test_calculators_engine.py, test_calculators_api.py; CALCULATORS_MODULE.md |  |
| CA-02 | A 3.10 | Separate contribution and growth periods; step-ups | PASS | Same |  |
| CA-03 | A 3.10 | Tax once, inflation adjustment, rounding conventions | PASS | CALCULATORS_MODULE.md; engine tests |  |
| CA-04 | A 3.10 | Individual maturity dates and a shared comparison date with explicit after-maturity decisions | PASS | Maturity check endpoint and tests |  |
| CA-05 | A 3.10 | Principal-versus-gains chart and growth graph | PASS | GrowthChart.tsx in ResultsView |  |
| CA-06 | A 3.10 | Scenario comparison and CSV that matches the screen | PASS | ComparePanel; export test |  |

## F. Plan B audit (audit section 4)

Verified with docs/reports/PLAN_B_STAGE7_AUDIT.md and an independent integer-paise script, rerun this pass: ledger and API agree on every month of all four scenarios.

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| PB-01 | A 4 | Define a disruption (reduced or lost income, unexpected cost) and its duration | PASS | PlanB steps 1 and 2; test_recovery_api.py |  |
| PB-02 | A 4 | Identify protected commitments | PASS | Step 3; evaluator never adjusts protected or mandatory items |  |
| PB-03 | A 4 | Permitted adjustments (reduce, pause) with limits | PASS | Step 4; permissions validated server-side |  |
| PB-04 | A 4 | Protected balances and an explicit reserve floor | PASS | protected_balances_withdrawn is always 0.00; floor checked every month-end |  |
| PB-05 | A 4 | Evaluate combinations with the deterministic engine | PASS | recovery_search.py; test_recovery_search.py |  |
| PB-06 | A 4 | See effect on cash flow, reserve, goals, restoration | PASS | Results view; metrics; restoration outcomes | Goal delay in months is not calculated (deferred rupees shown) |
| PB-07 | A 4 | Clear infeasibility result | PASS | Infeasibility report; test_recovery_compare.py |  |
| PB-08 | A 4 | Exhaustive versus incomplete search, never claimed infeasible when capped | PASS | search.status found, infeasible, incomplete; work-budget test |  |
| PB-09 | A 4 | Save an editable, versioned Recovery Agreement with review date and restoration conditions | PASS | test_recovery_api.py (28); browser v1 to v2 |  |
| PB-10 | A 4 | Recalculate and review an agreement when circumstances change | PASS | recovery_review.py; test_recovery_review.py (6); allowance carried across reviews | Real past figures cannot be entered (limitation) |
| PB-11 | A 4 | Reserve and emergency-goal balances not counted twice; protected assets not drawn down | PASS | Evaluator tests; goal contributions are transfers |  |
| PB-12 | A 4 | Regression: income 1,00,000 to 60,000 for six months; floor 1.8 lakh; eight-month infeasible case | PASS | Independent ledger script: 90,000 / 1,50,000 / 1,80,000 ends; eight months breach in months 7 and 8 at 1,60,000 and 1,40,000 |  |
| PB-13 | A 4 | Extend the existing implementation; preserve routes, data and agreements | PASS | Same routes and tables; unchanged this pass |  |

## G. Gemini (audit section 5)

No Gemini key exists in this environment. Nothing below claims a live call worked.

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| GM-01 | A 5 | Key server-side only; never in frontend, logs or reports | PASS | backend config only; tests assert the key is absent from the contract, responses and logs |  |
| GM-02 | A 5 | Validate structured output before it changes anything; treat text as untrusted | PASS | Draft only fills editable fields; invented figures dropped; explanation refused if it uses an uncalculated number |  |
| GM-03 | A 5 | Handle missing key, rate limits, invalid responses, outages | PASS | test_ai_assist_api.py (33) |  |
| GM-04 | A 5 | Usable fallback when Gemini is unavailable | PASS | AI controls hidden or noted; the form and calculations work without it; verified in the browser |  |
| GM-05 | A 5 | A live Gemini call succeeds | BLOCKED | No GEMINI_API_KEY; the request shape is written from memory and only run against a stub; the default model name is unconfirmed | Add a key, run one call per route, confirm the model name |
| GM-06 | A 5 | Natural-language parsing and explanation beyond Plan B | PARTIAL | Plan B only; the Advisor page is keyword rules and says so |  |

## H. UI restructuring prompt

All checked in tests and in the in-app browser (emulation, not a physical device).

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| U-01 | U | Signup asks only basic details (name, email, password, language, consent) | PASS | Auth.test.tsx asserts the request body is exactly email, password, full_name |  |
| U-02 | U | Land on the dashboard, no forced setup | PASS | Auth.test.tsx; browser signup landed on #/dashboard |  |
| U-03 | U | Empty-account guidance with no fabricated data | PASS | GettingStarted panel; Restructure.test.tsx; browser |  |
| U-04 | U | Existing accounts and saved data unaffected | PASS | Auth.test.tsx: a saved plan opens the dashboard; backend suites unchanged |  |
| U-05 | U | Household Profile renamed User Profile without losing fields | PASS | nav copy, page heading, tab label; fields unchanged |  |
| U-06 | U | Section named Income and Expenditures; heading Your Incomes | PASS | Income.test.tsx; Restructure.test.tsx |  |
| U-07 | U | Calculator access from Income and Expenditures | PASS | Calculators shortcut panel; Restructure.test.tsx | CONFLICT C3: also a separate Calculators section |
| U-08 | U | Calculators hub with Insurance, Debts and Equities backed by real endpoints | PASS | CalcHub.tsx; Restructure.test.tsx; browser calculation matches the standard EMI |  |
| U-09 | U | Emergency Funds below Calculators, backed by the engine | PASS | lib/nav.ts order; Emergency.tsx |  |
| U-10 | U | Goals and Financial Outlook stay distinct | PASS | Separate nav items and pages |  |
| U-11 | U | Taxes page removed; tax calculation kept | PASS | No route or nav item; old link lands on the dashboard; TX-02 |  |
| U-12 | U | Standalone CSV/export page removed; useful exports kept | PASS | Import moved into Income and Expenditures; exports in Settings, calculators, income, expenditure, ledger |  |
| U-13 | U | Default Inflation Rate persists per user, validated, scope and precedence documented | PASS | GET and PUT /auth/preferences; tests; EXPENDITURE_MODULE.md |  |
| U-14 | U | Saved plans, scenarios and agreements keep their assumptions | PASS | test_changing_the_default_does_not_touch_saved_plans_or_calculations |  |
| U-15 | U | Navigation, redirects, empty and error states, responsiveness | PASS | 30 routes swept; 320 px checked on every changed page this pass | No physical device |
| U-16 | U | Branding preserved | PASS | No logo, wordmark or palette change |  |
| U-17 | U | Hindi parity for new copy | PARTIAL | English and Hindi copy for every new string | No native-speaker review; some server sentences are English only |

## I. Security, privacy, tests and process

| ID | Source | Requirement | Status | Evidence | Gap or next action |
| --- | --- | --- | --- | --- | --- |
| SE-01 | M 9 | Authentication, authorisation, rate limiting | PASS | test_security_and_logging.py, test_hardening.py; AI limited per account |  |
| SE-02 | M 9 | Upload validation (type, size, encoding) | PASS | CSV import checks size, UTF-8 and headers |  |
| SE-03 | M 9 | Prompt-injection resistance for imported and typed text | PASS | AI text is data; outputs validated; tests |  |
| SE-04 | M 9 | No account linking or automatic transactions | PASS | None exist |  |
| SE-05 | M 9 | Encryption at rest and protection of identifiers | UNVERIFIED | Depends on the database host | Check on the real PostgreSQL |
| SE-06 | A 8 | Production persistence and deployment readiness | BLOCKED | docs/PRODUCTION_READINESS.md; nothing deployed or changed this pass | Needs approval: database, signing key, environment, migrations |
| TS-01 | A 8 | Backend, frontend, type, lint and build checks | PASS | See the final report for exact counts |  |
| TS-02 | A 8 | PostgreSQL tests and migration round trip | PASS | Run this pass on a scratch PostgreSQL | Not a hosted database |
| TS-03 | M 10 | Fixtures for every listed formula | PARTIAL | Most formulas hand-checked | No tests for asset sale with fees, tax and secured loan, taxable redemption, or the family-commitments scenario |
| TS-04 | A 8 | Automated browser end-to-end tests | FAIL | Browser checks were manual and scripted in the in-app browser | Add Playwright |
| TS-05 | A 8 | Physical-device testing | UNVERIFIED | No phone available |  |

## Conflict register

| ID | Conflict | Interpretation used | Decision needed |
| --- | --- | --- | --- |
| C1 | Default expenditure inflation: 6% (audit brief) versus no silent default (master 4.3) versus the user-set Default Inflation Rate (restructuring brief). | Spending growth is an explicit, editable plan rate starting at 0, with a one-click use of the person's default. Nothing is applied silently. | Product owner to supply the Expenditure module specification or decide the starting value. |
| C2 | Dashboard tax overview (master 4.15) versus removing the Taxes page (restructuring brief). | The user's explicit instruction wins: the page and the dashboard section are removed; tax stays inside the calculators. | Reinstate a tax summary only once a tax rule engine exists. |
| C3 | A calculator entry under Income and Expenditures versus a separate Calculators section. | Both: a shortcut panel on Income and Expenditures opens the Calculators hub; the three modules live under Calculators. | Confirm that reading. |
| C4 | Goal inflation 1.05 to the power of years (master 4.2) versus monthly compounding (existing engine and FINANCIAL_MODEL.md). | The engine is unchanged to avoid altering existing results; the difference is documented. At 5%, ten years gives 1.6289 annually and 1.6470 monthly. | Decide whether to switch the convention; it would change every inflated goal. |
| C5 | Master spec says Household Profile; restructuring brief says User Profile. | Renamed in the interface; the data model and household fields are unchanged. |  |
| C6 | Five named priority tiers (master 4.1) versus a numeric 1 to 8 order. | Numeric order kept; strict allocation order is the same. | Add tier labels if wanted. |
| C7 | Master spec asks Gemini to see the whole financial picture; it also demands data minimisation. | Gemini receives only a typed description or an evaluated plan's figures, never identifiers. | Define a minimised whole-picture summary before building risk analysis. |

## Sources not available

The reference PDF named in the master specification ("Personal Finance Management Application: Product and Data Model"), the problem-statement PDF, the separate Expenditure module specification and the separate calculators specification are not in the repository. Requirements that depend on their field lists (DB-11, DB-13, the 6% default) could only be checked against the master specification's own summary of them.
