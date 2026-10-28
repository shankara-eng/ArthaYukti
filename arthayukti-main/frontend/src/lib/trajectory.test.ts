import { describe, expect, it } from 'vitest'
import type { TrajectoryBalances, TrajectoryResult } from '../api/types'
import { buildRequest, defaultChoices, editRoute, parseAge, percentToGrowthRate, percentToSignedRate, series, timeline } from './trajectory'

describe('percentToSignedRate', () => {
  it('turns a percentage into the API decimal string, exactly', () => {
    expect(percentToSignedRate('12')).toBe('0.120000')
    expect(percentToSignedRate('7.5')).toBe('0.075000')
    expect(percentToSignedRate('0')).toBe('0.000000')
    expect(percentToSignedRate('-3.25')).toBe('-0.032500')
    expect(percentToSignedRate('50')).toBe('0.500000')
    expect(percentToSignedRate('-50')).toBe('-0.500000')
  })
  it('refuses what is not a rate in range', () => {
    for (const bad of ['', 'abc', '50.01', '-50.01', '51', '1.234', '1,5', '12%', '--2', ' ']) expect(percentToSignedRate(bad)).toBeNull()
  })
  it('does not turn a negative zero into a minus sign', () => {
    expect(percentToSignedRate('-0')).toBe('0.000000')
  })
})

describe('percentToGrowthRate', () => {
  it('is zero when empty, and refuses negatives and more than 30', () => {
    expect(percentToGrowthRate('')).toBe('0.000000')
    expect(percentToGrowthRate('10')).toBe('0.100000')
    expect(percentToGrowthRate('30')).toBe('0.300000')
    expect(percentToGrowthRate('31')).toBeNull()
    expect(percentToGrowthRate('-1')).toBeNull()
  })
})

describe('parseAge', () => {
  it('accepts whole ages from 1 to 120', () => {
    expect(['1', ' 45 ', '120', '0', '121', '', '4.5', 'x'].map(parseAge)).toEqual([1, 45, 120, null, null, null, null, null])
  })
})

describe('buildRequest', () => {
  it('asks for the years as months, with the baseline excluding any goal', () => {
    const { request, problems } = buildRequest({ ...defaultChoices(), goalIds: ['home'] })
    expect(problems).toEqual([])
    expect(request.horizon).toEqual({ months: 120 })
    expect(request.view).toBe('baseline')
    expect(request.selected_goal_ids).toEqual([]) // the baseline never carries a goal, even one left ticked
    expect(request.return_assumptions).toEqual([])
    expect(request.premium_growth_annual).toBe('0.000000')
    expect(request.premiums_in_spending).toBe('auto')
  })
  it('asks for an age, and says when the age is not one', () => {
    expect(buildRequest({ ...defaultChoices(), horizon: { kind: 'age', age: '55' } }).request.horizon).toEqual({ target_age: 55 })
    expect(buildRequest({ ...defaultChoices(), horizon: { kind: 'age', age: '' } }).problems).toContain('age')
  })
  it('sends only the return assumptions the person typed, and reports a bad one', () => {
    const choices = { ...defaultChoices(), rates: { market_investments: '12', physical_and_other_assets: '', insurance_fund_value: '  ' } }
    expect(buildRequest(choices).request.return_assumptions).toEqual([{ scope: 'class', key: 'market_investments', annual_rate: '0.120000' }])
    const bad = buildRequest({ ...defaultChoices(), rates: { market_investments: 'lots' } })
    expect(bad.problems).toContain('rate')
    expect(bad.request.return_assumptions).toEqual([])
  })
  it('carries selected goals, the effects chosen for them and links the person confirmed', () => {
    const choices = {
      ...defaultChoices(),
      view: 'selected_goals' as const,
      goalIds: ['a', 'b', 'c'],
      goalEffects: { a: { effect: 'spend' as const }, b: { effect: 'debt_reduction' as const, liabilityId: 'l1' }, zz: { effect: 'hold' as const } },
      links: { c0: 'l1' },
      premiumGrowth: '5',
      premiumRule: 'no' as const,
    }
    const { request } = buildRequest(choices)
    expect(request.selected_goal_ids).toEqual(['a', 'b', 'c'])
    expect(request.goal_effects).toEqual([
      { goal_id: 'a', effect: 'spend' },
      { goal_id: 'b', effect: 'debt_reduction', liability_id: 'l1' },
    ]) // an effect for a goal that is not selected is not sent
    expect(request.linked_commitments).toEqual([{ commitment_id: 'c0', liability_id: 'l1' }])
    expect(request.premium_growth_annual).toBe('0.050000')
    expect(request.premiums_in_spending).toBe('no')
  })
})

