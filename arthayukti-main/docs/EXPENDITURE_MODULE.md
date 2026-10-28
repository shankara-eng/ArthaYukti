# Expenditure module and the inflation precedence

Planned spending, line by line. It mirrors the Income module (`docs/INCOME_MODULE.md`) and feeds the same monthly engine, so
the surplus, goals, scenarios, Financial Outlook and the emergency-fund essentials all read one set of numbers.

## A spending line

| Field | Meaning |
| --- | --- |
| `label`, `category` (optional) | What it is and an optional grouping |
| `essential` | Counted as essential spending (emergency-fund essentials, the rescue engine's protected set) |
| `monthly` | The monthly equivalent. For a plain line it is the entered amount. For a scheduled line it is derived from `amount` and `frequency` and any value sent is replaced |
| `amount`, `frequency` (`monthly`, `quarterly`, `yearly`; absent means monthly) | Used when the line is scheduled |
| `start_month`, `end_month` | Optional, both inclusive. `end_month` blank means ongoing. A scheduled line needs a `start_month`; the editor fills in the plan's first month when the person gives none |
| `annual_growth` | This line's own yearly growth, −10% to 30%. Blank means use the plan-wide rate |

A plain line (only `monthly`) behaves exactly as it did before this module existed. The engine golden tests pass unchanged.

## Conventions

- **Frequency normalisation.** A scheduled amount is spread evenly: ÷1, ÷3 or ÷12 per month, not rounded. Each projected month is rounded once, half-up to the paisa, after growth. A quarterly or yearly bill is therefore *not* shown as one lump in the month it falls due; this is disclosed on the page. Rounding example: ₹100 a year is ₹8.3333… a month, 12 × ₹8.33 = ₹99.96 (tested).
- **Active window.** Start and end months are inclusive. Months before the plan's first month are never projected, so the first calendar year can be partial; a horizon that ends mid-year only counts the months inside it. Leap years do not matter: the model is monthly.
- **Growth.** One step every 12 months, counted from the later of the line's start month and the plan's first month (an annual step, not monthly compounding). A line that began before the plan starts steps 12 months after the *plan* starts.
- **Amount timing.** The entered amount is what is paid from the later of the start month and the plan's first month.
- **Temporary vs permanent.** A bounded line (`end_month`) is temporary; no end month is ongoing. Scenario spending changes (a fixed amount added or removed over a window) are separate and unchanged.
- **Reconciliation.** The yearly totals come from the engine's own monthly spending. The per-line figures use the same monthly amounts rounded the same way, so with no scenario change they add up to the yearly totals exactly (tested against `project()`).

## Inflation and growth: precedence

There are four places an inflation-like rate can apply. They never stack on the same quantity.

| Applies to | Rate used, highest precedence first | Where it comes from |
| --- | --- | --- |
| A goal's target | the goal's `inflation_rate_override` → the plan's `general_inflation_annual` (only when the goal is `inflation_linked`) | A new plan starts with the person's **Default Inflation Rate** (Settings; 5% until they set their own). Onboarding shows 5% and lets them edit it |
| A spending line | the line's `annual_growth` → the plan's `expense_growth_annual` | `expense_growth_annual` is explicit and starts at 0. The person can type a rate or press "Use my default inflation" on the Expenditures panel |
| A new investment in the calculators | the investment's own inflation field | Starts from the Default Inflation Rate; each investment can override it |
| Plan B | none | Plan B models no inflation, returns, borrowing or sales |

Changing the Default Inflation Rate changes the starting value of **new** plans and **new** investments only. Saved plans, saved
calculator scenarios and Recovery Agreements keep the rate they were saved with. "Apply to my current plan" (Settings) writes the
rate into the plan on screen and nothing is saved until the person chooses Save changes. Inflation is never applied twice to one
projection: a goal is inflated once (its own rate or the plan rate), a spending line grows once (its own rate or the plan rate).

### The 6% question (a recorded conflict)

The audit brief refers to a "default expenditure inflation of 6% as specified in the master requirements". The master specification
in this repository (`docs/spec/ArthaYukti_Master_Specification.txt`, section 4.3) says the opposite: *do not silently apply a default
expenditure inflation rate; if a setup default is required, label it and let the user choose before a projection is treated as
complete*. An "Expenditure module" specification that the earlier status report says was never found may contain the 6%. Until
that is supplied, spending growth starts at an explicit 0% that the person can see and change, and nothing is applied silently.
To make 6% the suggested value, the person sets their Default Inflation Rate to 6 and presses "Use my default inflation"; making it
a pre-filled starting value for new plans is a one-line change in `frontend/src/lib/blank.ts` and needs the product decision first.

## Endpoints

- `POST /api/v1/expenditure/projection` (signed in) with `plan_id` (a saved plan, owner-scoped) or `plan` (hypothetical) and
  `horizon_months`: yearly and cumulative spending, essential and discretionary split, and each line's yearly amounts.
- `POST /api/v1/expenditure/projection/csv`: the same figures as UTF-8 CSV with a byte-order mark.

## Limits

No custom growth *schedules* by period beyond one rate per line; no per-category growth (per-line instead); a plan holds at most 60
spending lines; the monthly figures are not exported (the CSV is yearly); no payment-day modelling.
