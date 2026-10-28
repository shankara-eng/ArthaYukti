import type { AdvisorChange } from '../api/types'
import { formatMoney } from './money'
import { percentToSignedRate } from './trajectory'

export type GoalStatus = 'achievable' | 'at_risk' | 'underfunded' | 'cannot_assess'

/** Status is always written out as a word; the tone only adds colour to it. */
export const statusTone = (status: GoalStatus): 'good' | 'late' | 'muted' => (status === 'achievable' ? 'good' : status === 'cannot_assess' ? 'muted' : 'late')

export const TONE_CLASS = { good: 'text-ontime', late: 'text-late', muted: 'text-muted' } as const

/** An amount from the server, or a dash when it is unknown. Unknown is never shown as zero. */
export const money = (value: string | null | undefined): string => (value === null || value === undefined ? '–' : formatMoney(value))

export function signedMoney(value: string | null | undefined): string {
  if (value === null || value === undefined) return '–'
  const amount = formatMoney(value.replace('-', ''))
  return value.startsWith('-') ? `−${amount}` : Number(value) === 0 ? amount : `+${amount}`
}

export type BuilderKind = 'simulate_expense_change' | 'simulate_investment_change' | 'simulate_goal_change' | 'simulate_assumption_change'

export interface BuilderForm {
  kind: BuilderKind
  percent: string
  amount: string
  goalId: string
  newDate: string
  newAmount: string
  returnRate: string
}

export const emptyBuilder = (goalId = ''): BuilderForm => ({ kind: 'simulate_expense_change', percent: '5', amount: '', goalId, newDate: '', newAmount: '', returnRate: '' })

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/
const RUPEES = /^\d{1,12}(\.\d{1,2})?$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** The request for what was typed, or null when something is not valid. The server checks everything again. */
export function buildChange(form: BuilderForm): AdvisorChange | null {
  if (form.kind === 'simulate_expense_change') {
    const percent = form.percent.trim()
    if (!PERCENT.test(percent) || Number(percent) <= 0 || Number(percent) > 100) return null
    return { tool: 'simulate_expense_change', percent }
  }
  if (form.kind === 'simulate_investment_change') {
    const amount = form.amount.trim()
    if (!RUPEES.test(amount) || Number(amount) <= 0) return null
    return { tool: 'simulate_investment_change', amount: Number(amount).toFixed(2), frequency: 'monthly', step_up_percent: '0' }
  }
  if (form.kind === 'simulate_goal_change') {
    const date = form.newDate.trim()
    const amount = form.newAmount.trim()
    if (form.goalId === '' || (date === '' && amount === '')) return null
    if (date !== '' && !MONTH.test(date)) return null
    if (amount !== '' && (!RUPEES.test(amount) || Number(amount) <= 0)) return null
    return { tool: 'simulate_goal_change', goal_id: form.goalId, ...(date ? { target_date: date } : {}), ...(amount ? { target_amount_today: Number(amount).toFixed(2) } : {}) }
  }
  const rate = percentToSignedRate(form.returnRate)
  if (rate === null || rate.startsWith('-') || Number(rate) > 0.3) return null
  return { tool: 'simulate_assumption_change', name: 'savings_return_annual', new_value: rate }
}
