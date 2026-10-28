import type { AccountCreateRequest, Goal, InvestmentCreateRequest, LiabilityCreateRequest, Plan, PolicyCreateRequest } from '../api/types'
import { blankPlan, currentMonth } from './blank'
import { monthlyEquivalent, type Frequency } from './frequency'
import { fromPaise, toPaise } from './money'
import { monthToIndex } from './months'

// What the engine accepts, from the API contract.
// Income has no product limit; the server only bounds request size.
export const LIMITS = { expenses: 12, commitments: 6, goals: 8 } as const

/** Planned income is entered monthly, quarterly or yearly. */
export const INCOME_FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'yearly']

let counter = 0
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter}`
}

export interface IncomeDraft {
  id: string
  label: string
  amount: string
  frequency: Frequency
  /** The last calendar year this income is received (inclusive of December), or '' for no end. */
  endYear: string
  /** Yearly increase as a percentage, or '' for none. */
  growthPercent: string
  include: boolean
}

export interface ExpenseDraft {
  id: string
  label: string
  amount: string
  frequency: Frequency
  essential: boolean
  include: boolean
}

export type GoalKind = 'emergency_fund' | 'education' | 'home' | 'vehicle' | 'wedding' | 'travel' | 'family' | 'retirement' | 'business' | 'other'
export type Tier = 1 | 2 | 3 | 4 | 5

export interface GoalDraft {
  id: string
  kind: GoalKind
  label: string
  /** The amount typed. Whether it is today's money or a future figure is `basis`. */
  amount: string
  date: string
  basis: 'today' | 'future'
  tier: Tier
  /** Money already set aside for this goal. */
  saved: string
}

export interface AccountDraft {
  id: string
  name: string
  kind: AccountCreateRequest['account_type']
  balance: string
  liquid: boolean
  /** Kept as the emergency fund. Counted once, towards the emergency goal only. */
  reserve: boolean
}

export interface InvestmentDraft {
  id: string
  name: string
  kind: InvestmentCreateRequest['asset_type']
  currentValue: string
  costBasis: string
  valuationDate: string
  liquid: boolean
}

export interface LiabilityDraft {
  id: string
  name: string
  kind: LiabilityCreateRequest['liability_type']
  balance: string
  /** Annual rate as a percentage with up to 2 decimals, or '' when unknown. */
  ratePercent: string
  payment: string
  /** Whole months left, or '' when unknown. */
  remainingMonths: string
}

export interface PolicyDraft {
  id: string
  kind: PolicyCreateRequest['policy_type']
  insurer: string
  label: string
  reference: string
  cover: string
  premium: string
  startDate: string
  countPremium: boolean
}

export interface Draft {
  asOf: string
  income: IncomeDraft[]
  expenses: ExpenseDraft[]
  accounts: AccountDraft[]
  investments: InvestmentDraft[]
  liabilities: LiabilityDraft[]
  goals: GoalDraft[]
  policies: PolicyDraft[]
  emergencyMonths: string
  /** Yearly goal inflation as a percentage, shown to the person and editable. */
  inflationPercent: string
}

export function emptyDraft(asOf: string = currentMonth()): Draft {
  return {
    asOf,
    income: [],
    expenses: [],
    accounts: [],
    investments: [],
    liabilities: [],
    goals: [],
    policies: [],
    emergencyMonths: '12',
    inflationPercent: '5',
  }
}

// ---- live totals, straight from what has been typed --------------------------------------

const filled = (value: string) => value.trim() !== ''

function monthly(amount: string, frequency: Frequency): bigint {
  return filled(amount) ? toPaise(monthlyEquivalent(amount, frequency)) : 0n
}

export interface Preview {
  income: string
  essential: string
  discretionary: string
  loanPayments: string
  surplus: string
  /** Months of essential spending plus loan payments that the emergency target covers. */
  emergencyTarget: string
}

export function preview(draft: Draft): Preview {
  const income = draft.income.filter((row) => row.include).reduce((sum, row) => sum + monthly(row.amount, row.frequency), 0n)
  const expenses = draft.expenses.filter((row) => row.include)
  const essential = expenses.filter((row) => row.essential).reduce((sum, row) => sum + monthly(row.amount, row.frequency), 0n)
  const discretionary = expenses.filter((row) => !row.essential).reduce((sum, row) => sum + monthly(row.amount, row.frequency), 0n)
  // Only loans whose months left are known become commitments in the plan, so only they count here.
  const loans = draft.liabilities
    .filter((row) => /^[1-9]\d*$/.test(row.remainingMonths))
    .reduce((sum, row) => sum + (filled(row.payment) ? toPaise(row.payment) : 0n), 0n)
  const months = BigInt(/^\d+$/.test(draft.emergencyMonths) ? draft.emergencyMonths : '0')
  return {
    income: fromPaise(income),
    essential: fromPaise(essential),
    discretionary: fromPaise(discretionary),
    loanPayments: fromPaise(loans),
    surplus: fromPaise(income - essential - discretionary - loans),
    emergencyTarget: fromPaise((essential + loans) * months),
  }
}

// ---- turning the draft into the plan the engine takes -------------------------------------

/** A percentage such as "5" or "7.25" as the engine's six-decimal rate string, or null if invalid. */
export function percentToRate(percent: string): string | null {
  const text = percent.trim()
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (hundredths > 3000n) return null // the engine allows up to 30%
  const micro = hundredths * 100n
  return `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`
}

const GOAL_TYPE: Record<GoalKind, Goal['type']> = {
  emergency_fund: 'emergency_fund',
  education: 'education',
  home: 'home',
  retirement: 'retirement',
  vehicle: 'custom',
  wedding: 'custom',
  travel: 'custom',
  family: 'custom',
  business: 'custom',
  other: 'custom',
}

export type Problem = 'too_many_expenses' | 'too_many_commitments' | 'too_many_goals' | 'no_goal' | 'bad_inflation'

export function buildPlan(draft: Draft, name: string): { plan: Plan | null; problems: Problem[] } {
  const problems: Problem[] = []
  const income = draft.income.filter((row) => row.include && filled(row.amount))
  const expenseRows = draft.expenses.filter((row) => row.include && filled(row.amount))
  const premiumRows = draft.policies.filter((row) => row.countPremium && filled(row.premium))
  const loans = draft.liabilities.filter((row) => filled(row.payment) && /^[1-9]\d*$/.test(row.remainingMonths))
  const rate = percentToRate(draft.inflationPercent)

  if (expenseRows.length + premiumRows.length > LIMITS.expenses) problems.push('too_many_expenses')
  if (loans.length > LIMITS.commitments) problems.push('too_many_commitments')
  if (draft.goals.length > LIMITS.goals) problems.push('too_many_goals')
  if (draft.goals.length === 0) problems.push('no_goal')
  if (rate === null) problems.push('bad_inflation')
  if (problems.length > 0 || rate === null) return { plan: null, problems }

  const base = blankPlan(draft.asOf, name || 'My household')
  const ordered = [...draft.goals].sort((a, b) => a.tier - b.tier) // stable: keeps the order within a tier
  // Balances the person marked as their emergency fund go to the first emergency goal, once, up to its
  // target. An amount typed on that goal itself wins, so the same money is never counted twice.
  const reserved = draft.accounts.filter((row) => row.reserve && filled(row.balance)).reduce((sum, row) => sum + toPaise(row.balance), 0n)
  const emergency = ordered.find((goal) => goal.kind === 'emergency_fund' && !filled(goal.saved))
  const emergencyShare = (goal: GoalDraft): string => {
    if (filled(goal.saved)) return goal.saved
    if (goal !== emergency || reserved <= 0n) return '0.00'
    const target = toPaise(goal.amount || '0.00')
    return fromPaise(reserved < target ? reserved : target)
  }
  const plan: Plan = {
    ...base,
    income_streams:
      income.length > 0
        ? income.map((row, index) => ({
            id: `income_${index + 1}`,
            label: row.label.trim().slice(0, 80) || `Income ${index + 1}`,
            // monthly_net is derived by the server from amount and frequency; sent for a consistent shape.
            monthly_net: monthlyEquivalent(row.amount, row.frequency),
            ends_after: null,
            amount: fromPaise(toPaise(row.amount)),
            frequency: row.frequency as 'monthly' | 'quarterly' | 'yearly',
            start_year: Number(draft.asOf.slice(0, 4)),
            ...(row.endYear.trim() ? { end_year: Number(row.endYear) } : {}),
            ...(row.growthPercent.trim() ? { annual_growth: percentToRate(row.growthPercent) ?? '0.000000' } : {}),
            step_ups: [],
          }))
        : [{ id: 'income_1', label: 'No regular income entered', monthly_net: '0.00', ends_after: null, frequency: 'monthly' }],
    expenses: [
      ...expenseRows.map((row, index) => ({
        id: `expense_${index + 1}`,
        label: row.label.trim().slice(0, 80) || `Expense ${index + 1}`,
        monthly: monthlyEquivalent(row.amount, row.frequency),
        essential: row.essential,
      })),
      ...premiumRows.map((row, index) => ({
        id: `premium_${index + 1}`,
        label: `Insurance premium: ${row.label.trim() || row.insurer.trim() || row.kind}`.slice(0, 80),
        monthly: monthlyEquivalent(row.premium, 'yearly'),
        essential: true,
      })),
    ],
    commitments: loans.map((row, index) => ({
      id: `loan_${index + 1}`,
      label: row.name.trim().slice(0, 80) || `Loan ${index + 1}`,
      monthly_payment: toPaise(row.payment) >= 0n ? fromPaise(toPaise(row.payment)) : '0.00',
      remaining_months: Number(row.remainingMonths),
    })),
    goals: ordered.map((goal, index) => ({
      id: `goal_${index + 1}`,
      label: goal.label.trim().slice(0, 80) || goal.kind,
      type: GOAL_TYPE[goal.kind],
      target_amount_today: goal.amount,
      target_date: goal.date,
      priority: index + 1,
      inflation_linked: goal.basis === 'today',
      inflation_rate_override: null,
      current_savings: emergencyShare(goal),
    })),
    assumptions: { ...base.assumptions, general_inflation_annual: rate },
  }
  return { plan, problems }
}

// ---- per-step validation ------------------------------------------------------------------

export type RowIssue = 'label' | 'amount' | 'date' | 'past' | 'range' | 'order'

const positive = (value: string) => filled(value) && toPaise(value) > 0n

export function incomeIssues(row: IncomeDraft, asOf: string): RowIssue[] {
  const issues: RowIssue[] = []
  if (!filled(row.label)) issues.push('label')
  if (!positive(row.amount)) issues.push('amount')
  if (row.endYear.trim() && (!/^\d{4}$/.test(row.endYear.trim()) || Number(row.endYear) < Number(asOf.slice(0, 4)))) issues.push('past')
  if (row.growthPercent.trim() && percentToRate(row.growthPercent) === null) issues.push('range')
  return issues
}

export function expenseIssues(row: ExpenseDraft): RowIssue[] {
  const issues: RowIssue[] = []
  if (!filled(row.label)) issues.push('label')
  if (!positive(row.amount)) issues.push('amount')
  return issues
}

export function goalIssues(row: GoalDraft, asOf: string): RowIssue[] {
  const issues: RowIssue[] = []
  if (!filled(row.label)) issues.push('label')
  if (!positive(row.amount)) issues.push('amount')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.date)) issues.push('date')
  else if (monthToIndex(row.date) < monthToIndex(asOf)) issues.push('past')
  else if (monthToIndex(row.date) - monthToIndex(asOf) > 599) issues.push('range')
  if (filled(row.saved) && toPaise(row.saved) > toPaise(row.amount || '0.00') && row.basis === 'future') issues.push('order')
  return issues
}

export function ratePercentValid(value: string): boolean {
  return value.trim() === '' || percentToRate(value) !== null
}
