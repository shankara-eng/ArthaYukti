import { describe, expect, it } from 'vitest'
import { advisorCopy } from '../i18n/advisor'
import { buildChange, emptyBuilder, money, signedMoney, statusTone, type BuilderForm } from './advisor'

const form = (patch: Partial<BuilderForm>): BuilderForm => ({ ...emptyBuilder('home'), ...patch })

describe('building a scenario request', () => {
  it('accepts a percentage up to 100 and refuses anything else', () => {
    expect(buildChange(form({ percent: '7.5' }))).toEqual({ tool: 'simulate_expense_change', percent: '7.5' })
    for (const bad of ['', '0', '100.5', '-3', 'abc', '1e2', '5.123']) expect(buildChange(form({ percent: bad }))).toBeNull()
  })

  it('needs a positive amount for an investment, sent as decimal text', () => {
    expect(buildChange(form({ kind: 'simulate_investment_change', amount: '2000' }))).toMatchObject({ tool: 'simulate_investment_change', amount: '2000.00', frequency: 'monthly' })
    expect(buildChange(form({ kind: 'simulate_investment_change', amount: '0' }))).toBeNull()
    expect(buildChange(form({ kind: 'simulate_investment_change', amount: '' }))).toBeNull()
  })

  it('needs a goal and a real new month or amount', () => {
    expect(buildChange(form({ kind: 'simulate_goal_change', newDate: '2035-06' }))).toEqual({ tool: 'simulate_goal_change', goal_id: 'home', target_date: '2035-06' })
    expect(buildChange(form({ kind: 'simulate_goal_change', newAmount: '3000000' }))).toEqual({ tool: 'simulate_goal_change', goal_id: 'home', target_amount_today: '3000000.00' })
    for (const patch of [{ newDate: '' }, { newDate: '2035-13' }, { newDate: '2035-1' }, { goalId: '', newDate: '2035-06' }]) expect(buildChange(form({ kind: 'simulate_goal_change', ...patch }))).toBeNull()
  })

  it('turns a yearly return in percent into the decimal fraction the server wants, within 0 to 30', () => {
    expect(buildChange(form({ kind: 'simulate_assumption_change', returnRate: '6' }))).toEqual({ tool: 'simulate_assumption_change', name: 'savings_return_annual', new_value: '0.060000' })
    for (const bad of ['', '-1', '31', 'x']) expect(buildChange(form({ kind: 'simulate_assumption_change', returnRate: bad }))).toBeNull()
  })
})

describe('showing figures', () => {
  it('shows an unknown amount as a dash, never as zero', () => {
    expect(money(null)).toBe('–')
    expect(money(undefined)).toBe('–')
    expect(money('0.00')).toBe('₹0')
    expect(signedMoney(null)).toBe('–')
  })

  it('signs a change', () => {
    expect(signedMoney('12000.00')).toBe('+₹12,000')
    expect(signedMoney('-12000.00')).toBe('−₹12,000')
    expect(signedMoney('0.00')).toBe('₹0')
  })

  it('tones only the statuses that need attention, and the words exist in both languages', () => {
    expect(statusTone('achievable')).toBe('good')
    expect(statusTone('at_risk')).toBe('late')
    expect(statusTone('underfunded')).toBe('late')
    expect(statusTone('cannot_assess')).toBe('muted')
    for (const language of ['en', 'hi'] as const) {
      expect(Object.keys(advisorCopy[language].goals.status).sort()).toEqual(['achievable', 'at_risk', 'cannot_assess', 'underfunded'])
      expect(advisorCopy[language].goals.saved('X')).toContain('X')
    }
  })
})
