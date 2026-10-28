# ArthaYukti — Complete User Input & Financial Data Audit

> **Document Type:** System-Wide Data Inventory & Privacy Audit  
> **Repository:** ArthaYukti (`Samudra-GITHub/arthayukti`)  
> **Audit Date:** 2026-10-25  
> **Status:** Completed (Evidence-Based from Codebase Inspection)  
> **Scope:** Full Frontend (`frontend/src/`) & Full Backend (`backend/app/`)

---

## 1. Executive Summary

This document presents a comprehensive, evidence-based audit of all data collected from users across the entire ArthaYukti codebase. The audit covers every stage of user interaction: initial account creation, multi-step onboarding, optional profile and setup screens, ongoing financial record management, scenario analysis, and calculation engines.

### Key Inventory Metrics
- **Signup Fields:** 5 user inputs (Full Name, Email Address, Password, Password Confirmation, Preferred Language) + 1 Consent Checkbox.
- **Initial Onboarding Fields:** 35 field types spread across 8 wizard steps (Income streams, Expenses, Cash/Liquid accounts, Investments/Assets, Debts/Liabilities, Financial Goals, Insurance Policies, and Global Assumption toggles).
- **Later In-App & Feature Inputs:** 26 field types across transaction recording, CSV file imports, insurance escalation rules, What-If simulation shock parameters, and constraint-based financial rescue overrides.
- **Unimplemented / Disabled UI Inputs:** 12 fields (Personal age, marital arrangement, parent remittance, medical reserve, dependent children count, planned children, adult dependents, tax assessment year, regime rule, income sources breakdown, deductions override). The backend has implemented a `HouseholdProfile` and risk capacity model, but the frontend `ProfilePage` and `TaxesPage` explicitly display `<Unavailable>` placeholders with all inputs disabled.

---

## 2. Exact Signup Fields

Inspected directly in `frontend/src/pages/AuthPages.tsx` (`SignupPage`), `frontend/src/state/auth.tsx`, `backend/app/schemas/auth.py`, and `backend/app/api/auth.py`.

| Field / Concept | Exact UI Label | Collection Stage | Required? | Input Type | Validation Rules | Persisted? | Storage Location | Sent to Backend? | Browser-Only? |
|---|---|---|---|---|---|---|---|---|---|
| **Full Name** | "Name" | Signup | Optional (backend) / Suggested (UI) | Explicitly entered | `maxLength={80}`, stripped, default `""` | Yes | SQLite `users.full_name` | Yes (`full_name`) | No |
| **Email Address** | "Email" | Signup | Required | Explicitly entered | `type="email"`, regex `^[^@\s]+@[^@\s]+\.[^@\s]+$`, lowercased, stripped, unique index | Yes | SQLite `users.email` | Yes (`email`) | No |
| **Password** | "Password" | Signup | Required | Explicitly entered | `autoComplete="new-password"`, min 10 chars, max 72 chars, requires ≥1 letter and ≥1 digit | Yes (hashed) | SQLite `users.hashed_password` (Argon2 / bcrypt) | Yes (`password`) | No |
| **Confirm Password** | "Repeat password" | Signup | Required in UI | Explicitly entered | Must strictly match `password` field | No | None (ephemeral React state) | No | Yes (client validation only) |
| **Preferred Language** | Language selector (`<select>`) | Signup / Header | Optional | Selected from dropdown | Restricted to `"en"` or `"hi"` | Yes | Browser `localStorage` (`arthayukti.language`) | No | Yes (client-side only) |
| **Consent & Terms** | "I agree to the Terms of Service and Privacy Policy" | Signup | Required | Explicitly checked | Boolean checkbox must be `true` to submit | No (not in DB) | Client state only (form gate) | No | Yes |

### Authentication & Session Management Observations:
1. **Login Flow (`LoginPage`):** Collects Email ("Email") and Password ("Password"). Validates against backend `POST /api/auth/login`. Returns Bearer session token (`st_...`).
2. **Session Storage:** Token is stored in `window.sessionStorage.getItem('arthayukti.session')`. It does NOT persist across browser tab closes, providing hardened ephemeral session hygiene.
3. **Password Reset (`ForgotPasswordPage` & `ResetPasswordPage`):** 
   - Forgot Password takes Email ("Email").
   - Reset Password takes `token` (extracted from URL query param `?token=...`), "New password", and "Repeat new password".
4. **Phone Number:** **Not collected** anywhere in signup, login, profile, or backend schemas.
5. **Display Name:** Handled identically to `full_name`.

---

## 3. Initial Onboarding Fields

Inspected in `frontend/src/pages/Onboarding.tsx`, `frontend/src/pages/onboarding/Steps.tsx`, and `frontend/src/state/store.tsx`.

The onboarding wizard runs through 8 distinct steps:

### Step 1: Welcome (`welcome`)
- No data collected.
- **Explicit UI Notice:** States clearly: *"No account syncing, no bank credentials, no credit bureau pulls. ArthaYukti does not ask for your PAN, Aadhaar, or account numbers."*

