import type { SpendingChangeInput, SpendingPlan, SpendingPlanInput } from '../api/types'

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MAX_RATE_PERCENT = 30

/** "0.060000" becomes "6%". Display only: the server holds the exact rate. */
export function ratePercentText(rate: string): string {
  const [whole, fraction = ''] = rate.split('.')
  const digits = (whole.replace(/^-/, '') + fraction.padEnd(6, '0').slice(0, 6)).replace(/^0+(?=\d)/, '')
  const padded = digits.padStart(5, '0')
  const percent = `${padded.slice(0, -4).replace(/^0+(?=\d)/, '')}.${padded.slice(-4)}`.replace(/\.?0+$/, '')
  return `${percent}%`
}

/** A percentage the person typed ("6.5") as the decimal-string rate the server wants ("0.065000"), without a float. */
export function percentToRate(text: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(text.trim())
  if (!match) return null
  const scaled = BigInt(match[1]) * 10000n + BigInt((match[2] ?? '').padEnd(4, '0') || '0')
  if (scaled > BigInt(MAX_RATE_PERCENT) * 10000n) return null
  return `${scaled / 1000000n}.${(scaled % 1000000n).toString().padStart(6, '0')}`
}

export type Frequency = 'monthly' | 'yearly'
export type Duration = 'today_forever' | 'year_forever' | 'range'

export interface PlanDraft {
  category: string
  name: string
  amount: string
  frequency: Frequency
  duration: Duration
  startYear: string
  startMonth: string
  endYear: string
  endMonth: string
  customRate: boolean
  rate: string
}

export function blankDraft(today: Date = new Date()): PlanDraft {
  return {
    category: '',
    name: '',
    amount: '',
    frequency: 'monthly',
    duration: 'today_forever',
    startYear: String(today.getFullYear()),
    startMonth: String(today.getMonth() + 1),
    endYear: String(today.getFullYear()),
    endMonth: String(today.getMonth() + 1),
    customRate: false,
    rate: '',
  }
}

export function draftFromPlan(plan: SpendingPlan): PlanDraft {
  const base = blankDraft()
  return {
    ...base,
    category: plan.category,
    name: plan.name ?? '',
    amount: plan.amount,
    frequency: plan.frequency,
    duration: plan.duration,
    startYear: String(plan.start_year),
    startMonth: plan.start_month ? String(plan.start_month) : base.startMonth,
    endYear: plan.end_year ? String(plan.end_year) : base.endYear,
    endMonth: plan.end_month ? String(plan.end_month) : base.endMonth,
    customRate: plan.inflation_override !== null,
    rate: plan.inflation_override === null ? '' : ratePercentText(plan.inflation_override).replace('%', ''),
  }
}

export type DraftProblem = 'category' | 'amount' | 'rate'

/** The request for a draft, or what is missing. Dates are checked by the server, which knows today's date. */
export function draftToInput(draft: PlanDraft): { body: SpendingPlanInput } | { problems: DraftProblem[] } {
  const problems: DraftProblem[] = []
  if (!draft.category) problems.push('category')
  if (!draft.amount || Number(draft.amount) <= 0) problems.push('amount')
  const rate = draft.customRate ? percentToRate(draft.rate) : null
  if (draft.customRate && rate === null) problems.push('rate')
  if (problems.length > 0) return { problems }
  const yearly = draft.frequency === 'yearly'
  const body: SpendingPlanInput = {
    category: draft.category,
    amount: draft.amount.includes('.') ? draft.amount : `${draft.amount}.00`,
    frequency: draft.frequency,
    duration: draft.duration,
    inflation_override: rate,
  }
  if (draft.name.trim()) body.name = draft.name.trim()
  if (draft.duration !== 'today_forever') body.start_year = Number(draft.startYear)
  if (draft.duration === 'range') {
    body.end_year = Number(draft.endYear)
    if (!yearly) {
      body.start_month = Number(draft.startMonth)
      body.end_month = Number(draft.endMonth)
    }
  }
  return { body }
}

export interface ChangeDraft {
  kind: 'permanent' | 'temporary'
  year: string
  month: string
  endYear: string
  endMonth: string
  amount: string
}

export function blankChange(today: Date = new Date()): ChangeDraft {
  const year = String(today.getFullYear())
  const month = String(today.getMonth() + 1)
  return { kind: 'permanent', year, month, endYear: year, endMonth: month, amount: '' }
}

export function changeToInput(draft: ChangeDraft, frequency: Frequency): SpendingChangeInput | null {
  if (!draft.amount || Number(draft.amount) <= 0) return null
  const body: SpendingChangeInput = {
    kind: draft.kind,
    effective_year: Number(draft.year),
    amount: draft.amount.includes('.') ? draft.amount : `${draft.amount}.00`,
  }
  if (frequency === 'monthly') body.effective_month = Number(draft.month)
  if (draft.kind === 'temporary') {
    body.end_year = Number(draft.endYear)
    if (frequency === 'monthly') body.end_month = Number(draft.endMonth)
  }
  return body
}

/** "March 2028" for a monthly plan, "2028" for a yearly one. */
export function periodText(year: number, month: number | null): string {
  return month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year)
}

export function durationText(plan: SpendingPlan): string {
  const start = periodText(plan.start_year, plan.start_month)
  if (plan.end_year === null) return `From ${start}, ongoing`
  return `${start} to ${periodText(plan.end_year, plan.end_month)}`
}

export function yearOptions(from: number, count = 61): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => ({ value: String(from + index), label: String(from + index) }))
}

export function monthOptions(): { value: string; label: string }[] {
  return MONTH_NAMES.map((label, index) => ({ value: String(index + 1), label }))
}
