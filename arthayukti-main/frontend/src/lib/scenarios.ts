import type { FixOption, Plan, SampleDetail, Scenario } from '../api/types'
import { addMoney, toPaise } from './money'
import { addMonths } from './months'

export type Choice = 'normal' | 'no_income' | 'expense'

/** The situations on the "What if" screen are the sample's preset scenarios. */
export function scenarioFor(sample: SampleDetail, choice: Choice): Scenario | undefined {
  if (choice === 'normal') return undefined
  const wanted = choice === 'no_income' ? 'income_change' : 'one_time_expense'
  return sample.scenarios.find((scenario) =>
    (scenario.events ?? []).some((event) => event.type === wanted),
  )
}

type Override = NonNullable<Scenario['goal_overrides']>[number]

function mergeOverrides(existing: Override[], added: Override[]): Override[] {
  const byGoal = new Map<string, Override>()
  for (const override of [...existing, ...added]) {
    byGoal.set(override.goal_id, { ...byGoal.get(override.goal_id), ...stripNulls(override) })
  }
  return [...byGoal.values()]
}

function stripNulls(override: Override): Override {
  const clean: Override = { goal_id: override.goal_id }
  if (override.target_date) clean.target_date = override.target_date
  if (override.target_amount_today) clean.target_amount_today = override.target_amount_today
  return clean
}

/** Adds a chosen fix on top of the current situation. */
export function withFix(scenario: Scenario | undefined, fix: FixOption | null): Scenario | undefined {
  if (!fix) return scenario
  const base: Scenario = scenario ?? { name: 'Smallest fix', extra_monthly_savings: '0.00' }
  const delta = fix.scenario_delta
  return {
    ...base,
    extra_monthly_savings: addMoney(base.extra_monthly_savings, delta.extra_monthly_savings),
    goal_overrides: mergeOverrides(base.goal_overrides ?? [], delta.goal_overrides ?? []),
  }
}

/**
 * The same two situations for a plan the person built. The six-month income stop needs no
 * number. The expense needs an amount the person gives, so none is made up: without one
 * there is no situation yet.
 */
export function ownScenario(plan: Plan, choice: Choice, expenseAmount: string): Scenario | undefined {
  if (choice === 'no_income') {
    return {
      name: 'No income for 6 months',
      extra_monthly_savings: '0.00',
      events: [
        {
          type: 'income_change',
          stream_id: null,
          from_month: plan.as_of,
          to_month: addMonths(plan.as_of, 5),
          multiplier: '0',
        },
      ],
    }
  }
  if (choice === 'expense' && expenseAmount !== '' && toPaise(expenseAmount) > 0n) {
    return {
      name: 'Sudden big expense',
      extra_monthly_savings: '0.00',
      events: [{ type: 'one_time_expense', month: plan.as_of, amount: expenseAmount, label: 'Big expense' }],
    }
  }
  return undefined
}