### Step 2: Income Streams (`income`) — Up to 4 Streams
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Stream Label | "What is this income?" | Optional | Entered | Text, placeholder "Primary salary", max 80 chars | Yes | Plan JSON & `accounts` table |
| Amount | "Amount (₹)" | Required | Entered | Number, min ₹0, step 500, non-negative | Yes | Plan JSON (`income_streams[].amount`) |
| Frequency | Frequency selector | Required | Dropdown | `"monthly"`, `"weekly"`, `"fortnightly"`, `"quarterly"`, `"half_yearly"`, `"yearly"` (Default: `"monthly"`) | Yes | Plan JSON (`income_streams[].frequency`) |
| End Month | "Stops after (optional)" | Optional | Dropdown/Date | Format `YYYY-MM` or empty | Yes | Plan JSON (`income_streams[].ends_after`) |
| Include Toggle | "Count this income in projections" | Optional | Checkbox | Boolean (Default: `true`) | Yes | Plan JSON (`income_streams[].is_active`) |

### Step 3: Living Expenses (`expenses`) — Up to 12 Expenses
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Expense Label | "What is this expense?" | Optional | Entered / Preset | Text, presets available ("Rent", "Groceries", "Utilities") | Yes | Plan JSON (`expenses[].name`) |
| Amount | "Amount (₹)" | Required | Entered | Number, min ₹0, step 500, non-negative | Yes | Plan JSON (`expenses[].amount`) |
| Frequency | Frequency selector | Required | Dropdown | Same frequency options (Default: `"monthly"`) | Yes | Plan JSON (`expenses[].frequency`) |
| Essential Flag | "Essential (rent, food, medicine, utilities)" | Required | Checkbox | Boolean (Default: `true`) | Yes | Plan JSON (`expenses[].is_essential`) |
| Include Toggle | "Include in budget" | Optional | Checkbox | Boolean (Default: `true`) | Yes | Plan JSON (`expenses[].is_active`) |

### Step 4: Cash & Emergency Reserve (`cash`)
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Account Name | "Account label" | Optional | Entered | Text, e.g. "HDFC Salary", default "Savings" | Yes | `accounts` table (`name`) |
| Account Kind | "Type" | Required | Dropdown | `"savings"`, `"checking"`, `"fixed_deposit"`, `"wallet"`, `"other"` | Yes | `accounts.kind` |
| Balance | "Current balance (₹)" | Required | Entered | Number, min ₹0 | Yes | `accounts.balance` |
| Liquid Toggle | "Immediately accessible" | Required | Checkbox | Boolean (Default: `true`) | Yes | `accounts.is_liquid` |
| Reserve Toggle | "Earmarked for emergencies" | Required | Checkbox | Boolean (Default: `true`) | Yes | `accounts.is_emergency_reserve` |
| Target Reserve Months | "Target emergency fund (months of essentials)" | Required | Entered / Stepper | Integer, 1 to 36 months (Default: `12`) | Yes | Plan JSON (`assumptions.emergency_fund_target_months`) |

### Step 5: Investments & Assets (`assets`)
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Asset Label | "Asset label" | Optional | Entered | Text, e.g. "Nifty 50 Index", "PPF" | Yes | `investments.name` |
| Asset Kind | "Type" | Required | Dropdown | `"stock"`, `"mutual_fund"`, `"gold"`, `"real_estate"`, `"epf"`, `"ppf"`, `"crypto"`, `"other"` | Yes | `investments.kind` |
| Current Value | "Current value (₹)" | Required | Entered | Number, min ₹0 | Yes | `investments.current_value` |
| Cost Basis | "Invested amount (₹)" | Optional | Entered | Number, min ₹0, defaults to `current_value` if empty | Yes | `investments.cost_basis` |
| Valuation Date | "As of date" | Optional | Date input | Date `YYYY-MM-DD`, defaults to today | Yes | `investments.valuation_date` |
| Liquid Toggle | "Can be liquidated for goals" | Required | Checkbox | Boolean (Default: `true` for mutual funds/stocks, `false` for real estate/EPF) | Yes | `investments.is_liquid` |

### Step 6: Debts & Liabilities (`debts`)
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Liability Label | "Debt label" | Optional | Entered | Text, e.g. "Home loan SBI" | Yes | `liabilities.name` |
| Liability Kind | "Type" | Required | Dropdown | `"home_loan"`, `"personal_loan"`, `"auto_loan"`, `"education_loan"`, `"credit_card"`, `"other"` | Yes | `liabilities.kind` |
| Outstanding Principal | "Current balance (₹)" | Required | Entered | Number, min ₹0 | Yes | `liabilities.outstanding_principal` |
| Interest Rate | "Interest rate (% per year)" | Required | Entered | Number, 0.0% to 100.0% | Yes | `liabilities.interest_rate` |
| Monthly Payment | "Monthly EMI (₹)" | Required | Entered | Number, min ₹0 | Yes | `liabilities.minimum_payment` |
| Remaining Tenure | "Months left" | Optional | Entered | Integer months | Yes | `liabilities.remaining_tenure_months` |

