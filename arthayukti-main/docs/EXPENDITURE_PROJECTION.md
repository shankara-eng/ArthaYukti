# Expenditure projection (plans, scheduled changes, trajectory)

The person's own spending plans, projected month by month from the current month. It sits beside the older plan-line spending
(`docs/EXPENDITURE_MODULE.md`), which still feeds the household engine; see "Not connected yet".

Code: `backend/app/engine/spending.py` (the only place the maths lives), `backend/app/api/spending.py`,
`backend/app/schemas/spending.py`, migration `a6b7c8d9e0f1`, UI in `frontend/src/components/spending/`.
No AI service is used and there is no file import. CSV is export only.

## Data

| Table | Holds |
| --- | --- |
| `expenditure_plans` | category (a predefined key or the person's own category), optional name, the amount as entered, frequency (`monthly` or `yearly`), duration type, start and end, an optional own inflation rate (NULL inherits), status, and the end a stopped plan had |
| `expenditure_changes` | permanent or temporary scheduled amount changes for a plan |
| `expenditure_categories` | the person's own flat categories (predefined ones are constants, not rows) |
| `expenditure_settings` | starting global inflation (default 6%), horizon in years (default 5), hidden predefined categories |
| `expenditure_rate_changes` | global-rate changes that take effect from a month |

Every row is owner-scoped; another person's id is a 404. A yearly plan keeps its annual amount; the engine uses one twelfth a month.

## Conventions

- **Start of the projection.** The current month, counted as a whole month. Nothing before it is projected. A horizon of N years is
  the next 12 x N months.
- **Inflation** is an annual step on 1 January. A plan or permanent change keeps its exact amount in the year it begins; each later
  January multiplies by (1 + rate). Example, 6%, 5,000 a month from March 2028: 2028 5,000; 2029 5,300; 2030 5,618.
- **Starting month.** Because the first step is always the following January, a plan starting in November or December is never
  inflated in its starting year (and neither is one starting in March; the brief's examples agree). Flagged: the brief does not say what
  the November/December rule would change beyond that.
- **Ending month.** A monthly plan ending January to July takes no new step in its ending year; August or later takes it. A yearly plan
  has no end month, so no such exception.
- **Permanent change.** The new amount is the base from its month. The old base's inflation is dropped; the new base starts stepping
  the following January. Two permanent changes in the same month are refused.
- **Temporary override.** An exact amount for its months. The plan's own trajectory carries on underneath, so the month after the override
  the underlying amount resumes, with no step applied twice. Overrides may not overlap; a temporary override wins over the plan's amount.
  Amounts for a yearly plan are annual figures.
- **Rounding.** Each plan's amount for each month is rounded half-up to the paisa; a year is the sum; cumulative is the sum of years.
  Decimal arithmetic throughout.
- **Without inflation.** Every inflation rate set to zero, scheduled changes, periods and horizon kept. It is not "the original amount
  frozen".
- **Global rate change.** Two modes. *Recalculate all* sets the new rate for the whole projection and clears scheduled rate changes.
  *From a month* keeps the earlier rate before that month. A plan with its own rate is never affected. The month may not be in the past.
- **Stop.** Spending ends from this month on; the plan, its changes and its original end are kept. **Reactivate** restarts it from this
  month (no copy is made, nothing is projected for the stopped time). If its original end has passed it restarts ongoing, and the plan
  shows that. A stopped plan cannot be edited until reactivated.
- **Past starts** are refused for new plans (`start_in_past`); an unchanged start on an existing plan is allowed.
- **Categories.** Predefined categories can be hidden, not renamed or deleted. Your own can be renamed, archived, and deleted only when no
  plan uses them (otherwise the plans must be moved: `reassign_to`). Names are unique ignoring case, also against predefined names.

## Endpoints (signed in)

`GET/POST /expenditure/plans`, `PUT/DELETE /expenditure/plans/{id}`, `POST .../stop`, `POST .../reactivate`,
`POST .../changes`, `PUT/DELETE .../changes/{id}`; `GET/POST /expenditure/categories`, `PUT/DELETE .../categories/{id}`,
`PUT .../categories/system/{key}`; `GET/PUT /expenditure/settings`, `POST .../settings/inflation`, `DELETE .../settings/inflation/{id}`;
`GET /expenditure/trajectory`; `GET /expenditure/trajectory.csv?granularity=yearly|monthly`.

The CSV is built from the same `trajectory()` call as the screen (UTF-8 with a byte-order mark, CRLF, standard quoting).

## Not connected yet

- The household engine, goal feasibility and Financial Trajectory still read the plan's own expense lines, not these plans. Feeding
  them from these plans is the next integration step and needs a decision on which source wins.
- The account data export does not include these tables yet (deleting an account removes them).
- English only; no Hindi copy yet.
- Conventions for the current partial month (counted whole) and for the November/December rule are choices recorded above.

## Tests

`backend/tests/engine/test_spending_engine.py` (hand-worked figures), `backend/tests/api/test_spending_api.py` (validation, lifecycle,
categories, settings, CSV reconciliation, isolation), `frontend/src/lib/spending.test.ts`,
`frontend/src/components/spending/SpendingDashboard.test.tsx`.

## Update: connected to the Financial Trajectory, and exported

- `POST /trajectory/project` takes `spending_source`: `plan` (the default, unchanged) or `expenditure_plans`. The second reads the
  person's active Expenditure plans month by month (their own inflation, scheduled changes and the global rate schedule) instead of
  the plan's expense lines, so the two are never added together. With no active plan it answers 422 `no_expenditure_plans` rather than
  assuming nothing is spent. An insurance-category plan counts as premiums already in spending.
- The goal engine, scenarios and the other plan-based endpoints still read the plan's own expense lines. Choosing one source for
  every screen is a product decision that has not been made.
- The account data export now includes the plans, categories and settings (`expenditure`), and deleting the account removes them.

## Update: one spending source for goals, scenarios, fixes and comparisons

`Plan.spending_schedule` (optional, up to 600 months) holds spending by month. For a month it covers, every engine (projection, trade-offs,
fixes, comparison, rescue, trajectory) uses that figure and does not add the plan's expense lines; any month it leaves out uses the lines,
with a `spending_schedule_short` warning. `POST /expenditure/apply-to-plan {plan, months}` (signed in) returns the plan with the schedule
filled from the person's active Expenditure plans, month by month, from the plan's `as_of`. It is a snapshot: apply again after changing a plan.
The Expenditure page has "Use these plans" / "Apply again" / "Go back to my plan's expense lines". The emergency-fund and Plan B logic still
classify essential spending from the plan's expense lines, because Expenditure plans carry no essential flag by design.
