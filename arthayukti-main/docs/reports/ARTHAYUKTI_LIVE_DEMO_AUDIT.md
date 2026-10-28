# ArthaYukti — Live Demo Audit

Date: 2026-10-25. Branch `feat/tradeoffs` at `35f194e` plus Antigravity's **uncommitted** backend work (left untouched).
Method: real backend (working tree, temp SQLite DB built by Alembic, port 8010) and Vite (port 5180) driven through the in-app visible browser. Synthetic accounts only. Your `arthayukti.db`, and the servers on 8000/5173, were not touched. No source file was edited, nothing staged, committed or pushed. Test servers and the temp DB were removed.

## A. Executive summary
- The core journey works against the real backend: sign up → guided setup → dashboard → edit spending → goals → rescue → records → insurance → sign out/in. Money figures I checked match independent calculations.
- Antigravity's backend work is real: `pytest` on the working tree gives **363 passed**. Debt amortisation, strategy comparison, SIP step-ups, transfers, record edit/delete and household/risk endpoints all answered correctly on live calls.
- **None of that new backend is wired into the frontend.** The frontend's types come from the committed contract, and the Debt/Investment outlook pages still say the engines "do not exist".
- Real defects found: data export omits most of what the UI says it exports; the dashboard overflows sideways at 390 px; the Compare page says "Every dream is on time" when one goal is 93 months late; existing savings are not counted toward the goals; the household profile API invents an age and household type when none was saved.
- **Demo verdict:** ready for a guided demo of the planning journey (signup, setup, dashboard, goals, rescue, what-if, fixes, trade-offs, insurance). Not ready to claim debt, SIP, household profile, tax or full record management. Fix the P0/P1 items below first.

## B. Feature-by-feature
Status: PASS / FAIL / PARTIAL / MISSING / BLOCKED / NOT TESTED. "Live" = exercised in the browser, or by direct API call where the UI has no screen (marked API).