### Step 7: Goals (`goals`) — Up to 8 Goals
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Goal Category | "What are you saving for?" | Required | Dropdown | `"emergency_fund"`, `"education"`, `"home"`, `"vehicle"`, `"wedding"`, `"travel"`, `"family"`, `"retirement"`, `"business"`, `"other"` | Yes | Plan JSON (`goals[].kind`) |
| Goal Label | "Goal label" | Optional | Entered | Text, defaults to category name | Yes | Plan JSON (`goals[].name`) |
| Target Amount | "Target amount (₹)" | Required | Entered | Number, min ₹0 | Yes | Plan JSON (`goals[].target_amount`) |
| Target Date | "Target date" | Required | Month input | `YYYY-MM`, must be a future or current month | Yes | Plan JSON (`goals[].target_date`) |
| Cost Basis | "Cost basis" | Required | Radio / Toggle | `'today'` (inflation applied) vs `'future'` (fixed nominal) | Yes | Plan JSON (`goals[].basis`) |
| Priority Tier | "Priority tier" | Required | Radio / Select | 1 (Essential) to 5 (Aspirational). Default: 2 | Yes | Plan JSON (`goals[].tier`) |
| Saved So Far | "Already saved towards this (₹)" | Optional | Entered | Number, min ₹0 (Default: `0`) | Yes | Plan JSON (`goals[].saved_so_far`) |
| Inflation Assumption | "General annual inflation (%)" | Required | Entered | Number, 0% to 25% (Default: `5.0%`) | Yes | Plan JSON (`assumptions.inflation_rate`) |

### Step 8: Insurance Policies (`insurance`)
| Field | Exact UI Label | Required? | Input Type | Validation & Rules | Persisted? | Storage Location |
|---|---|---|---|---|---|---|
| Policy Kind | "Policy type" | Required | Dropdown | `"term_life"`, `"health"`, `"ulip"`, `"endowment_money_back"`, `"motor"`, `"home"` | Yes | `insurance_policies.kind` |
| Insurer Name | "Insurer" | Optional | Entered | Text, e.g. "HDFC Life", "Max Life" | Yes | `insurance_policies.insurer_name` |
| Policy Label | "Policy name" | Optional | Entered | Text | Yes | `insurance_policies.plan_name` |
| Policy Reference | "Policy number / reference" | Optional | Entered | Text (Default: `""`) | Yes | `insurance_policies.policy_number` |
| Sum Assured | "Sum assured / coverage (₹)" | Required | Entered | Number, min ₹0 | Yes | `insurance_policies.sum_assured` |
| Annual Premium | "Annual premium (₹)" | Required | Entered | Number, min ₹0 | Yes | `insurance_policies.annual_premium` |
| Start Date | "Policy start date" | Optional | Date input | Date `YYYY-MM-DD` | Yes | `insurance_policies.start_date` |
| Count in Spending | "Include premium in living expenses" | Required | Checkbox | Boolean (Default: `true`) | Yes | Plan JSON / Policy record |

---

## 4. Personal Profile & Household Fields

### Implemented vs. Unimplemented State

| Field / Concept | Frontend UI Status | Backend API Status | Source Code Reference | Actual Classification |
|---|---|---|---|---|
| **Age / Date of Birth** | UI disabled (`<Unavailable>`) | Implemented (`HouseholdProfile.user_age`) | `frontend/src/pages/app/Tools.tsx:ProfilePage`, `backend/app/schemas/household.py` | **Unimplemented in UI / Inferred/Defaulted in engine (default: 30)** |
| **Marital Status / Living Arrangement** | UI disabled (`<Unavailable>`) | Implemented (`HouseholdProfile.arrangement`) | `frontend/src/pages/app/Tools.tsx:ProfilePage`, `backend/app/schemas/household.py` | **Unimplemented in UI (default: "single")** |
| **Number of Earners** | UI disabled (`<Unavailable>`) | Implemented (`HouseholdProfile.earners_count`) | `backend/app/schemas/household.py` | **Defaulted to 1** |
| **Parents & Support Remittances** | UI disabled (`<Unavailable>`) | Implemented (`parents_financially_dependent`, `elderly_care_budget`) | `frontend/src/pages/app/Tools.tsx`, `backend/app/schemas/household.py` | **Unimplemented in UI / Defaults to false / 0** |
| **Dependant Children (Count & Ages)** | UI disabled (`<Unavailable>`) | Implemented (`children_count`, `child_ages: List[int]`) | `frontend/src/pages/app/Tools.tsx`, `backend/app/schemas/household.py` | **Unimplemented in UI / Defaulted to empty list** |
| **Planned Children in Future** | UI disabled (`<Unavailable>`) | Implemented (`planned_children_count`, `next_child_due_years`) | `frontend/src/pages/app/Tools.tsx`, `backend/app/schemas/household.py` | **Unimplemented in UI / Defaulted to 0 / None** |
| **Adult Dependents** | UI disabled (`<Unavailable>`) | Implemented (`adult_dependents_count`) | `backend/app/schemas/household.py` | **Unimplemented in UI / Defaulted to 0** |
| **Medical / Chronic Budget** | UI disabled (`<Unavailable>`) | Implemented (`monthly_medical_burden`) | `frontend/src/pages/app/Tools.tsx`, `backend/app/schemas/household.py` | **Unimplemented in UI / Defaulted to 0** |
| **Risk Capacity / Risk Tolerance** | No user slider | Calculated & Inferred | `backend/app/api/household.py:compute_risk_capacity` | **Calculated from savings, debt, dependents** |
| **Future Life Milestones** | Goals wizard step | Implemented | `frontend/src/pages/onboarding/Steps.tsx` | **User-entered as Goals** |

*Evidence from `frontend/src/pages/app/Tools.tsx`:*
```tsx
export function ProfilePage() {
  const { t } = useI18n();
  return (
    <div className="profile-page">
      <Unavailable title={t('tools.profile.unavailableTitle')} />
      <fieldset disabled>
        {/* Rendered inputs for Age, Arrangement, Parents, Medical, Children, Planned, Dependants */}
      </fieldset>
    </div>
  );
}
```
*Finding:* Although the backend has complete schema models and a `/api/household/profile` REST endpoint, the frontend deliberately renders these controls wrapped inside `<fieldset disabled>` and shows an informative banner informing the user that household profiling is not yet activated in the user interface.

