import type { CalculatorConfig, CalculatorInvestment } from '../api/types'
import { parseRupeeInput, toPaise } from './money'

/** What the forms hold: text exactly as typed. Nothing here is a number until buildConfig turns it into one. */
export interface StepDraft {
  id: string
  fromYear: string
  mode: 'amount' | 'percent'
  value: string
}

export interface InvestmentDraft {
  id: string
  name: string
  startMonth: string
  lumpSum: string
  recurring: boolean
  amount: string
  frequency: 'monthly' | 'quarterly' | 'annual'
  contributionYears: string
  steps: StepDraft[]
  growthYears: string
  growthPercent: string
  taxPercent: string
  taxMethod: 'gains' | 'total_amount'
  rateConvention: 'nominal_monthly' | 'effective_annual'
  inflationPercent: string
  afterAction: '' | 'hold' | 'continue' | 'reinvest'
  reinvestPercent: string
  include: boolean
}

export interface CalculatorDraft {
  mode: 'individual' | 'common_date'
  commonDate: string
  investments: InvestmentDraft[]
}

export type ProblemKey =
  | 'name'
  | 'month'
  | 'money'
  | 'needMoney'
  | 'years'
  | 'contributionLonger'
  | 'percentGrowth'
  | 'percentTax'
  | 'percentInflation'
  | 'percentStep'
  | 'stepYear'
  | 'commonDate'
  | 'decision'
  | 'rate'

/** Problems found while building the request, keyed `investmentId.field` (or `commonDate`). */
export type Problems = Record<string, ProblemKey>

export const MAX_INVESTMENTS = 20
export const MAX_STEPS = 10

let counter = 0
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}`

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function blankInvestment(startMonth: string = currentMonth(), inflationPercent = '0'): InvestmentDraft {
  return {
    id: newId('inv'),
    name: '',
    startMonth,
    lumpSum: '',
    recurring: true,
    amount: '',
    frequency: 'monthly',
    contributionYears: '10',
    steps: [],
    growthYears: '10',
    growthPercent: '12',
    taxPercent: '0',
    taxMethod: 'gains',
    rateConvention: 'nominal_monthly',
    inflationPercent,
    afterAction: '',
    reinvestPercent: '',
    include: true,
  }
}

export function blankCalculator(inflationPercent = '0'): CalculatorDraft {
  return { mode: 'individual', commonDate: '', investments: [{ ...blankInvestment(undefined, inflationPercent), name: 'Investment 1' }] }
}

/**
 * A percentage typed by a person as the engine's decimal fraction ("12.5" -> "0.125000").
 * Null when it is not a plain number with at most `places` decimals, or is outside min..max.
 */
export function percentToFraction(text: string, min: number, max: number, places = 2): string | null {
  const t = text.trim()
  if (!new RegExp(`^-?\\d{1,4}(\\.\\d{1,${places}})?$`).test(t)) return null
  const negative = t.startsWith('-')
  const [whole, fraction = ''] = t.replace('-', '').split('.')
  const hundredths = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'))
  const signed = negative ? -hundredths : hundredths
  const scale = 10n ** BigInt(places)
  if (signed < BigInt(min) * scale || signed > BigInt(max) * scale) return null
  // value% / 100 as a six-decimal fraction
  const micro = (signed * 10_000n) / scale // signed hundredths-of-a-percent scaled to millionths of the fraction
  const sign = micro < 0n ? '-' : ''
  const abs = micro < 0n ? -micro : micro
  return `${sign}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0')}`
}