| Module | Feature | Frontend | Backend | Live | Notes |
|---|---|---|---|---|---|
| Auth | Signup validation (email, weak password, mismatch, consent) | PASS | PASS | PASS | Each error shown before any request |
| Auth | Duplicate email | PASS | PASS | PASS (API) | Generic message, no enumeration |
| Auth | Signup → setup; login; wrong password; logout | PASS | PASS | PASS | Token not shown; cleared on logout |
| Auth | Session after refresh; protected route | PASS | PASS | PASS | Anonymous `#/dashboard` → login |
| Auth | Password reset | PASS (UI) | BLOCKED | BLOCKED | No SMTP configured; UI says "not available" honestly |
| Onboarding | Income (2 sources), expenses (7), savings, goals (3), review, build | PASS | PASS | PASS | Live preview ₹55,000 left = 1,20,000 − 65,000 |
| Onboarding | Age 32, dependants 2, household type | MISSING | PASS (API) | n/a | No such step; API exists |
| Onboarding | Emergency target 6 months | PARTIAL | – | PASS | Suggests ₹3,60,000 (6 × essential ₹60,000), not applied to the goal amount |
| Dashboard | Net worth, assets, liabilities, cash flow, goals, charts | PASS | PASS | PASS | ₹6,51,000 − ₹4,00,000 = ₹2,51,000 ✓ |
| Dashboard | Emergency fund "Set aside" | PARTIAL | – | FAIL | Shows ₹0 while ₹4L savings exist (see bug 4) |
| Income | View; change amounts | PARTIAL | PASS | PASS | Edit amounts only. No add/delete, frequency, growth |
| Expenses | View; change amounts; persist | PARTIAL | PASS | PASS | 5,000→8,000 saved, survived reload |
| Expenses | Add/delete line, categories, recurrence, growth | MISSING | – | n/a | |
| Expenditure trajectory | Per-line table + look-ahead | PARTIAL | – | PASS | Constant spending only; no growth engine |
| Goals | Add, remove, reorder, amount ±, date, tiers | PASS | PASS | PASS | |
| Goals | Feasibility, shortfall, completion | PASS | PASS | PASS | See section D |
| Rescue | Constraints, options, recalculation | PASS | PASS | PASS | Shortfall ₹7,12,822 → ₹24,727 with +₹20,000/month |
| Rescue | Apply an option to the plan | MISSING | MISSING | n/a | By design, not offered |
| Accounts | Create, list | PASS | PASS | PASS | |
| Accounts | Edit, transfer | MISSING | PASS (API) | PASS (API) | Transfer kept net worth at ₹3,97,500 |
| Transactions | Create (UI), list | PASS | PASS | PASS | Balance fell ₹3,500 |
| Transactions | Delete, balance reversal | MISSING | PASS (API) | PASS (API) | +₹3,500 restored |
| Transactions | Transfers shown as "Money in/out" | FAIL | – | n/a | Ledger lists them as ordinary debit/credit (bug 8) |
| CSV import | Upload, row errors, duplicates | PASS | PASS | PASS (API) | Duplicates caught within file and on re-upload |
| CSV import | Required column names shown | FAIL | – | n/a | Needs `date,amount,type,...`; the first guess `transaction_type` failed every row |
| Investments | Add, list | PASS | PASS | PASS | |
| Investments | Edit/delete, SIP calculator, step-ups, trajectory | MISSING | PASS (API) | PASS (API) | Matches independent maths |
| Market quote | Stored lookup, "unavailable" with no price | PASS | PASS | PASS (API) | No live provider |
| Debt | Add, list | PASS | PASS | PASS | Credit card at 36% rejected (rate max 30%) |
| Debt | Edit/delete, amortisation, avalanche/snowball, trajectory | MISSING | PASS (API) | PASS (API) | |
| Household profile | Screen | MISSING | PASS (API) | PASS (API) | UI is a disabled preview |
| Insurance | Create, details, dashboard totals | PASS | PASS | PASS | |
| Insurance | Cover-growth rule + apply step + history | PASS | PASS | PASS | 5% of ₹1 crore = ₹5,00,000 ✓ |
| Insurance | Reminder shown and acknowledgeable | PASS | PASS | PASS | Appeared under Alerts |
| Insurance | Policy delete, claims, premiums paid | MISSING | MISSING | n/a | No endpoints |
| Outlook | Household trajectory | PASS | PASS | PASS | |
| Outlook | Investment trajectory | MISSING | PASS (API) | n/a | Page says engine doesn't exist; outdated |
| Outlook | Debt trajectory | MISSING | PASS (API) | n/a | Same |
| Outlook | Expenditure trajectory | PARTIAL | – | PASS | See above |
| Outlook | Custom trajectory | PARTIAL | – | PASS | Four flows, add/subtract/leave out; sum ₹6,24,000 = 12 × 52,000 ✓. No reorder, no CSV export |
| Outlook | Goal feasibility | PASS | PASS | PASS | See bug 5 |
| Outlook | Scenario comparison | PASS | PASS | PASS | Income-stop: 93 → 102 months late |
| Other | Advisor read + analyse | PASS | PASS | PASS | Keyword rules, labelled as not an AI model |
| Other | What-if, Fixes, Trade-offs, Compare | PASS | PASS | PARTIAL | Compare wording wrong (bug 3) |
| Other | Settings export | PARTIAL | PARTIAL | FAIL | Bug 2 |
| Other | Delete account | NOT TESTED | – | NOT TESTED | Avoided on purpose |
| Other | Hindi | PASS | – | PASS | Dashboard fully translated |
| Quality | Mobile drawer (all 13 items) | PASS | – | PASS | |
| Quality | Keyboard focus | PASS | – | PASS | Visible outline |
| Quality | Reduced motion, 3D fallback | NOT TESTED | – | NOT TESTED | In code, not exercised |

