import type { TrajectoryEvent, TrajectoryLedgerMonth, TrajectoryRequest, TrajectoryResult, TrajectoryBalances } from '../api/types'
import { ROUTES, type Route } from './route'

/** Asset classes a person can give a return assumption for (the same keys the server accepts). */
export const ASSET_CLASSES = [
  'market_investments',
  'retirement_and_fixed_income',
  'deposits_and_investment_accounts',
  'physical_and_other_assets',
  'insurance_fund_value',
] as const
export type AssetClass = (typeof ASSET_CLASSES)[number]

export const YEAR_CHOICES = [5, 10, 20, 30, 50] as const
export type ViewName = 'baseline' | 'selected_goals' | 'scenario'
export type PremiumRule = 'auto' | 'yes' | 'no'
export type GoalEffectName = 'spend' | 'asset_purchase' | 'debt_reduction' | 'hold'

/** What the person has chosen. The request is built from this, never from the result. */
export interface TrajectoryChoices {
  horizon: { kind: 'years'; years: number } | { kind: 'age'; age: string }
  view: ViewName
  goalIds: string[]
  /** Only for goals whose effect the person set; a custom goal is never guessed. */
  goalEffects: Record<string, { effect: GoalEffectName; liabilityId?: string }>
  /** Percent a year as typed, by class. Empty means no assumption. */
  rates: Partial<Record<AssetClass, string>>
  premiumGrowth: string
  premiumRule: PremiumRule
  /** Where planned spending comes from: the plan's own lines, or the plans on the Expenditure page. */
  spendingSource: 'plan' | 'expenditure_plans'
  /** General inflation as a percent, to restate net worth in today's money. Empty: no adjustment. */
  inflation: string
  /** Plan loan payment id -> debt id, when the person said they are the same loan. */
  links: Record<string, string>
}

export const defaultChoices = (): TrajectoryChoices => ({
  horizon: { kind: 'years', years: 10 },
  view: 'baseline',
  goalIds: [],
  goalEffects: {},
  rates: {},
  premiumGrowth: '',
  premiumRule: 'auto',
  spendingSource: 'plan',
  inflation: '',
  links: {},
})