---

## 5. Complete Financial Input Inventory

### Master Comprehensive Table

| Data field | UI label | Collection stage | Required? | Input Classification | Validation | Persisted? | Storage location | Used by calculations |
|---|---|---|---|---|---|---|---|---|
| **income.name** | "What is this income?" | Onboarding / Setup | Optional | User-entered | Text <= 80 chars | Yes | `plans.income_streams.name` | Dashboard labels |
| **income.amount** | "Amount (₹)" | Onboarding / Setup | Required | User-entered | Float >= 0 | Yes | `plans.income_streams.amount` | Surplus, Projections, Rescue |
| **income.frequency** | Frequency | Onboarding / Setup | Required | Selected (dropdown) | 6 valid enum values | Yes | `plans.income_streams.frequency` | Monthly normalized cashflow |
| **income.ends_after** | "Stops after" | Onboarding / Setup | Optional | User-entered | YYYY-MM or null | Yes | `plans.income_streams.ends_after` | Multi-year projections |
| **income.is_active** | "Count this income" | Onboarding / Setup | Optional | Selected (toggle) | Boolean | Yes | `plans.income_streams.is_active` | Cashflow inclusion |
| **expense.name** | "What is this expense?"| Onboarding / Setup | Optional | User-entered / Preset | Text <= 80 chars | Yes | `plans.expenses.name` | Breakdown display |
| **expense.amount** | "Amount (₹)" | Onboarding / Setup | Required | User-entered | Float >= 0 | Yes | `plans.expenses.amount` | Surplus, Emergency target |
| **expense.frequency** | Frequency | Onboarding / Setup | Required | Selected (dropdown) | 6 valid enum values | Yes | `plans.expenses.frequency` | Monthly normalized expenses |
| **expense.is_essential**| "Essential" | Onboarding / Setup | Required | Selected (toggle) | Boolean | Yes | `plans.expenses.is_essential` | Emergency reserve adequacy |
| **expense.is_active** | "Include in budget" | Onboarding / Setup | Optional | Selected (toggle) | Boolean | Yes | `plans.expenses.is_active` | Cashflow inclusion |
| **account.name** | "Account label" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `accounts.name` | Account balances |
| **account.kind** | "Type" | Onboarding / Records | Required | Selected (dropdown) | savings, checking, fd, etc. | Yes | `accounts.kind` | Asset liquidity classification |
| **account.balance** | "Current balance (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `accounts.balance` | Net worth, Emergency reserve |
| **account.is_liquid** | "Immediately accessible"| Onboarding / Records | Required | Selected (toggle) | Boolean | Yes | `accounts.is_liquid` | Liquid emergency calculation |
| **account.is_emergency**| "Earmarked for reserve"| Onboarding / Records | Required | Selected (toggle) | Boolean | Yes | `accounts.is_emergency_reserve`| Dedicated emergency reserve |
| **target_reserve_months**| "Target emergency fund"| Onboarding / Settings| Required | User-entered / Default | Integer 1..36 (default 12) | Yes | `plans.assumptions.emergency_target`| Emergency fund gap |
| **investment.name** | "Asset label" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `investments.name` | Portfolio holdings |
| **investment.kind** | "Type" | Onboarding / Records | Required | Selected (dropdown) | stock, mf, gold, re, epf, etc.| Yes | `investments.kind` | Expected return mapping |
| **investment.current_val**| "Current value (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `investments.current_value` | Net worth, Asset allocation |
| **investment.cost_basis**| "Invested amount (₹)" | Onboarding / Records | Optional | User-entered / Default | Float >= 0 (default = value) | Yes | `investments.cost_basis` | Unrealized gain / loss |
| **investment.valuation_date**| "As of date" | Onboarding / Records | Optional | User-entered / Default | YYYY-MM-DD (default = today)| Yes | `investments.valuation_date` | Stale valuation detection |
| **investment.is_liquid**| "Can be liquidated" | Onboarding / Records | Required | Selected (toggle) | Boolean | Yes | `investments.is_liquid` | Rescue & Tradeoff liquidation |
| **liability.name** | "Debt label" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `liabilities.name` | Debt overview |
| **liability.kind** | "Type" | Onboarding / Records | Required | Selected (dropdown) | home, personal, auto, cc, etc.| Yes | `liabilities.kind` | Interest rate benchmarks |
| **liability.principal**| "Current balance (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `liabilities.outstanding_principal`| Net worth, Debt-to-income |
| **liability.rate** | "Interest rate (%)" | Onboarding / Records | Required | User-entered | Float 0.0..100.0 | Yes | `liabilities.interest_rate` | Amortization, Snowball/Avalanche |
| **liability.payment** | "Monthly EMI (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `liabilities.minimum_payment` | Monthly surplus, DTI ratio |
| **liability.tenure** | "Months left" | Onboarding / Records | Optional | User-entered | Integer >= 0 | Yes | `liabilities.remaining_tenure` | Amortization timeline |
| **goal.kind** | "Category" | Onboarding / Setup | Required | Selected (dropdown) | 10 goal kinds | Yes | `plans.goals.kind` | Milestone categorization |
| **goal.name** | "Goal label" | Onboarding / Setup | Optional | User-entered / Default | Text <= 80 chars | Yes | `plans.goals.name` | Goal timeline visualization |
| **goal.target_amount**| "Target amount (₹)" | Onboarding / Setup | Required | User-entered | Float >= 0 | Yes | `plans.goals.target_amount` | Goal feasibility & required SIP |
| **goal.target_date** | "Target date" | Onboarding / Setup | Required | User-entered | YYYY-MM | Yes | `plans.goals.target_date` | Timeline horizon |
| **goal.basis** | "Cost basis" | Onboarding / Setup | Required | Selected (radio) | 'today' vs 'future' | Yes | `plans.goals.basis` | Inflation adjustment engine |
| **goal.tier** | "Priority tier" | Onboarding / Setup | Required | Selected (radio) | Integer 1..5 (default 2) | Yes | `plans.goals.tier` | Tradeoff & triage algorithm |
| **goal.saved_so_far** | "Already saved (₹)" | Onboarding / Setup | Optional | User-entered / Default | Float >= 0 (default 0) | Yes | `plans.goals.saved_so_far` | Remaining target gap |
| **global_inflation** | "Inflation (%)" | Onboarding / Setup | Required | User-entered / Default | Float 0.0..25.0 (default 5.0) | Yes | `plans.assumptions.inflation_rate` | Future cost compounding |
| **policy.kind** | "Policy type" | Onboarding / Records | Required | Selected (dropdown) | term, health, ulip, motor, etc.| Yes | `insurance_policies.kind` | Coverage gap analysis |
| **policy.insurer** | "Insurer" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `insurance_policies.insurer_name`| Insurance schedule |
| **policy.plan_name** | "Policy name" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `insurance_policies.plan_name` | Policy inventory |
| **policy.policy_number**| "Policy reference" | Onboarding / Records | Optional | User-entered | Text <= 100 chars | Yes | `insurance_policies.policy_number`| Reference |
| **policy.sum_assured**| "Sum assured (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `insurance_policies.sum_assured` | Life/Health coverage adequacy |
| **policy.premium** | "Annual premium (₹)" | Onboarding / Records | Required | User-entered | Float >= 0 | Yes | `insurance_policies.annual_premium`| Monthly spending allocation |
| **policy.start_date** | "Policy start date" | Onboarding / Records | Optional | User-entered | YYYY-MM-DD | Yes | `insurance_policies.start_date` | Policy age |
| **cover_escalation** | "Escalation rate/amount"| Later (app/Cover.tsx)| Optional | User-entered | rate % or fixed step ₹ | Yes | `insurance_escalation_rules` | Multi-year coverage projections |
| **transaction.date** | "Date" | Later (app/Tools.tsx)| Required | User-entered / Default | YYYY-MM-DD (default today) | Yes | `transactions.date` | Cashflow tracking |
| **transaction.amount**| "Amount (₹)" | Later (app/Tools.tsx)| Required | User-entered | Float > 0 | Yes | `transactions.amount` | Monthly spending breakdown |
| **transaction.kind** | "Type" | Later (app/Tools.tsx)| Required | Selected (dropdown) | debit, credit | Yes | `transactions.kind` | Income vs expense auditing |
| **transaction.category**| "Category" | Later (app/Tools.tsx)| Required | Selected (dropdown) | Groceries, Rent, Utilities, etc.| Yes | `transactions.category` | Expense breakdown |
| **transaction.account**| "Account" | Later (app/Tools.tsx)| Required | Selected (dropdown) | Foreign key to `accounts` | Yes | `transactions.account_id` | Account balance update |
| **csv_import_file** | "Choose CSV file" | Later (app/Tools.tsx)| Optional | File upload | Max 1 MB, CSV text | No (raw) / Yes (parsed)| Stored as parsed `transactions` | Ledger reconciliations |
| **what_if_scenario** | Scenario choice | Later (WhatIf.tsx) | Required | Selected (radio) | normal, no_income, expense | No | Session / Query state | Real-time trajectory re-calc |
| **what_if_shock_amt**| "Shock amount (₹)" | Later (WhatIf.tsx) | Optional | User-entered | Float >= 0 | No | Ephemeral React state | Trajectory shock delta |
| **rescue_avoid_debt** | "Avoid new debt" | Later (Rescue.tsx) | Optional | Selected (toggle) | Boolean (default true) | No | Query parameter payload | Rescue optimization engine |
| **rescue_min_reserve**| "Min emergency reserve"| Later (Rescue.tsx) | Optional | User-entered / Default | Float >= 0 | No | Query parameter payload | Liquid cash preservation limit |
| **rescue_max_delay** | "Max goal delay months"| Later (Rescue.tsx) | Optional | User-entered / Default | Integer 0..120 (default 24) | No | Query parameter payload | Goal rescheduling horizon |
| **rescue_cut_pct** | "Discretionary spending cut"| Later (Rescue.tsx) | Optional | User-entered / Default | Float 0..100% (default 20%) | No | Query parameter payload | Expense austerity solver |
| **rescue_asset_sale** | "Allow asset sale" | Later (Rescue.tsx) | Optional | Selected (toggle) | Boolean (default false) | No | Query parameter payload | Capital reallocation solver |