## C. Integration findings
- Working tree has 9 modified and 13 untracked backend files (Antigravity): `debt`, `household`, `investments` routers/engines/schemas, a new Alembic migration `b1a2c3d4e5f6`, CRUD extensions and tests. `contracts/openapi.json` there has 47 paths; the committed frontend types do not include the new ones.
- Not consumed by the frontend: `/debt/*`, `/household/*`, `/financials/investments/sip-calculator`, `/financials/transfers`, `PUT/DELETE` on accounts, investments, liabilities and transactions.
- The new migration applied cleanly on a fresh DB. An older local `arthayukti.db` was not tested (and not touched).
- Frontend copy now contradicts the backend ("planner has no loan model", "investment engine does not exist").
- Some rejected requests during testing were my wrong field names (`transfer_date`, `household_type: dual_income`, CSV `transaction_type`); the API behaved correctly.

## D. Financial accuracy (independent checks)
| Item | App/API | Independent | Match |
|---|---|---|---|
| Surplus | ₹55,000 | 1,20,000 − 65,000 | ✓ |
| Goal inflation, Emergency fund 24 months | ₹6,65,727.15 | 6,00,000 × (1 + 0.05/12)^25 | ✓ (see note) |
| Monthly split conservation | 2,773.87 + 35,681.33 + 16,544.80 | = 55,000.00 | ✓ |
| Net worth | ₹2,51,000 | 3,95,000 + 6,000 + 2,50,000 − 4,00,000 | ✓ |
| Account after ₹3,500 spend / delete | 3,96,500 / +3,500 | – | ✓ |
| EMI ₹5,00,000, 9%, 60 months | ₹10,379.18 | formula | ✓ |
| Same loan + ₹2,000 extra | 49 months, interest saved ₹24,879.20 | month-by-month loop | ✓ |
| SIP ₹10,000, +10%/yr, 12%, 10 yrs | final SIP ₹23,579.48, wealth ₹33,40,917.07 | loop (end-of-month deposits) | ✓ within ₹0.02 |
| SIP +₹1,000/yr | ₹19,000, ₹31,14,214.03 | loop | ✓ within ₹0.07 |
| Custom trajectory 12 months | ₹6,24,000 | 12 × 52,000 | ✓ |
| Insurance 5% step | +₹5,00,000 | 5% × 1 crore | ✓ |

Note: the frozen model compounds goal prices monthly at rate/12 and counts one extra month (25 steps for a 24-month horizon), giving an effective 5.12% a year. It matches the documented model; it is worth stating in the UI so "5%" is not read as 5% a year effective.

## E. Bugs
1. **P0/P1 — Dashboard sideways overflow at 390 px.** Steps: sign in with a plan, open `#/dashboard` at 390 px width. Expected: no horizontal scroll. Actual: page is 481 px wide; the left column and its panels run off screen. Likely cause: grid column without `min-w-0` holding a table with a 420 px minimum. Evidence: measured `scrollWidth 481 / viewport 390`.
2. **P1 — Data export is incomplete.** Steps: Settings → Download my data. Expected (per on-screen text): plan, balances, investments, loans, policies, transactions. Actual: only user, accounts, plans, policies (548 characters). Missing investments, liabilities, transactions, household profile. Cause: `/auth/export-data` builds only four sections.
3. **P1 — Compare page contradicts the plan.** Steps: with Car purchase 93 months late, open Compare. Expected: no claim of success. Actual: "Every dream is on time as it is." Cause: the "after" view shows the unchanged plan when Fixes found nothing.
4. **P1 — Existing savings are ignored by the plan.** Steps: onboarding with ₹4,00,000 savings, 6-month emergency goal. Actual: dashboard says "Set aside ₹0 / Still needed ₹6,00,000"; projections start every goal at zero. Cause: account balances are stored as records, not as goal savings; the review screen implies they are used.
5. **P1 — "Set aside each month on average" is wrong for finished goals.** Goal feasibility shows ₹1,07,673 for the Emergency fund, more than the household's ₹52,000 surplus. It is total lifetime contributions (including inflation upkeep after completion) ÷ months to deadline.
6. **P1 — Household profile API invents defaults.** With nothing saved, `GET /household/profile` returns age 30 and single earner, and risk-capacity text says "Age 30 gives a long career horizon". Also "monthly commitments" is loan EMIs only (₹12,000), so reserves read as 33.4 months of cover when real spending is about ₹68,000 (about 6 months).
7. **P2 — Dashboard header shows "Unsaved changes / Save changes" right after setup**, then "All changes saved" after a reload. Plan was already saved.
8. **P2 — Transfers appear as ordinary "Money out/in" rows** in the ledger with no transfer label; easy to read as spending and income.
9. **P2 — Goal names:** names typed in setup ("Emergency fund", "Child education") display as "Emergency money", "Children's education" in results.
10. **P2 — CSV page does not list the required columns.**
11. **Tool note:** the browser pane sometimes jumped routes on its own after reloads; I could not attribute this to the app (a Chrome session showed trusted clicks I did not send).