describe('editRoute', () => {
  it('only names pages that exist', () => {
    expect(editRoute('debts')).toBe('debts')
    expect(editRoute('goals')).toBe('goals')
    expect(editRoute('https://evil.example')).toBeNull()
    expect(editRoute(null)).toBeNull()
  })
})

const balances = (netWorth: string): TrajectoryBalances => ({
  cash: netWorth,
  deposits_and_investment_accounts: '0.00',
  market_investments: '0.00',
  retirement_and_fixed_income: '0.00',
  physical_and_other_assets: '0.00',
  insurance_fund_value: '0.00',
  goal_funds: '0.00',
  total_assets: netWorth,
  loans: '0.00',
  unfunded_shortfall: '0.00',
  total_liabilities: '0.00',
  net_worth: netWorth,
})

const event = (month: string, kind: string, label: string, cash = '0.00') => ({
  month,
  kind,
  label,
  source_id: null,
  cash_delta: cash,
  asset_delta: '0.00',
  liability_delta: '0.00',
  net_worth_effect: cash,
  principal: null,
  interest: null,
  note: '',
})

const result = {
  as_of: '2027-01',
  opening_balances: balances('100.00'),
  summary: { projected_debt_free_dates: [{ id: 'l1', name: 'Car', month: '2027-03', status: 'ok', reason: null, balance_now: '1.00', interest_in_period: '0.00' }, { id: 'l2', name: 'Friend', month: null, status: 'no_payment', reason: 'x', balance_now: '1.00', interest_in_period: '0.00' }] },
  monthly_ledger: [
    { month: '2027-01', closing_balances: balances('110.00'), income_events: [event('2027-01', 'income', 'Planned income')], insurance_events: [event('2027-01', 'premium', 'Term', '-50.00')], other_events: [], expense_events: [], debt_events: [], investment_events: [], deposit_events: [], goal_events: [] },
    { month: '2027-02', closing_balances: balances('120.00'), income_events: [], insurance_events: [event('2027-02', 'maturity_benefit', 'Policy', '9.00')], other_events: [event('2027-02', 'unfunded_shortfall', 'Short', '3.00'), event('2027-02', 'unfunded_shortfall', 'Short again', '3.00')], expense_events: [], debt_events: [], investment_events: [], deposit_events: [], goal_events: [event('2027-02', 'goal_spending', 'Spent: Education')] },
  ],
} as unknown as TrajectoryResult

describe('series', () => {
  it('is the opening position followed by every month closing', () => {
    expect(series(result).map((p) => [p.month, p.balances.net_worth])).toEqual([
      ['2027-01', '100.00'],
      ['2027-01', '110.00'],
      ['2027-02', '120.00'],
    ])
  })
})

describe('timeline', () => {
  it('lists scheduled events and payoffs in date order, the first shortfall once, and never an ordinary income event', () => {
    const items = timeline(result)
    expect(items.map((i) => `${i.month} ${i.kind}`)).toEqual([
      '2027-01 premium',
      '2027-02 goal_spending',
      '2027-02 maturity_benefit',
      '2027-02 unfunded_shortfall',
      '2027-03 debt_free',
    ])
    expect(items.some((i) => i.kind === 'income')).toBe(false)
    expect(items.some((i) => i.label === 'Friend')).toBe(false) // an unknown payoff is not invented
  })
})

describe('spending source and inflation', () => {
  it('sends the plan as the spending source and no inflation unless the person chose them', () => {
    const { request, problems } = buildRequest(defaultChoices())
    expect(problems).toEqual([])
    expect(request.spending_source).toBe('plan')
    expect('inflation_annual' in request).toBe(false)
  })
  it('sends the Expenditure plans source and a typed inflation rate as an exact decimal string', () => {
    const { request, problems } = buildRequest({ ...defaultChoices(), spendingSource: 'expenditure_plans', inflation: '6.5' })
    expect(problems).toEqual([])
    expect(request.spending_source).toBe('expenditure_plans')
    expect(request.inflation_annual).toBe('0.065000')
  })
  it('names a bad inflation rate instead of sending it', () => {
    for (const bad of ['abc', '-1', '31']) expect(buildRequest({ ...defaultChoices(), inflation: bad }).problems).toContain('inflation')
  })
})
