# Financial Model (v1)

**Purpose.** ArthaYukti is a focused, explainable decision-support tool. It does not try to replace banking, budgeting or investment apps. The model is deterministic, every rule below can be checked by hand, and the tests include hand-checked cases and invariants such as money being conserved every month.

Source of truth for the calculation engine. Any change to this document needs both team members' agreement and a matching change to the golden tests.

## 1. Conventions

- Currency: INR only. Amounts are `Decimal`, serialized as strings with 2 decimal places.
- Time: monthly steps. `as_of` (YYYY-MM) is month 1. Month index `t = 1..H`.
- Goal deadline index: `d = (target.year - as_of.year) * 12 + (target.month - as_of.month) + 1` (the number of contribution months, inclusive).
- Rates are fractions in the API (0.06 = 6%), nominal annual, compounded monthly (`r_m = r / 12`). Every power therefore has an integer exponent.
- The engine has no default rates. Every rate is an explicit input. The UI may pre-fill illustrative values and must label them as such.
- Not modelled: taxes, investment products, probabilistic outcomes, debt amortisation (existing EMIs are fixed payments).

## 2. Inputs

| Entity | Fields |
|---|---|
| Plan | name, as_of, currency, income_streams[1-4], expenses[0-12], commitments[0-6], unassigned_savings, goals[1-8], assumptions, fix_limits |
| Income stream | id, label, monthly_net >= 0, ends_after (YYYY-MM or null) |
| Expense | id, label, monthly >= 0 |
| Commitment | id, label, monthly_payment >= 0, remaining_months 1-600 |
| Goal | id, label, type, target_amount_today > 0, target_date, priority (unique, 1 = highest), inflation_linked, inflation_rate_override, current_savings >= 0, flexibility {max_delay_months 0-120, min_target_pct 0.50-1.00} |
| Assumptions | general_inflation_annual, savings_return_annual, income_growth_annual, expense_growth_annual |
| Fix limits | extra_savings_cap_pct_of_income |

Goal types: `home`, `education`, `loan_payoff`, `emergency_fund`, `retirement`, `custom`.

