import { describe, expect, it } from 'vitest'
import type { FixOption, SampleDetail, Scenario } from '../api/types'
import { scenarioFor, withFix } from './scenarios'

const noIncome: Scenario = {
  name: 'No income',
  extra_monthly_savings: '0.00',
  events: [
    { type: 'income_change', stream_id: null, from_month: '2027-01', to_month: '2027-06', multiplier: '0' },
  ],
}
const expense: Scenario = {
  name: 'Expense',
  extra_monthly_savings: '0.00',
  events: [{ type: 'one_time_expense', month: '2027-01', amount: '360000.00', label: 'Repair' }],
}
const sample = { scenarios: [noIncome, expense] } as unknown as SampleDetail

function fix(delta: Partial<Scenario>): FixOption {
  return {
    scenario_delta: { name: 'fix', extra_monthly_savings: '0.00', ...delta },
  } as unknown as FixOption
}

describe('scenarioFor', () => {
  it('has no scenario when everything is normal', () => {
    expect(scenarioFor(sample, 'normal')).toBeUndefined()
  })

  it('finds the preset for each situation by its events', () => {
    expect(scenarioFor(sample, 'no_income')?.name).toBe('No income')
    expect(scenarioFor(sample, 'expense')?.name).toBe('Expense')
  })
})

describe('withFix', () => {
  it('leaves the scenario alone without a fix', () => {
    expect(withFix(expense, null)).toBe(expense)
    expect(withFix(undefined, null)).toBeUndefined()
  })

  it('adds extra savings to what is already there', () => {
    const base: Scenario = { ...expense, extra_monthly_savings: '1000.00' }
    const result = withFix(base, fix({ extra_monthly_savings: '7500.00' }))
    expect(result?.extra_monthly_savings).toBe('8500.00')
    expect(result?.events).toEqual(expense.events)
  })

  it('builds a scenario from nothing when there is no situation', () => {
    const result = withFix(undefined, fix({ extra_monthly_savings: '7500.00' }))
    expect(result?.extra_monthly_savings).toBe('7500.00')
  })

  it('merges goal overrides by goal', () => {
    const base: Scenario = {
      ...expense,
      goal_overrides: [{ goal_id: 'home', target_amount_today: '2000000.00' }],
    }
    const result = withFix(base, fix({ goal_overrides: [{ goal_id: 'home', target_date: '2031-03' }] }))
    expect(result?.goal_overrides).toEqual([
      { goal_id: 'home', target_amount_today: '2000000.00', target_date: '2031-03' },
    ])
  })
})