const wholeYears = (text: string): number | null => {
  const t = text.trim()
  if (!/^\d{1,2}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 60 ? n : null
}

const money = (text: string): string | null => {
  const value = parseRupeeInput(text)
  if (value === null) return null
  return toPaise(value) <= 100_000_000_000n ? value : null // up to ₹100 crore, as the service allows
}

/** A six-decimal fraction cut to the four decimals the service accepts (a percentage with two decimals never needs more). */
const fourPlaces = (fraction: string): string => fraction.slice(0, fraction.length - 2)

const stepFraction = (text: string): string | null => {
  const f = percentToFraction(text, 0, 1000, 2)
  return f === null ? null : fourPlaces(f)
}

function buildInvestment(draft: InvestmentDraft, problems: Problems): CalculatorInvestment | null {
  const bad = (field: string, key: ProblemKey) => {
    problems[`${draft.id}.${field}`] = key
  }
  const startProblems = Object.keys(problems).length
  const name = draft.name.trim()
  if (!name || name.length > 80) bad('name', 'name')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.startMonth)) bad('startMonth', 'month')

  const lumpText = draft.lumpSum.trim()
  const lump = lumpText === '' ? '0.00' : money(lumpText)
  if (lump === null) bad('lumpSum', 'money')

  const growthYears = wholeYears(draft.growthYears)
  if (growthYears === null) bad('growthYears', 'years')
  const growth = percentToFraction(draft.growthPercent, -100, 100, 2)
  if (growth === null) bad('growthPercent', 'percentGrowth')
  const taxText = draft.taxPercent.trim() === '' ? '0' : draft.taxPercent
  const tax = percentToFraction(taxText, 0, 100, 2)
  if (tax === null) bad('taxPercent', 'percentTax')
  const inflText = draft.inflationPercent.trim() === '' ? '0' : draft.inflationPercent
  const inflation = percentToFraction(inflText, 0, 50, 2)
  if (inflation === null) bad('inflationPercent', 'percentInflation')

  let sip: CalculatorInvestment['sip'] = null
  if (draft.recurring) {
    const amount = money(draft.amount)
    if (amount === null || toPaise(amount) <= 0n) bad('amount', 'money')
    const years = wholeYears(draft.contributionYears)
    if (years === null) bad('contributionYears', 'years')
    else if (growthYears !== null && years > growthYears) bad('contributionYears', 'contributionLonger')
    const seen = new Set<number>()
    const steps: NonNullable<CalculatorInvestment['sip']>['step_ups'] = []
    for (const step of draft.steps) {
      const from = /^\d{1,2}$/.test(step.fromYear.trim()) ? Number(step.fromYear) : NaN
      const validYear = from >= 2 && from <= (years ?? 60) && !seen.has(from)
      seen.add(from)
      if (!validYear) bad(`step.${step.id}.fromYear`, 'stepYear')
      if (step.mode === 'amount') {
        const value = money(step.value)
        if (value === null || toPaise(value) <= 0n) bad(`step.${step.id}.value`, 'money')
        else if (validYear) steps.push({ from_year: from, mode: 'amount', amount: value })
      } else {
        const value = stepFraction(step.value)
        if (value === null) bad(`step.${step.id}.value`, 'percentStep')
        else if (validYear) steps.push({ from_year: from, mode: 'percent', percent: value })
      }
    }
    if (amount !== null && years !== null && Object.keys(problems).length === startProblems) {
      sip = { amount, frequency: draft.frequency, contribution_years: years, step_ups: steps.sort((a, b) => a.from_year - b.from_year) }
    }
  } else if (lump !== null && toPaise(lump) <= 0n) {
    bad('lumpSum', 'needMoney')
  }

  let afterMaturity: CalculatorInvestment['after_maturity'] = null
  if (draft.afterAction === 'hold' || draft.afterAction === 'continue') afterMaturity = { action: draft.afterAction }
  else if (draft.afterAction === 'reinvest') {
    const rate = percentToFraction(draft.reinvestPercent, -100, 100, 2)
    if (rate === null) bad('reinvestPercent', 'rate')
    else afterMaturity = { action: 'reinvest', rate }
  }

  if (Object.keys(problems).length !== startProblems) return null
  return {
    id: draft.id,
    name,
    start_month: draft.startMonth,
    lump_sum: lump as string,
    ...(sip ? { sip } : {}),
    growth_years: growthYears as number,
    annual_growth: growth as string,
    tax_rate: fourPlaces(tax as string),
    tax_method: draft.taxMethod,
    rate_convention: draft.rateConvention,
    inflation_rate: inflation as string,
    ...(afterMaturity ? { after_maturity: afterMaturity } : {}),
  }
}

export type Built = { config: CalculatorConfig; problems: null } | { config: null; problems: Problems }

/** Turns the forms into one request, or says which fields are wrong. Nothing invalid is ever sent. */
export function buildConfig(draft: CalculatorDraft): Built {
  const problems: Problems = {}
  const investments: CalculatorInvestment[] = []
  for (const item of draft.investments) {
    const built = buildInvestment(item, problems)
    if (built) investments.push(built)
  }
  if (draft.mode === 'common_date' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.commonDate)) problems.commonDate = 'commonDate'
  if (Object.keys(problems).length > 0) return { config: null, problems }
  const ticked = draft.investments.filter((item) => item.include).map((item) => item.id)
  const config: CalculatorConfig = {
    mode: draft.mode,
    ...(draft.mode === 'common_date' ? { common_date: draft.commonDate } : {}),
    investments,
    compile_ids: ticked,
  }
  return { config, problems: null }
}

/** The forms for a config that was saved earlier (the reverse of buildConfig). */
export function draftFromConfig(config: CalculatorConfig): CalculatorDraft {
  const ticked = config.compile_ids ?? config.investments.map((item) => item.id)
  const percent = (fraction: string) => {
    const value = Number(fraction) * 100
    return String(Math.round(value * 10_000) / 10_000)
  }
  return {
    mode: config.mode ?? 'individual',
    commonDate: config.common_date ?? '',
    investments: config.investments.map((item) => ({
      id: item.id,
      name: item.name,
      startMonth: item.start_month,
      lumpSum: item.lump_sum && Number(item.lump_sum) > 0 ? item.lump_sum.replace(/\.00$/, '') : '',
      recurring: Boolean(item.sip),
      amount: item.sip ? item.sip.amount.replace(/\.00$/, '') : '',
      frequency: item.sip?.frequency ?? 'monthly',
      contributionYears: item.sip ? String(item.sip.contribution_years) : '10',
      steps: (item.sip?.step_ups ?? []).map((step) => ({
        id: newId('step'),
        fromYear: String(step.from_year),
        mode: step.mode ?? 'amount',
        value: step.mode === 'percent' ? percent(step.percent ?? '0') : (step.amount ?? '').replace(/\.00$/, ''),
      })),
      growthYears: String(item.growth_years),
      growthPercent: percent(item.annual_growth),
      taxPercent: percent(item.tax_rate ?? '0'),
      taxMethod: item.tax_method ?? 'gains',
      rateConvention: item.rate_convention ?? 'nominal_monthly',
      inflationPercent: percent(item.inflation_rate ?? '0'),
      afterAction: item.after_maturity?.action ?? '',
      reinvestPercent: item.after_maturity?.rate ? percent(item.after_maturity.rate) : '',
      include: ticked.includes(item.id),
    })),
  }
}
