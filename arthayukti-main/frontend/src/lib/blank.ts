import type { Goal, Plan } from '../api/types'
import { addMonths } from './months'

/** The most goals a plan can hold, as set by the backend contract. */
export const MAX_GOALS = 8

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * An empty plan to be filled in by the person. It holds a structure and zeros only: no
 * amounts, goals or names are invented. The backend still decides every outcome.
 */
export function blankPlan(asOf: string = currentMonth(), name = 'My household', inflation = '0.000000'): Plan {
  return {
    name,
    as_of: asOf,
    currency: 'INR',
    income_streams: [{ id: 'income', label: 'Monthly income', monthly_net: '0.00', ends_after: null, frequency: 'monthly' }],
    expenses: [
      { id: 'food_home', label: 'Food, home and bills', monthly: '0.00', essential: true },
      { id: 'school_travel', label: 'School and travel', monthly: '0.00', essential: true },
      { id: 'loan', label: 'Loan payments', monthly: '0.00', essential: true },
      { id: 'other', label: 'Other spending', monthly: '0.00', essential: true },
    ],
    commitments: [],
    unassigned_savings: '0.00',
    goals: [],
    assumptions: {
      general_inflation_annual: inflation,
      savings_return_annual: '0.000000',
      income_growth_annual: '0.000000',
      expense_growth_annual: '0.000000',
    },
    fix_limits: { extra_savings_cap_pct_of_income: '0.2000' },
  }
}

/** True when nothing has been entered yet: no goals, no income and no spending. Nothing is invented to fill the gap. */
export function isBlankPlan(plan: Plan): boolean {
  const income = plan.income_streams.some((stream) => Number(stream.monthly_net) > 0 || Number(stream.amount ?? 0) > 0)
  const spending = (plan.expenses ?? []).some((expense) => Number(expense.monthly) > 0)
  return plan.goals.length === 0 && !income && !spending
}

export function hasGoals(plan: Plan | null): plan is Plan {
  return plan !== null && plan.goals.length > 0
}

/** A new goal at the lowest priority. Ids stay unique even after goals are removed. */
export function newGoal(
  plan: Plan,
  type: Goal['type'],
  label: string,
  amount: string,
  targetDate: string,
): Goal {
  let n = plan.goals.length + 1
  while (plan.goals.some((goal) => goal.id === `goal_${n}`)) n += 1
  return {
    id: `goal_${n}`,
    label,
    type,
    target_amount_today: amount,
    target_date: targetDate,
    priority: Math.max(0, ...plan.goals.map((goal) => goal.priority)) + 1,
    inflation_linked: false,
    inflation_rate_override: null,
    current_savings: '0.00',
  }
}

export function defaultGoalDate(asOf: string): string {
  return addMonths(asOf, 24)
}