Kept distinct everywhere: target amount (today's money vs nominal at the deadline), current goal-specific savings, monthly contribution, target date, projected completion date.

## 3. Monthly surplus

```
S_t = sum(income_t) - sum(expenses_t) - sum(commitments_t)
      - one_time_expenses_t + one_time_incomes_t + extra_monthly_savings
```

- Income and expenses step up on each anniversary of `as_of` by `(1 + g)^k` (integer `k`).
- A commitment applies while `t <= remaining_months`.
- Shocks modify these terms only. `S_t` can be negative.

## 4. Inflation

- Goal rate `i`: the goal's override if set, else general inflation. Goals with `inflation_linked = false` use 0.
- Nominal target at month `t`: `N_t = round(T0 * (1 + i/12)^t)`, computed from `T0` each time, never accumulated.
- Today's-money value of a nominal amount at month `t`: `amount / (1 + i/12)^t`.

## 5. Savings assignment

- `current_savings` is ring-fenced to its goal. `unassigned_savings` is separate. No amount is counted twice.
- At month 1, `unassigned_savings` is assigned by priority, each goal capped at its remaining need (`N_1 - balance`). The rest is free cash (earns no growth).

## 6. Allocation policy (each month `t`)

1. Growth: for each unrealised goal, `interest = round(balance * r/12)`, added to the balance.
2. If `S_t >= 0`:
   - Pass 1 (protect deadlines): walk goals in `(priority, id)` order. Each pays `min(required, remaining need, remaining surplus)`.
     `required` is the level amount that reaches `N_d` by the deadline: `(N_d - B * (1+r)^m) / s(m)`, with `m = d - t + 1` and `s(m) = ((1+r)^m - 1) / r` (or `m` when `r = 0`). Rounded up to the paisa. If the deadline has passed, `required` is the whole remaining need.
   - Pass 2 (accelerate): leftover surplus goes to unfunded goals in priority order, capped at remaining need.
   - Anything left over becomes free cash.
3. If `S_t < 0`, cover the deficit in this order: free cash, then emergency-fund goals (by priority), then other unrealised goals from lowest priority up. Any remainder is an `uncovered_deficit` and is reported, never hidden.
4. Realisation: a goal is realised when `balance >= N_t`. Its funds are committed, any excess is released to free cash, and it is locked (excluded from deficit draws). Emergency-fund goals are revolving: topped up to `N_t`, usable in deficits, refilled by priority afterwards. A revolving goal counts as on time only if it is still funded at its deadline; if a shock has drawn it down by then, it completes when it is next refilled.

Rounding: all amounts are quantized to 0.01 (half-up). Only `required` rounds up.

### Implementation notes (M1)

- The required level amount uses the balance after this month's growth: `(N_d - B' * (1+r)^(m-1)) / s(m)`, because this month's contribution is made at the end of the month and first grows next month.
- Money moved from `unassigned_savings` to goals at month 1 is not counted as a monthly contribution. It shows only in balances.
- Realised goals earn no growth. Leftover surplus and released excess collect in free cash, which earns nothing and is only used to cover later deficits.
- `crowded_out_by` adds, for each month in which a goal received less than its required amount, what each higher-ranked goal was paid in pass 1.
- `average_monthly_contribution` is total contributed divided by the months to completion, or by the months to the deadline if the goal never completes.
- Interest is rounded to the paisa each month, so a balance can differ by a paisa or two from unrounded compounding. The test suite checks the engine against an independent month-by-month ledger.
- Fix options (`/fixes`): one extra-savings option, plus one delay option and one reduce-target option for each failing goal, each verified by a re-run. They are ranked by `normalised_cost`, then by lever order and goal priority. If none resolves everything, options are ranked by how many goals stay late.
- Comparison (`/compare`) measures each scenario against the first: months of shift in completion date, and the change in today's-money shortfall.
- Pass 2 (accelerate) means a household with spare surplus completes goals well before their deadlines. A shock only bites once that slack is used up.

## 7. Definitions

- Projected completion: first month a goal is realised (for emergency funds, first reached). `null` if not within the horizon (latest deadline plus 20 years, capped at 600 months).
- Status: `on_track` (completion at or before the target date), `delayed` (completion later, within the horizon, delay reported in months), `not_achievable` (not completed within the horizon).
- Shortfall at deadline: `max(0, N_d - B_d)` if not realised by `d`, reported nominal and in today's money.
- Required monthly (level, standalone): level amount to reach `N_d` from `as_of` with that goal alone, for display.
- Overcommitment ratio: `sum(required standalone) / S_1`.
- Plan feasible: every goal `on_track` and no uncovered deficit.

## 8. Shocks

`income_change` (multiplier on one stream or all; 0 means loss), `expense_change` (monthly delta), `one_time_expense`, `one_time_income`. All take explicit month ranges and only alter `S_t`.

## 9. Minimal-fix engine

| Lever | Search | Granularity |
|---|---|---|
| Extra monthly savings (added to `S_t`) | bisection (monotone) | 100 rupees |
| Delay a failing goal's target date | linear scan up to `max_delay_months` | 1 month |
| Reduce a failing goal's target | linear scan down to `min_target_pct` | 1% |

- Every option is verified by re-running the engine on the modified scenario.
- Ranking: `normalised_cost = magnitude / cap`, with caps `extra_savings_cap * baseline income`, `max_delay_months`, `1 - min_target_pct`. Options above their cap are discarded.
- Tie-break: extra savings, then delay, then reduction.
- If no single lever resolves everything, return the cheapest lever that resolves the most goals, plus the reason.
- Fixes are returned as a scenario delta.

## 10. Trade-off matrix

For each goal G, move G to priority 1 (others keep relative order), re-run the engine, and record each goal's status, delay, and shortfall.

## 11. Edge cases

A target date before `as_of` is rejected; a goal may be due in the plan's first month. A goal already funded at month 1 completes in month 1. Equal deadlines are resolved by priority, then id. Negative surplus every month means no contributions and `null` completion. `r = 0` uses the linear branch. Total savings is derived (`unassigned_savings` plus the sum of each goal's `current_savings`), never an input, so it cannot be inconsistent. All outputs are deterministic: no randomness, no floats, stable sorting.

## 12. Hand-checked reference cases

| Case | Inputs | Expected |
|---|---|---|
| Inflation | 1,00,000 at 12% for 12 months (factor 1.01^12) | 1,12,682.50 |
| Surplus | income 1,00,000, expenses 60,000, EMI 10,000 for 3 months | 30,000 in months 1-3, 40,000 afterwards |
| Delayed goal | surplus 30,000, goal 6,00,000 by month 12, 1,20,000 saved | shortfall 1,20,000 at deadline, completion month 16, delay 4 |
| Priority | two goals of 3,00,000 (deadlines month 6 and 12), surplus 50,000 | priority order A, B: both on time. Reverse: A delayed 6 months |
| Income loss | surplus 40,000, goal 4,80,000 by month 12, income 0 in months 4-5 | withdrawals of 60,000 in months 4 and 5, completion month 17, delay 5 |
| Unexpected expense | same goal, one-time 1,00,000 in month 3 | withdrawal 60,000 in month 3, completion month 15, delay 3 |
| Minimal fix | delayed-goal case, income 90,000, caps 20% / 24 months / 80% | extra 10,000 (cost 0.556), delay 4 months (0.167), reduce 20% (1.000) |
