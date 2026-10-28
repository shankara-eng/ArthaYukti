import type { PortfolioHoldingCreate } from '../api/types'
import type { Language } from './months'

export type Exchange = 'NSE' | 'BSE'
export type FormIssue = 'symbol' | 'quantity' | 'price' | 'date'
export const RANGES = ['1m', '3m', '6m', '1y', 'all'] as const
export type Range = (typeof RANGES)[number]

/** Mirrors the server's own checks so a mistake is shown beside its field; the server still decides. */
const SYMBOL = /^[A-Z0-9][A-Z0-9&-]{0,19}$/

export interface HoldingForm {
  symbol: string
  exchange: Exchange
  company: string
  quantity: string
  price: string
  date: string
}

export const blankForm = (): HoldingForm => ({ symbol: '', exchange: 'NSE', company: '', quantity: '', price: '', date: '' })

const today = () => new Date().toISOString().slice(0, 10)

/** A real calendar date written YYYY-MM-DD, not before 1990 and not in the future. */
export function validDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return false
  return text >= '1990-01-01' && text <= today()
}

export function validQuantity(text: string): boolean {
  return /^[1-9]\d{0,9}$/.test(text.trim()) && Number(text.trim()) <= 1_000_000_000
}

export function validPrice(text: string): boolean {
  const t = text.trim()
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(t)) return false
  const n = Number(t)
  return n > 0 && n <= 10_000_000
}

export function formIssues(form: HoldingForm, options: { symbol?: boolean; date?: boolean } = { symbol: true, date: true }): FormIssue[] {
  const issues: FormIssue[] = []
  if (options.symbol !== false && !SYMBOL.test(form.symbol.trim().toUpperCase())) issues.push('symbol')
  if (!validQuantity(form.quantity)) issues.push('quantity')
  if (!validPrice(form.price)) issues.push('price')
  if (options.date !== false && form.date.trim() !== '' && !validDate(form.date.trim())) issues.push('date')
  return issues
}

export function toCreateBody(form: HoldingForm): PortfolioHoldingCreate {
  return {
    symbol: form.symbol.trim().toUpperCase(),
    exchange: form.exchange,
    ...(form.company.trim() ? { company_name: form.company.trim() } : {}),
    quantity: form.quantity.trim(),
    average_price: form.price.trim(),
    ...(form.date.trim() ? { purchase_date: form.date.trim() } : {}),
  }
}

/** "10.000000" -> "10", "2.500000" -> "2.5". Quantities arrive as decimal strings. */
export function trimQuantity(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity
}

/** A signed percentage for display: "+20.00%", "-9.98%". */
export function signedPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return '–'
  return `${value.startsWith('-') ? '' : '+'}${value}%`
}

/** Local date and time of a server timestamp (UTC), in the chosen language. */
export function whenText(iso: string | null | undefined, language: Language): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Minutes since a server timestamp, or null when there is none. */
export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  return Number.isNaN(time) ? null : Math.max(0, Math.round((now - time) / 60000))
}

export const AUTO_REFRESH_AFTER_MINUTES = 15