---

## 6. Calculation-to-Input Dependency Matrix

Every major calculation engine was audited in `backend/app/engine/`:

### 1. Monthly Surplus or Deficit
- **Formula:** $\text{Surplus} = \sum(\text{Active Monthly Income}) - \sum(\text{Active Monthly Expenses}) - \sum(\text{Monthly EMIs}) - \sum(\text{Monthly Insurance Premiums})$
- **Required Inputs:** `income.amount`, `income.frequency`, `expense.amount`, `expense.frequency`
- **Optional Inputs:** `liabilities.minimum_payment`, `insurance_policies.annual_premium`
- **Defaults / Assumptions:** Missing frequency defaults to `"monthly"`. Excluded streams (`is_active = false`) are zeroed.
- **Output:** Net monthly free cashflow (₹), Savings rate (%).

### 2. Net Worth
- **Formula:** $\text{Net Worth} = \sum(\text{Account Balances}) + \sum(\text{Investment Values}) - \sum(\text{Outstanding Debt Principals})$
- **Required Inputs:** `accounts.balance`, `investments.current_value`, `liabilities.outstanding_principal`
- **Optional Inputs:** None.
- **Defaults / Assumptions:** If user has no entries, default is ₹0.
- **Output:** Total Net Worth, Total Assets, Total Liabilities, Liquid Net Worth.

