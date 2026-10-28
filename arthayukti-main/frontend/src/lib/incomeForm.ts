import type { IncomeStream } from '../api/types'
import { monthlyEquivalent, type Frequency } from './frequency'
import { fromPaise, toPaise } from './money'
import { percentToRate } from './onboarding'

export type IncomeFrequency = 'monthly' | 'quarterly' | 'yearly'

export interface StepRow {
  id: string
  year: string
  amount: string
}

/** What is typed in the income form. Nothing here reaches the plan until the person confirms it. */
export interface IncomeDraft {
  id: string
  name: string
  amount: string
  frequency: IncomeFrequency
  startYear: string
  endYear: string
  /** Annual Raise (%), as typed. */
  growth: string
  /** Raise Starts In Year, as typed. Empty means the year after the income starts. */
  growthStart: string
  steps: StepRow[]
}

export type Issue = 'name' | 'amount' | 'start' | 'end' | 'growth' | 'growthStart' | 'stepYear' | 'stepDuplicate' | 'stepAmount'

export interface DraftIssues {
  fields: Issue[]
  steps: Record<string, Issue[]>
}

const YEAR = /^\d{4}$/
const year = (text: string) => (YEAR.test(text.trim()) ? Number(text.trim()) : NaN)

export function blankDraft(id: string, firstYear: number): IncomeDraft {
  return { id, name: '', amount: '', frequency: 'monthly', startYear: String(firstYear), endYear: '', growth: '', growthStart: '', steps: [] }
}

/** A plain monthly stream (no start year) that the form can open as a schedule, keeping its forecast. */
export function legacyToDraft(stream: IncomeStream, firstYear: number, planGrowth: string): IncomeDraft {
  return {
    ...blankDraft(stream.id, firstYear),
    name: stream.label,
    amount: stream.monthly_net,
    growth: Number(planGrowth) > 0 ? String(Number(planGrowth) * 100) : '',
  }
}

export function streamToDraft(stream: IncomeStream): IncomeDraft {
  return {
    id: stream.id,
    name: stream.label,
    amount: stream.amount ?? stream.monthly_net,
    frequency: stream.frequency,
    startYear: String(stream.start_year),
    endYear: stream.end_year == null ? '' : String(stream.end_year),
    growth: stream.annual_growth ? String(Number(stream.annual_growth) * 100) : '',
    growthStart: stream.growth_start_year == null ? '' : String(stream.growth_start_year),
    steps: (stream.step_ups ?? []).map((step) => ({ id: step.id, year: String(step.year), amount: step.amount })),
  }
}

export function draftIssues(draft: IncomeDraft, firstYear: number): DraftIssues {
  const fields: Issue[] = []
  if (draft.name.trim() === '') fields.push('name')
  if (draft.amount === '' || toPaise(draft.amount) <= 0n) fields.push('amount')
  const start = year(draft.startYear)
  if (Number.isNaN(start) || start < firstYear) fields.push('start')
  const endText = draft.endYear.trim()
  const end = endText === '' ? null : year(endText)
  if (end !== null && (Number.isNaN(end) || Number.isNaN(start) || end < start)) fields.push('end')
  const raiseGiven = draft.growth.trim() !== ''
  if (raiseGiven && percentToRate(draft.growth) === null) fields.push('growth')
  const raiseStartText = draft.growthStart.trim()
  if (raiseStartText !== '') {
    const raiseStart = year(raiseStartText)
    const outside = Number.isNaN(raiseStart) || Number.isNaN(start) || raiseStart <= start || (end !== null && !Number.isNaN(end) && raiseStart > end)
    if (!raiseGiven || outside) fields.push('growthStart')
  }
  const steps: Record<string, Issue[]> = {}
  const seen = new Map<string, number>()
  draft.steps.forEach((step) => seen.set(step.year, (seen.get(step.year) ?? 0) + 1))
  for (const step of draft.steps) {
    const list: Issue[] = []
    const stepYear = year(step.year)
    if (Number.isNaN(stepYear) || Number.isNaN(start) || stepYear <= start || (end !== null && !Number.isNaN(end) && stepYear > end)) list.push('stepYear')
    if ((seen.get(step.year) ?? 0) > 1) list.push('stepDuplicate')
    if (step.amount === '' || toPaise(step.amount) <= 0n) list.push('stepAmount')
    if (list.length) steps[step.id] = list
  }
  return { fields, steps }
}

export const hasIssues = (issues: DraftIssues) => issues.fields.length > 0 || Object.keys(issues.steps).length > 0

export function draftToStream(draft: IncomeDraft): IncomeStream {
  const amount = fromPaise(toPaise(draft.amount))
  const raise = draft.growth.trim() ? (percentToRate(draft.growth) ?? '0.000000') : null
  return {
    id: draft.id,
    label: draft.name.trim(),
    // The server derives the monthly equivalent; sent for a consistent shape.
    monthly_net: monthlyEquivalent(amount, draft.frequency as Frequency),
    ends_after: null,
    amount,
    frequency: draft.frequency,
    start_year: Number(draft.startYear),
    ...(draft.endYear.trim() ? { end_year: Number(draft.endYear) } : {}),
    ...(raise ? { annual_growth: raise } : {}),
    ...(raise && draft.growthStart.trim() ? { growth_start_year: Number(draft.growthStart) } : {}),
    step_ups: draft.steps.map((step) => ({ id: step.id, year: Number(step.year), amount: fromPaise(toPaise(step.amount)) })),
  }
}

/** A projection period: a whole number of years from 1 to 50 (the engine projects at most 600 months), or null. */
export function parseYears(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null
  const years = Number(text.trim())
  return years >= 1 && years <= 50 ? years : null
}

/** The "No regular income entered" row a plan keeps when nothing was entered: it is not real income. */
export const isPlaceholder = (stream: IncomeStream) => stream.start_year == null && toPaise(stream.monthly_net) === 0n
