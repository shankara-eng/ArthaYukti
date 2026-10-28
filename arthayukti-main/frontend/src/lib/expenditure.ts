import type { Expense } from '../api/types'

export type SpendFrequency = 'monthly' | 'quarterly' | 'yearly'
export const SPEND_FREQUENCIES: SpendFrequency[] = ['monthly', 'quarterly', 'yearly']

/** What the editor holds: text exactly as typed. Nothing is a number until `toLine`. */
export interface SpendRow {
  id: string
  name: string
  category: string
  amount: string // whole rupees as "12000.00", or ""
  frequency: SpendFrequency
  essential: boolean
  start: string // YYYY-MM or ""
  end: string
  growth: string // percent as typed, or ""
}

export type SpendIssue = 'name' | 'amount' | 'end' | 'growth'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * A yearly growth percentage such as "6", "7.25" or "-2" as the engine's six-decimal rate string.
 * Null when it is not a plain number with at most two decimals between -10 and 30.
 */
export function percentToGrowth(percent: string): string | null {
  const text = percent.trim()
  const match = /^(-?)(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  const hundredths = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0')
  const negative = match[1] === '-' && hundredths !== 0n
  if (negative ? hundredths > 1000n : hundredths > 3000n) return null
  const micro = hundredths * 100n
  return `${negative ? '-' : ''}${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`
}

/** "0.065000" or "-0.050000" as the percentage a person reads: "6.5", "-5". */
export function growthToPercent(rate: string): string {
  const negative = rate.startsWith('-')
  const [whole, fraction = ''] = rate.replace('-', '').split('.')
  const hundredths = BigInt(whole) * 10000n + BigInt(fraction.padEnd(6, '0').slice(0, 4))
  const percentWhole = hundredths / 100n
  const percentFraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  const body = percentFraction ? `${percentWhole}.${percentFraction}` : `${percentWhole}`
  return negative && hundredths !== 0n ? `-${body}` : body
}

export function toRow(line: Expense): SpendRow {
  const scheduled = Boolean(line.start_month)
  return {
    id: line.id,
    name: line.label,
    category: line.category ?? '',
    amount: scheduled && line.amount ? line.amount : line.monthly,
    frequency: (line.frequency ?? 'monthly') as SpendFrequency,
    essential: line.essential,
    start: line.start_month ?? '',
    end: line.end_month ?? '',
    growth: line.annual_growth ? growthToPercent(line.annual_growth) : '',
  }
}

export function issuesFor(row: SpendRow): SpendIssue[] {
  const issues: SpendIssue[] = []
  if (row.name.trim() === '') issues.push('name')
  if (row.amount === '' || /^0+(\.0+)?$/.test(row.amount)) issues.push('amount')
  if (row.start && row.end && MONTH.test(row.start) && MONTH.test(row.end) && row.end < row.start) issues.push('end')
  if (row.growth.trim() !== '' && percentToGrowth(row.growth) === null) issues.push('growth')
  return issues
}

/**
 * The line the engine takes. A monthly line with no dates stays a plain line, exactly as before. Anything else is
 * a scheduled line; one that gives no start month starts with the plan, which is what "already happening" means.
 */
export function toLine(row: SpendRow, planStart: string): Expense {
  const growth = row.growth.trim() === '' ? null : percentToGrowth(row.growth)
  const base: Expense = {
    id: row.id,
    label: row.name.trim(),
    monthly: row.amount,
    essential: row.essential,
    ...(row.category.trim() ? { category: row.category.trim() } : {}),
    ...(growth !== null ? { annual_growth: growth } : {}),
  }
  const scheduled = row.start !== '' || row.end !== '' || row.frequency !== 'monthly'
  if (!scheduled) return base
  return {
    ...base,
    amount: row.amount,
    frequency: row.frequency,
    start_month: row.start || planStart,
    ...(row.end ? { end_month: row.end } : {}),
  }
}

export function sameLines(a: Expense[], b: Expense[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