### 3. Emergency Fund Adequacy & Runway
- **Formula:** $\text{Monthly Essentials} = \sum(\text{Essential Expenses}) + \sum(\text{Debt EMIs}) + \sum(\text{Monthly Insurance})$.  
  $\text{Adequacy Months} = \frac{\sum(\text{Liquid Cash Balances})}{\text{Monthly Essentials}}$.
- **Required Inputs:** `expense.amount`, `expense.is_essential`, `account.balance`, `account.is_liquid`
- **Optional Inputs:** `assumptions.emergency_fund_target_months` (Default: 12 months)
- **Defaults / Assumptions:** If no expenses are flagged essential, silently treats ALL active expenses as essential. Default emergency fund target is 12 months.
- **Output:** Current emergency reserve (₹), Target emergency reserve (₹), Gap (₹), Months of runway.

### 4. Goal Feasibility, Delay, & Required Monthly Savings
- **Formula:** Compounded target using future inflation:  
  $\text{Future Cost} = \text{Target Amount} \times (1 + \text{Inflation})^{\Delta \text{years}}$ (if `basis == 'today'`).  
  Required monthly SIP computed using future value annuity formula assuming investment return $r$.
- **Required Inputs:** `goal.target_amount`, `goal.target_date`, `goal.basis`
- **Optional Inputs:** `goal.saved_so_far`, `assumptions.inflation_rate` (Default: 5.0%), Expected ROI (Default: 8.0% p.a.)
- **Defaults / Assumptions:** Assumes constant 5.0% inflation and 8.0% conservative blended return if unspecified.
- **Output:** Status (`on_track`, `at_risk`, `unfunded`), Required Monthly Contribution (₹), Projected Shortfall (₹), Feasible Completion Date.

### 5. Loan Amortization & Repayment Strategy (Snowball vs. Avalanche)
- **Engine:** `backend/app/engine/debt.py`
- **Required Inputs:** `liabilities.outstanding_principal`, `liabilities.interest_rate`, `liabilities.minimum_payment`
- **Optional Inputs:** Extra monthly prepayment budget (₹)
- **Defaults / Assumptions:** Standard compound monthly amortization. Minimum payments must cover monthly interest or error is flagged.
- **Output:** Baseline payoff date and total interest; Snowball vs. Avalanche comparison (interest saved, months saved, payoff schedule).

### 6. Constraint-Aware Financial Rescue
- **Engine:** `backend/app/engine/rescue.py`
- **Required Inputs:** Full user plan (incomes, expenses, cash, debts, goals).
- **Optional Overrides:** `avoid_new_debt` (default True), `min_emergency_reserve` (default 3 months), `max_delay_months` (default 24), `allow_discretionary_cut_pct` (default 20%), `allow_asset_sale` (default False).
- **Defaults / Assumptions:** Triage priority strictly obeys Goal Tiers (Tier 1 protected first; Tier 5 delayed or dropped first).
- **Output:** Step-by-step remediation actions, recovered monthly cashflow, goal schedule adjustments.

### 7. What-If Scenario Simulations
- **Engine:** `backend/app/engine/fixes.py` & `frontend/src/pages/WhatIf.tsx`
- **Required Inputs:** Baseline plan.
- **Scenario Options:** `no_income` (simulates total income loss for $N$ months), `expense` (applies custom one-off shock ₹).
- **Defaults / Assumptions:** Emergency fund absorbs shocks first; if exhausted, flags deficit month and debt risk.
- **Output:** Comparative delta trajectory, cash depletion month, shortfall magnitude.

### 8. Household Risk Capacity
- **Engine:** `backend/app/api/household.py`
- **Required Inputs:** `HouseholdProfile` (or inferred defaults from plan data).
- **Defaults / Assumptions:** User age = 30; dependants = 0; earners = 1; arrangement = single.
- **Output:** Risk capacity score (0–100) and risk tier (`conservative`, `moderate`, `aggressive`).

---

## 7. Data Persistence & Storage Locations