## F. Remaining development
- **P0 (before any public demo):** fix bug 1; reword or fix bugs 3 and 4; make export match its promise (bug 2) or change the text.
- **P1:** commit/review Antigravity's work, regenerate the API types, then build screens for household profile, debt (amortisation, avalanche/snowball, trajectory), SIP calculator and investment trajectory, account transfers, and edit/delete for accounts, investments, liabilities and transactions. Fix bugs 5 and 6. Expense add/delete/recurrence/growth in the main UI. Custom trajectory reorder and CSV export. Tax, claims, policy deletion remain absent on the backend.
- **P2:** bugs 7–10; exercise reduced-motion and the 3D fallback; test at 768/1024 px; run the new migration against an existing database.

## G. Deployment readiness
- Not yet pushed: Antigravity's migration and endpoints, so a deploy of the pushed branch lacks them.
- Needed on Render: `ALLOWED_ORIGINS`, `FRONTEND_BASE_URL`, optional `DATABASE_URL`, SMTP settings for reset mail. Vercel: `VITE_API_BASE_URL`, then redeploy.
- PostgreSQL: URL handling and the first migration compile for Postgres offline; neither has run against a real Postgres, and the new household migration has not been checked on Postgres. SMTP, Render and Vercel were not exercised.

## H. Demo verdict
Ready for a **guided, honest demo** of the planning flow (setup → dashboard → rescue/what-if/fixes/trade-offs → insurance). Not ready to present debt, SIP, household or full record management as product features until they are wired in. No completion percentage is given; only the rows above were audited.

## First-Time Signup and Financial Onboarding
Verified from the frontend code, the backend schema and live runs on an isolated database (2026-10-25). The demo household used earlier is test data only; none of it is a required field.

### 1. Signup form (what a new visitor sees)
| Field | Required | Frontend rules | Backend rules | Persisted |
|---|---|---|---|---|
| Your name | No ("Optional") | max 80 characters | `full_name`, trimmed, max 80, default empty | Yes, `users.full_name` |
| Email address | Yes | pattern check, max 254 | same pattern, lower-cased, max 254 | Yes, `users.email` |
| Password | Yes | at least 10 characters, one letter and one digit | same, plus max 72 bytes | Yes, only as a bcrypt hash |
| Type the password again | Yes | must match | not sent | No |
| Language (English/हिन्दी) | No | select | not sent | Browser `localStorage` only, not on the account |
| Consent checkbox | Yes | must be ticked | not sent | **Not stored anywhere** |

Consent wording, exactly: "I understand ArthaYukti is a planning aid, not financial advice, and that the details I enter will be stored in my account."

Mismatches and notes:
- The 72-byte password cap exists only on the server; the form has no length limit and no message for it.
- Consent is checked in the browser only. The server has no record that it was given, when, or which wording.
- Language is not part of the account, so it resets on another device.
- A duplicate address gets the same generic message as other failures ("We could not create an account with these details."). The server comment says full non-disclosure would need email verification, which does not exist.
- Live: invalid email, short password, mismatch and missing consent each blocked submission with an inline message; a valid form created the account and moved to `#/onboarding`. Only `arthayukti.session`, `arthayukti.language` and the sidebar flag were stored in the browser; the password was not.

### 2. Financial onboarding (after signup)
Ten steps: Welcome, Income, Spending, Savings, Investments, Loans, Goals, Insurance, Review, Your outlook. All are typed by the person unless marked "inferred".

