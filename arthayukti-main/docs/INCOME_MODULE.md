# Planned income: conventions

Planned income is what a household expects to earn. It drives surplus, goals, scenarios and rescue.
Money already received is recorded separately as credit transactions and never changes planned income.

## Two forms of stream
- **Legacy** (`monthly_net`, optional `ends_after` month): behaves exactly as before. The plan-wide
  `income_growth_annual` applies on each anniversary of the plan start. Saved plans are not rewritten.
- **Scheduled** (`start_year`, `amount`, `frequency`, optional `end_year`, `annual_growth`, `step_ups`):
  calendar years, its own growth. The plan-wide growth is never applied to it. When a legacy stream is
  edited with a schedule in the app, the plan-wide rate is copied into that stream's own growth so its
  forecast is kept. A legacy stream that ends part-way through a year cannot be converted (a schedule
  ends in December).

## Rules
- Frequencies: monthly, quarterly, yearly. Monthly equivalent = amount / 1, 3 or 12. The division is
  not rounded; each projected month is rounded once, half-up, to the paisa, after growth and step-ups.
  `monthly_net` of a scheduled stream is derived (initial amount, rounded) and any value sent is replaced.
- Start year: from January; not before the plan's first year. End year: inclusive, through December.
- Growth: optional, 0 to 30 %, compounded on the first month of each calendar year after the start year.
  Blank and 0 both mean no automatic increase.
- Raise start year (`growth_start_year`, optional): the first calendar year the raise is added; it must be after
  the start year (the amount entered is what is earned in the start year), not after the end year, and needs an
  annual raise. Before it the income stays flat. Left blank, the raise is first added the year after the start year
  (the behaviour before this field existed). The raise then repeats every year. Example: 12,00,000 a year with a
  10% raise starting 2028 gives 12,00,000 in 2027, 13,20,000 in 2028 and 14,52,000 in 2029.
- Step-up: from January of its year the base is replaced by the new amount (same frequency as the stream);
  growth then compounds from it. A step-up wins over growth in the same year. One per year, strictly after
  the start year and not after the end year.
- The plan's first calendar year can be partial; a horizon that ends mid-year counts only the months inside it.
- Technical safeguards only: at most 200 streams per plan and 60 step-ups per stream (request size).

## One calculation path
`engine/flows.month_flows` produces monthly income. `engine/income.project_income` sums those months by
calendar year, and `POST /income/projection` (and `/csv`) return it. The dashboard, chart, table, CSV and
the planner all read this same series.

The response also carries `sources` (each income's entered amount, monthly equivalent, raise, raise start year,
step-ups and its amount per year; the per-source years add up to the yearly totals), `plan_growth_annual` and a
list of `conventions` to show beside the table. `stream_amount` in `engine/flows.py` is the one function that gives
a stream's amount for a month, so the surplus, the goals and this projection cannot disagree.

## Limits
- The projection period is at most 50 years (600 months), the engine's horizon limit.
- A plan can be saved with no goal, so income can be entered first. Goal-based calculations (projections, fixes,
  trade-offs, rescue, recommendations) still need at least one goal and return a 422 asking for one; the income and
  spending projections do not.