| Information Category | Frontend Entry Component | Backend API Endpoint | Database Table & Columns | Persists Across Session? | Browser Storage Mechanism |
|---|---|---|---|---|---|
| **User Identity & Auth** | `AuthPages.tsx:SignupPage` | `POST /api/auth/signup` | `users` (`id`, `email`, `hashed_password`, `full_name`, `created_at`) | Yes | None (Credentials not stored) |
| **Session Authentication Token** | `AuthPages.tsx:LoginPage` | `POST /api/auth/login` | Ephemeral verification | No (cleared on tab close) | `sessionStorage` (`arthayukti.session`) |
| **Language Preference** | Language Selector | Client-side only | None (Frontend only) | Yes | `localStorage` (`arthayukti.language`) |
| **Master Financial Plan** | `Onboarding.tsx`, `Setup.tsx` | `POST /api/plans`, `PUT /api/plans/{id}` | `plans` (`id`, `user_id`, `version`, `plan_data` [JSON]) | Yes | In-memory React state + DB |
| **Bank & Cash Accounts** | `Onboarding.tsx`, `Records.tsx` | `POST /api/financials/accounts` | `accounts` (`id`, `user_id`, `name`, `kind`, `balance`, `is_liquid`, `is_emergency_reserve`) | Yes | In-memory React state + DB |
| **Investments & Holdings** | `Onboarding.tsx`, `Records.tsx` | `POST /api/financials/investments` | `investments` (`id`, `user_id`, `name`, `kind`, `current_value`, `cost_basis`, `valuation_date`, `is_liquid`) | Yes | In-memory React state + DB |
| **Debts & Loans** | `Onboarding.tsx`, `Records.tsx` | `POST /api/financials/liabilities` | `liabilities` (`id`, `user_id`, `name`, `kind`, `outstanding_principal`, `interest_rate`, `minimum_payment`, `remaining_tenure_months`) | Yes | In-memory React state + DB |
| **Insurance Policies** | `Onboarding.tsx`, `Records.tsx` | `POST /api/financials/insurance` | `insurance_policies` (`id`, `user_id`, `kind`, `insurer_name`, `plan_name`, `policy_number`, `sum_assured`, `annual_premium`, `start_date`) | Yes | In-memory React state + DB |
| **Coverage Escalation Rules**| `Cover.tsx` | `POST /api/financials/insurance/{id}/rules` | `insurance_escalation_rules` (`id`, `policy_id`, `escalation_type`, `frequency`, `rate`, `amount`, `first_date`) | Yes | In-memory React state + DB |
| **Daily Transactions** | `Tools.tsx:TransactionForm` | `POST /api/financials/transactions` | `transactions` (`id`, `user_id`, `account_id`, `date`, `amount`, `category`, `kind`, `description`, `is_essential`) | Yes | In-memory React state + DB |
| **Household Profile** | `Tools.tsx:ProfilePage` (Disabled) | `POST /api/household/profile` | `household_profiles` (`user_id`, `user_age`, `arrangement`, `children_count`, etc.) | Yes (Backend ready) | None |
| **Export / Download** | `Tools.tsx:SettingsPage` | `GET /api/auth/export` | Reads all user tables | Ephemeral JSON | Direct browser download |

---

## 8. Automatically Calculated, Inferred and Defaulted Values

1. **Monthly Normalized Amounts:** The application converts weekly ($\times 52 / 12$), fortnightly ($\times 26 / 12$), quarterly ($/ 3$), half-yearly ($/ 6$), and yearly ($/ 12$) inputs into standardized monthly figures.
2. **Investment Expected Annual Growth:** If user does not specify growth rates, the engine assumes:
   - Equity / Mutual Funds: 11.0% p.a.
   - Fixed Deposits / PPF / EPF: 7.0% p.a.
   - Gold: 6.0% p.a.
   - Real Estate: 7.0% p.a.
   - Crypto: 10.0% p.a.
   - Cash / Savings: 3.5% p.a.
3. **Emergency Fund Target Months:** Defaulted to **12 months** of essential spending if omitted.
4. **General Annual Inflation Rate:** Defaulted to **5.0%** compound annual inflation if omitted.
5. **Cost Basis of Assets:** Defaults to `current_value` if user leaves the invested amount blank.
6. **Valuation Date:** Defaults to current system date `YYYY-MM-DD` if omitted.
7. **Goal Priority Tier:** Defaults to **Tier 2** (Important) if omitted.
8. **Goal Basis:** Defaults to `'today'` (inflation adjustment applied).
9. **Household Age & Demographics:** Silently defaulted by backend calculation engines to **Age 30**, **Single**, **0 Dependants**, **1 Earner** when running risk capacity models if the user has not completed the household profile.

---

## 9. Missing, Inconsistent or Non-Persisted Inputs

1. **Signup Consent Checkbox:** The UI requires checking the "Terms and Privacy Policy" agreement, but this acceptance timestamp/version is **not stored in the database**. It acts only as a client-side form submission gate.
2. **Language Preference:** Selected language (`"en"` vs `"hi"`) is stored only in the browser's `localStorage` (`arthayukti.language`) and is **never sent to the backend**, meaning it does not sync across different user devices or browsers.
3. **What-If Scenario Shocks:** Parameters entered in `WhatIf.tsx` (shock amounts, scenario selections) are held strictly in React component state; they are **not persisted** across page reloads.
4. **Rescue Solver Overrides:** Overrides entered in `Rescue.tsx` (e.g. `min_emergency_reserve`, `max_delay_months`) are sent as query parameters to `/api/plans/{id}/rescue` for on-the-fly computation and are **not saved** to the user's permanent plan.
5. **Frontend/Backend Disconnect on Household Profile:** The backend possesses complete models, schemas, and endpoints for household data (`household_profiles`), but the frontend `ProfilePage` disables all inputs with an `<Unavailable>` banner.
6. **Taxes Module:** Both frontend and backend lack tax engine integration. The frontend displays an `<Unavailable>` screen with non-functional form controls.