/** A signed rate from a percentage the person typed (-50 to 50, at most two decimals), as the API's decimal string. */
export function percentToSignedRate(percent: string): string | null {
  const text = percent.trim()
  const match = /^(-?)(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  const hundredths = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0')
  if (hundredths > 5000n) return null
  const micro = hundredths * 100n
  const body = `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`
  return match[1] === '-' && micro !== 0n ? `-${body}` : body
}

/** A yearly premium rise in percent (0 to 30), as the API's decimal string; empty means none. */
export function percentToGrowthRate(percent: string): string | null {
  if (percent.trim() === '') return '0.000000'
  const rate = percentToSignedRate(percent)
  if (rate === null || rate.startsWith('-') || Number(rate) > 0.3) return null
  return rate
}

export function parseAge(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const age = Number(text.trim())
  return age >= 1 && age <= 120 ? age : null
}

export interface Built {
  request: Omit<TrajectoryRequest, 'plan' | 'plan_id' | 'scenario'>
  problems: ('age' | 'rate' | 'premium' | 'inflation')[]
}

/** The request body for the chosen options, and what is wrong with them. Nothing here is a financial formula. */
export function buildRequest(choices: TrajectoryChoices): Built {
  const problems: Built['problems'] = []
  let horizon: NonNullable<TrajectoryRequest['horizon']>
  if (choices.horizon.kind === 'years') {
    horizon = { months: choices.horizon.years * 12 }
  } else {
    const age = parseAge(choices.horizon.age)
    if (age === null) problems.push('age')
    horizon = { target_age: age ?? 1 }
  }
  const return_assumptions: NonNullable<TrajectoryRequest['return_assumptions']> = []
  for (const klass of ASSET_CLASSES) {
    const typed = choices.rates[klass]
    if (typed === undefined || typed.trim() === '') continue
    const rate = percentToSignedRate(typed)
    if (rate === null) problems.push('rate')
    else return_assumptions.push({ scope: 'class', key: klass, annual_rate: rate })
  }
  const growth = percentToGrowthRate(choices.premiumGrowth)
  if (growth === null) problems.push('premium')
  const inflation = choices.inflation.trim() === '' ? undefined : percentToGrowthRate(choices.inflation)
  if (inflation === null) problems.push('inflation')
  const selected = choices.view === 'baseline' ? [] : choices.goalIds
  return {
    problems,
    request: {
      horizon,
      view: choices.view,
      selected_goal_ids: selected,
      include_monthly_ledger: true,
      include_events: true,
      return_assumptions,
      premium_growth_annual: growth ?? '0.000000',
      premiums_in_spending: choices.premiumRule,
      spending_source: choices.spendingSource,
      ...(inflation ? { inflation_annual: inflation } : {}),
      linked_commitments: Object.entries(choices.links).map(([commitment_id, liability_id]) => ({ commitment_id, liability_id })),
      goal_effects: selected
        .filter((id) => choices.goalEffects[id] !== undefined)
        .map((id) => {
          const chosen = choices.goalEffects[id]
          return chosen.effect === 'debt_reduction' ? { goal_id: id, effect: chosen.effect, liability_id: chosen.liabilityId } : { goal_id: id, effect: chosen.effect }
        }),
    },
  }
}

/** A route named by the server, if it is one of the app's own pages. */
export function editRoute(name: string | null | undefined): Route | null {
  return name && (ROUTES as readonly string[]).includes(name) ? (name as Route) : null
}

export interface SeriesPoint {
  month: string
  balances: TrajectoryBalances
}

/** The opening position followed by each month's closing position, for the charts. */
export function series(result: TrajectoryResult): SeriesPoint[] {
  const points: SeriesPoint[] = [{ month: result.as_of, balances: result.opening_balances }]
  for (const row of result.monthly_ledger ?? []) points.push({ month: row.month, balances: row.closing_balances })
  return points
}

const EVENT_GROUPS = ['income_events', 'expense_events', 'debt_events', 'insurance_events', 'investment_events', 'deposit_events', 'goal_events', 'other_events'] as const

export function allEvents(row: TrajectoryLedgerMonth): TrajectoryEvent[] {
  return EVENT_GROUPS.flatMap((group) => row[group])
}

/** Events worth listing as "coming up": scheduled payments and receipts, maturities, goal effects and the first shortfall. */
const TIMELINE_KINDS = new Set([
  'premium',
  'premium_in_spending',
  'maturity_benefit',
  'deposit_maturity',
  'investment_purchase',
  'goal_spending',
  'goal_asset_purchase',
  'goal_debt_reduction',
])

export interface TimelineItem {
  month: string
  kind: string
  label: string
  cash: string
  note: string
}

export function timeline(result: TrajectoryResult): TimelineItem[] {
  const items: TimelineItem[] = []
  const shortfallSeen = { done: false }
  for (const row of result.monthly_ledger ?? []) {
    for (const event of allEvents(row)) {
      if (TIMELINE_KINDS.has(event.kind)) items.push({ month: event.month, kind: event.kind, label: event.label, cash: event.cash_delta, note: event.note })
      if (event.kind === 'unfunded_shortfall' && !shortfallSeen.done) {
        shortfallSeen.done = true
        items.push({ month: event.month, kind: event.kind, label: event.label, cash: event.cash_delta, note: event.note })
      }
    }
  }
  for (const loan of result.summary.projected_debt_free_dates) {
    if (loan.month) items.push({ month: loan.month, kind: 'debt_free', label: loan.name, cash: '0.00', note: '' })
  }
  return items.sort((a, b) => (a.month === b.month ? a.kind.localeCompare(b.kind) : a.month.localeCompare(b.month)))
}

export const ALLOCATION_KEYS = [
  'cash',
  'deposits_and_investment_accounts',
  'market_investments',
  'retirement_and_fixed_income',
  'physical_and_other_assets',
  'insurance_fund_value',
  'goal_funds',
] as const

/** Identity of the request, used to tell when a result no longer matches what is on screen. */
export const fingerprint = (parts: unknown[]) => JSON.stringify(parts)
