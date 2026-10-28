# Investment calculators

Lump-sum and recurring (SIP) investments, valued by one deterministic engine
(`backend/app/engine/calculators.py`). The screen, the annual tables, the compiled report, the
scenario comparison and the CSV all read the same result, so they cannot disagree.

> **Source of requirements.** The brief referred to an attached calculators specification, but no such
> file was available (not in the repository, the message, or the downloads folder). This module was built
> from the written brief plus sections 4.7 to 4.9 of `docs/spec/ArthaYukti_Master_Specification.txt`
> (expected returns, SIP step-ups, scenario tabs). Anything the brief left open is listed under
> "Conventions" and was chosen to match the rest of the product. If the missing document says otherwise,
> compare it against that list.

## Endpoints (all need a signed-in user)

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/calculators/run` | Value every investment, the totals and the compiled report. |
| `POST /api/v1/calculators/maturity-check` | Which investments still need an after-maturity decision. |
| `POST /api/v1/calculators/export` | The same result as CSV (UTF-8 with a byte-order mark). |
| `POST /api/v1/calculators/compare` | Totals for two to four calculators side by side. |
| `GET/POST /api/v1/calculators/scenarios`, `GET/PUT/DELETE .../{id}` | Saved calculators (database, per user). |

Saved calculators live in `calculator_scenarios` (migration `d3e4f5a6b7c8`): `user_id` (cascade delete),
`name` (unique per user), `config_json`. They appear in the account data export and are removed with the
account. A user can keep 50.

## Conventions

- **Rates** are nominal annual fractions compounded monthly (`rate / 12`), the same as the rest of the
  product (`FINANCIAL_MODEL.md`). A rate may be negative, down to -100% a year. Growth, tax and inflation
  are assumptions the user types; nothing is defaulted.
- **Timing.** Month 1 is the investment's start month. A lump sum is invested on the first day and grows
  from month 1. An instalment is paid at the end of its month and first grows the next month. Instalment
  *k* of a monthly, quarterly or annual plan falls at the end of month *k*, *3k* or *12k*, up to the end of
  the contribution period.
- **Rounding.** The balance is rounded half-up to the paisa every month, so every shown figure is a whole
  number of paise and the yearly rows reconcile exactly (`opening + contributions + growth = closing`).
  A percent step-up rounds the new instalment to the paisa.
- **Step-ups** apply from an investment-relative year (year 1 is months 1 to 12) to every instalment paid in
  that year or later. A step-up either sets a new amount or raises the previous instalment by a percentage.
  Years must be unique, at least 2, and not after the last contribution year.
- **Independent periods.** `contribution_years` (the SIP) and `growth_years` (the total period) are
  separate. After contributions stop, the balance keeps growing until the end of the growth period.
- **Tax** is charged once, at the valuation date: `tax_rate x max(0, value - principal)`. Principal is all
  money paid in up to that date (lump sum plus instalments). A loss is not taxed and is not netted against
  another investment's gain. The yearly rows are before tax.
- **Inflation** divides the post-tax value by `(1 + inflation/12)^months`. In individual mode the months run
  from that investment's own start, so the per-investment figures are each in the money of their own start,
  and no grand total is shown (it would add different kinds of money). In common-date mode every investment
  is measured from the earliest start in the calculator, so the total is meaningful.
- **Valuation.** Individual mode values each investment at the end of its growth period. Common-date mode
  values every investment at the end of one chosen month: later instalments are not counted, an investment
  that starts after that date is left out, and the tax is calculated on what was actually paid in by then.
- **After maturity.** If the common date is later than an investment's growth period, the user must choose
  for that investment: *hold* (no growth), *continue* at the same rate, or *reinvest* at a given rate.
  Without a choice the service refuses (`maturity_decision_required`, naming the investments), so the
  engine never guesses. Tax is still charged once, at the common date.
- **Compiled report.** Adds up only the chosen investments, by calendar year. A balance whose valuation has
  ended is held at its final value in a separate column (`matured_held`) so it is never mixed with money
  that is still growing. The totals equal the sum of the chosen investments.
- **No double counting.** Investment ids are unique inside a calculator, a compile selection cannot list an
  id twice, and a comparison values each calculator alone; alternatives are never added to one another.
- **Limits.** Up to 20 investments, 60 years, 10 step-ups, and a common date within 100 years of an
  investment's start.

## Tests

- `backend/tests/engine/test_calculators_engine.py`: hand-worked ladders (for example 100,000 at 12% for a
  year is 112,682.51 with monthly rounding, 112,682.50 unrounded), zero and negative growth, -100% a year,
  schedules for each frequency, multiple step-ups, growth after contributions stop, tax once, inflation,
  common-date and after-maturity cases, annual reconciliation and the compiled totals. Expected values are
  derived independently of the engine.
- `backend/tests/api/test_calculators_api.py`: request validation, CSV reconciled with the result, formula
  neutralisation in names, saved-scenario persistence, ownership (another user gets 404), the 50-scenario
  cap, account export and deletion, and comparison without double counting.
- `frontend/src/lib/calculators.test.ts` and `frontend/src/pages/app/Calculators.test.tsx`: input parsing,
  the request the page builds, the maturity decision, save, name clash and CSV download.

## Update: tax method and rate convention (both optional, per investment)

- `tax_method`: `gains` (the default, as above) or `total_amount`: `tax_rate x max(0, value)` charged once at the valuation date. A loss
  is never taxed under `gains`; under `total_amount` a value of zero is taxed zero.
- `rate_convention`: `nominal_monthly` (the default and the product's convention, rate / 12 a month) or `effective_annual`: a month is
  `(1 + rate)^(1/12) - 1`, so twelve months compound to exactly the stated rate, and inflation divides by `(1 + inflation)^(months / 12)`.
  It applies to growth, an after-maturity reinvestment rate and inflation. A rate of -100% a year gives a zero balance without error.
- Saved calculators without these fields keep their old behaviour.
- Not done: scenarios saved under a single calculator (use Compare, which values each configuration alone), and default
  "Investment 1, 2..." names, which belong to the page rather than the engine.

## Update: where to find it in the app

Investment Calculator now has two tabs. "Quick calculators" is the original page (its own state in the browser). "Detailed calculators"
is this module: server-valued, saved to the account, with tax on the gain or the whole value, effective or monthly-compounded rates, step-ups,
common-date valuation, comparison and CSV.