| Step / field | Required | Entered or inferred | Saved where | Editable later | Used by |
|---|---|---|---|---|---|
| Income: name, amount, how often, last month | No (may be empty) | Entered; monthly figure is converted | Plan (`POST /plans`) | Amounts only, on Income & expenses | Every projection, rescue, what-if |
| Spending: name, amount, how often, essential flag | No | Entered | Plan | Amounts only | Surplus, goal funding, emergency target |
| Savings balances: name, type, balance, "can be used immediately", **keep as emergency fund** (new) | No | Entered | `financial_accounts`; the emergency flag only feeds the plan's emergency goal | Add only (no edit/delete in the UI) | Net worth; emergency-goal starting amount |
| Emergency months (default 12 shown) | Needed to get a suggestion | Default shown, editable; suggested target is **inferred** (months × essential spending + loan payments) | Not saved at all | No | Only the on-screen suggestion |
| Investments | No | Entered | `assets_investments` | Add only | Net worth only; not projected |
| Loans: name, type, owed, rate, payment, months left | No | Entered | `liabilities`; only loans with months left also become plan commitments | Add only | Net worth; plan payments |
| Goals: kind, name, amount, date, today's-money or exact, importance, already set aside | At least one goal to build a plan | Entered; importance order becomes priority 1..n | Plan | Yes, on Financial goals | Everything goal-related |
| Yearly price rise for goals (default 5%) | Yes | Default shown, editable, labelled "Default you can change" | Plan assumption | Not in a dedicated screen | Goal inflation |
| Insurance policies and "count premium as spending" | No | Entered | `insurance_policies`; premium becomes a plan expense only if ticked | Add only | Insurance pages |
| Start month of the plan | – | **Inferred**: the current month | Plan | No | All projections |

Not collected at all, though the backend now has endpoints for some: age, household type, dependants, children, parental support, future events, risk preferences. The review screen says so ("Not collected in this version"). No default is invented for these.

### 3. Live journey results
| Check | Result |
|---|---|
| Open signup as a new visitor | PASS |
| Missing/invalid fields | PASS (client-side, nothing sent) |
| Successful creation → onboarding | PASS |
| Skip optional steps | PASS for Savings, Investments, Loans ("Skip this step"). Income and Spending have no skip button but accept being left empty |
| Interrupted mid-way, then refresh | **FAIL**: typed income and spending were lost and the flow restarted at step 1; the server held 0 plans. Drafts live only in memory |
| "Save and continue later" | Appears only once a goal exists. After one goal it saved a plan whose income is the placeholder "No regular income entered" (₹0.00) and went to the dashboard |
| Resume onboarding after that | Not possible: with a saved plan the flow redirects to the dashboard, and income must then be filled in through the amounts-only edit screens |
| Persistence after refresh and logout/login | PASS for what was saved (plan and records come back); nothing unsaved is kept |

### 4. Privacy and design concerns
- No consent record on the server (see above).
- Sensitive financial details are held only in memory until saved, which is good, but it means an accidental refresh loses everything.
- The saved placeholder income can read as a real "no income" fact in the engine, which then reports shortfalls. It is labelled, but the label is lost once someone edits amounts.
- Language not stored on the account; duplicate-email handling is only partly non-disclosing.

### 5. Proposed improvements (not applied; each changes behaviour and needs your approval)
1. Send and store consent (version, timestamp) at signup. Impact: new backend field and migration.
2. Keep onboarding drafts: either `sessionStorage` (cleared when the tab closes, low risk) or a server draft (needs endpoint and privacy decision). Impact: new state handling in `Onboarding.tsx`.
3. Add the age, household and dependants step, wired to `/household/profile`. Impact: new step plus contract types.
4. Let people resume the remaining steps after "Save and continue later". Impact: routing change.
5. Show the 72-byte password limit in the form.

### 6. Expenditure Module specification
The file named in the request (`Pasted text(20261024-192105).txt`) was not found in the repository or in Downloads, Documents, Desktop or the Claude folder, so no module audit or patch was done against it. For reference only: the current app has no expenditure-specific Gemini feature (the advisor is keyword rules), and CSV import exists for the general transactions ledger, not as an expenditure-only importer. No expenditure CSV export exists yet.