---

## 10. Privacy & External-Service Observations

1. **Zero External Financial Trackers:** No telemetry, third-party analytics (Google Analytics, Mixpanel, etc.), or external advertising scripts exist in `frontend/index.html` or package manifests.
2. **No Bank Aggregators / Account Aggregator (AA):** No integrations with Setu, OneMoney, Plaid, or Yodlee. All financial data is 100% self-declared or imported via local CSV files.
3. **AI Advisor Flow (`/api/advisor/ask`):**
   - Natural language queries sent to the advisor pass through local rule-based intent parsing (`backend/app/engine/advisor.py`).
   - If an optional LLM provider is configured in environment variables, queries are evaluated using context prompts; if unconfigured, it seamlessly falls back to the deterministic local rule engine without exposing user data to third parties.
4. **Data Portability & Right to Erasure:**
   - Full JSON export available via `GET /api/auth/export` (`SettingsPage`).
   - Complete GDPR/DPDP-compliant account deletion implemented via `DELETE /api/auth/account`, which cascades and hard-deletes all records across all SQLite tables.

---

## 11. Recommended Corrections

1. **Persist Consent & Terms Acceptance:** Add `terms_accepted_at: datetime` and `privacy_policy_version: str` columns to the `users` database table to record regulatory audit proof of consent under India's Digital Personal Data Protection (DPDP) Act.
2. **Sync Language Preference:** Add a `locale: str` column to `users` so that user language preferences follow their account across devices instead of residing solely in local browser storage.
3. **Activate Household Profile in Frontend:** Wire the inputs in `frontend/src/pages/app/Tools.tsx` (`ProfilePage`) to the existing backend `POST /api/household/profile` endpoint so that risk capacity and dependency calculations consume actual user demographics rather than default fallback values (Age 30, Single, 0 Dependents).
4. **Remove or Complete Disabled Tax Controls:** Replace the disabled inputs on `TaxesPage` with a clear "Feature Roadmap" notification to prevent user confusion regarding non-functional inputs.
5. **Explicit Indication of Inferred Demographics:** Display an explanatory note in the Risk Capacity view indicating whenever fallback values are being used due to an incomplete profile.

---

## 12. Source-Code Evidence & Audit Trace

The findings in this report are corroborated by the following files and symbols in the ArthaYukti repository:

- **Authentication & Signup:**
  - `frontend/src/pages/AuthPages.tsx` — Lines 110–265: `SignupPage`, `LoginPage`, `ForgotPasswordPage`
  - `frontend/src/pages/ResetPassword.tsx` — Lines 1–90: Token query extraction & password updates
  - `frontend/src/state/auth.tsx` — Lines 1–110: `sessionStorage` session token handling
  - `backend/app/schemas/auth.py` — Lines 1–75: `SignupRequest`, `LoginRequest`, `PasswordResetRequest`
  - `backend/app/api/auth.py` — Lines 1–250: Argon2/bcrypt password hashing, user registration, deletion
  - `backend/app/models/user.py` — Lines 1–50: `User` SQLAlchemy model definition

- **Onboarding Flow:**
  - `frontend/src/pages/Onboarding.tsx` — Lines 1–280: Wizard step management & batch record commit
  - `frontend/src/pages/onboarding/Steps.tsx` — Lines 1–650: Form inputs for income, expenses, cash, assets, debts, goals, insurance
  - `frontend/src/state/store.tsx` — Lines 1–320: Plan persistence, local storage language key

- **Financial Schemas & Endpoints:**
  - `backend/app/schemas/financials.py` — Lines 1–210: Pydantic schemas for `Account`, `Investment`, `Liability`, `InsurancePolicy`, `Transaction`
  - `backend/app/api/financials.py` — Lines 1–480: CRUD operations and CSV import handler
  - `backend/app/schemas/plan.py` — Lines 1–130: `Plan`, `IncomeStream`, `Expense`, `Goal`, `Assumptions`
  - `backend/app/api/plans.py` — Lines 1–220: Plan generation, updates, scenario endpoints

- **Calculation & Engine Logic:**
  - `backend/app/engine/projection.py` — Multi-year cashflow, inflation, surplus/deficit
  - `backend/app/engine/debt.py` — Amortization, Snowball and Avalanche payoff strategies
  - `backend/app/engine/rescue.py` — Constraint-driven financial rescue & triage solver
  - `backend/app/engine/fixes.py` & `tradeoffs.py` — What-If scenario evaluation and goal trade-off ranking
  - `backend/app/schemas/household.py` & `backend/app/api/household.py` — Demographics and risk capacity engine

- **In-App Tools & Profile Pages:**
  - `frontend/src/pages/app/Tools.tsx` — Lines 120–290: Transaction entry, Settings, `<ProfilePage>` disabled fieldset, `<TaxesPage>` disabled fieldset
  - `frontend/src/pages/app/Cover.tsx` — Lines 1–210: Insurance policy escalation rules
  - `frontend/src/pages/app/Rescue.tsx` — Lines 1–240: Rescue constraint override form
  - `frontend/src/pages/WhatIf.tsx` — Lines 1–180: Real-time simulation parameter inputs
