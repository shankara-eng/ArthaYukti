import { describe, expect, it } from 'vitest'
import { monthlyEquivalent } from './frequency'
import { buildPlan, emptyDraft, goalIssues, incomeIssues, percentToRate, preview, type AccountDraft, type GoalDraft } from './onboarding'

const goal = (over: Partial<GoalDraft>): GoalDraft => ({ id: 'g', kind: 'other', label: 'Goal', amount: '100000.00', date: '2029-01', basis: 'today', tier: 3, saved: '', ...over })

describe('turning typed amounts into monthly ones', () => {
  it('converts each interval and rounds half-up to the paisa', () => {
    expect(monthlyEquivalent('12000.00', 'monthly')).toBe('12000.00')
    expect(monthlyEquivalent('12000.00', 'yearly')).toBe('1000.00')
    expect(monthlyEquivalent('3000.00', 'quarterly')).toBe('1000.00')
    expect(monthlyEquivalent('6000.00', 'half_yearly')).toBe('1000.00')
    expect(monthlyEquivalent('1000.00', 'weekly')).toBe('4333.33')
    expect(monthlyEquivalent('1000.00', 'fortnightly')).toBe('2166.67')
  })
})

describe('yearly rates', () => {
  it('turns a percentage into the engine’s six-decimal rate, without floats', () => {
    expect(percentToRate('5')).toBe('0.050000')
    expect(percentToRate('7.25')).toBe('0.072500')
    expect(percentToRate('0')).toBe('0.000000')
    expect(percentToRate('30')).toBe('0.300000')
  })
  it('refuses anything the engine would not accept', () => {
    for (const bad of ['', 'abc', '31', '-1', '5.123', '100']) expect(percentToRate(bad)).toBeNull()
  })
})

describe('building the plan the engine takes', () => {
  const base = () => {
    const draft = emptyDraft('2027-01')
    draft.income = [
      { id: 'i1', label: 'Salary', amount: '90000', frequency: 'monthly', endYear: '', growthPercent: '', include: true },
      { id: 'i2', label: 'Left out', amount: '5000', frequency: 'monthly', endYear: '', growthPercent: '', include: false },
    ]
    draft.expenses = [
      { id: 'e1', label: 'Rent', amount: '30000', frequency: 'monthly', essential: true, include: true },
      { id: 'e2', label: 'Phone', amount: '2400', frequency: 'yearly', essential: false, include: true },
      { id: 'e3', label: 'Blank category', amount: '', frequency: 'monthly', essential: true, include: true },
    ]
    draft.liabilities = [
      { id: 'l1', name: 'Car loan', kind: 'auto_loan', balance: '300000', ratePercent: '9', payment: '8000', remainingMonths: '36' },
      { id: 'l2', name: 'Unknown tenure', kind: 'other', balance: '50000', ratePercent: '', payment: '2000', remainingMonths: '' },
    ]
    draft.goals = [goal({ id: 'a', label: 'Holiday', tier: 4 }), goal({ id: 'b', label: 'Emergency', kind: 'emergency_fund', tier: 1 }), goal({ id: 'c', label: 'Home', kind: 'home', tier: 2, basis: 'future' })]
    return draft
  }

  it('includes only what was ticked and filled, with monthly amounts', () => {
    const { plan } = buildPlan(base(), 'Asha')
    expect(plan?.income_streams.map((s) => [s.label, s.monthly_net])).toEqual([['Salary', '90000.00']])
    expect(plan?.expenses?.map((e) => [e.label, e.monthly, e.essential])).toEqual([
      ['Rent', '30000.00', true],
      ['Phone', '200.00', false],
    ])
  })

  it('puts only loans with a known tenure into the plan, so unknown ones are not guessed', () => {
    const { plan } = buildPlan(base(), 'Asha')
    expect(plan?.commitments?.map((c) => [c.label, c.monthly_payment, c.remaining_months])).toEqual([['Car loan', '8000.00', 36]])
  })

  it('orders goals by tier, then by the order given, as unique priorities 1..n', () => {
    const { plan } = buildPlan(base(), 'Asha')
    expect(plan?.goals.map((g) => [g.label, g.priority])).toEqual([['Emergency', 1], ['Home', 2], ['Holiday', 3]])
  })

  it('applies yearly inflation only to goals entered in today’s money', () => {
    const { plan } = buildPlan(base(), 'Asha')
    expect(plan?.assumptions.general_inflation_annual).toBe('0.050000')
    expect(Object.fromEntries(plan!.goals.map((g) => [g.label, g.inflation_linked]))).toEqual({ Emergency: true, Home: false, Holiday: true })
  })

  it('holds income and spending constant: no growth is invented', () => {
    const { plan } = buildPlan(base(), 'Asha')
    expect(plan?.assumptions).toMatchObject({ income_growth_annual: '0.000000', expense_growth_annual: '0.000000', savings_return_annual: '0.000000' })
  })

  it('counts an insurance premium as spending only when asked', () => {
    const draft = base()
    draft.policies = [
      { id: 'p1', kind: 'health', insurer: 'Acme', label: 'Family', reference: '', cover: '500000', premium: '24000', startDate: '2027-01-01', countPremium: false },
      { id: 'p2', kind: 'term_life', insurer: 'Acme', label: 'Term', reference: '', cover: '5000000', premium: '12000', startDate: '2027-01-01', countPremium: true },
    ]
    const { plan } = buildPlan(draft, 'Asha')
    expect(plan?.expenses?.map((e) => e.label)).toEqual(['Rent', 'Phone', 'Insurance premium: Term'])
    expect(plan?.expenses?.at(-1)?.monthly).toBe('1000.00')
  })

  it('needs at least one goal, and respects the engine’s limits instead of dropping items', () => {
    const none = base()
    none.goals = []
    expect(buildPlan(none, 'A')).toEqual({ plan: null, problems: ['no_goal'] })
    const many = base()
    many.goals = Array.from({ length: 9 }, (_, i) => goal({ id: `g${i}` }))
    expect(buildPlan(many, 'A').problems).toContain('too_many_goals')
  })

  it('shows no income as an explicit zero line, not a made-up figure', () => {
    const draft = base()
    draft.income = []
    expect(buildPlan(draft, 'A').plan?.income_streams).toEqual([{ id: 'income_1', label: 'No regular income entered', monthly_net: '0.00', ends_after: null, frequency: 'monthly' }])
  })
})

describe('live totals', () => {
  it('add up what was typed, and keep spending apart from loans', () => {
    const draft = emptyDraft('2027-01')
    draft.income = [{ id: 'i', label: 'Pay', amount: '100000', frequency: 'monthly', endYear: '', growthPercent: '', include: true }]
    draft.expenses = [
      { id: 'e1', label: 'Rent', amount: '30000', frequency: 'monthly', essential: true, include: true },
      { id: 'e2', label: 'Fun', amount: '6000', frequency: 'half_yearly', essential: false, include: true },
    ]
    draft.liabilities = [{ id: 'l', name: 'Loan', kind: 'personal_loan', balance: '1', ratePercent: '', payment: '10000', remainingMonths: '12' }]
    draft.emergencyMonths = '6'
    expect(preview(draft)).toEqual({ income: '100000.00', essential: '30000.00', discretionary: '1000.00', loanPayments: '10000.00', surplus: '59000.00', emergencyTarget: '240000.00' })
  })
})

describe('goal checks', () => {
  it('flags dates in the past and amounts of zero', () => {
    expect(goalIssues(goal({ date: '2026-12' }), '2027-01')).toContain('past')
    expect(goalIssues(goal({ amount: '0.00' }), '2027-01')).toContain('amount')
    expect(goalIssues(goal({}), '2027-01')).toEqual([])
  })
})

describe('savings kept as the emergency fund', () => {
  const account = (over: Partial<AccountDraft>): AccountDraft => ({ id: 'a', name: 'Savings', kind: 'savings', balance: '400000', liquid: true, reserve: true, ...over })
  const draftWith = (accounts: AccountDraft[], goals: GoalDraft[]) => {
    const draft = emptyDraft('2027-01')
    draft.accounts = accounts
    draft.goals = goals
    return draft
  }
  const emergency = (over: Partial<GoalDraft> = {}) => goal({ id: 'e', kind: 'emergency_fund', label: 'Emergency', amount: '600000.00', tier: 1, ...over })
  const savingsOf = (draft: ReturnType<typeof draftWith>) => Object.fromEntries((buildPlan(draft, 'A').plan?.goals ?? []).map((g) => [g.label, g.current_savings]))

  it('counts ticked balances towards the emergency goal', () => {
    expect(savingsOf(draftWith([account({})], [emergency(), goal({ id: 'c', label: 'Car' })]))).toEqual({ Emergency: '400000.00', Car: '0.00' })
  })

  it('never counts more than the goal needs, and adds several balances exactly', () => {
    expect(savingsOf(draftWith([account({ balance: '500000.50' }), account({ id: 'b', balance: '200000.25' })], [emergency()])).Emergency).toBe('600000.00')
    expect(savingsOf(draftWith([account({ balance: '100000.10' }), account({ id: 'b', balance: '50000.20' })], [emergency()])).Emergency).toBe('150000.30')
  })

  it('leaves unticked balances out, and ignores them when there is no emergency goal', () => {
    expect(savingsOf(draftWith([account({ reserve: false })], [emergency()])).Emergency).toBe('0.00')
    expect(savingsOf(draftWith([account({})], [goal({ id: 'c', label: 'Car' })])).Car).toBe('0.00')
  })

  it('does not count the same money twice when an amount is typed on the goal itself', () => {
    expect(savingsOf(draftWith([account({})], [emergency({ saved: '50000' })])).Emergency).toBe('50000')
  })

  it('gives the money to one emergency goal only', () => {
    const plan = savingsOf(draftWith([account({})], [emergency({ id: 'e1', label: 'E1' }), emergency({ id: 'e2', label: 'E2' })]))
    expect([plan.E1, plan.E2].sort()).toEqual(['0.00', '400000.00'])
  })
})

describe('planned income streams in the plan', () => {
  it('accepts more than four sources and keeps each amount, frequency, start, end and growth', () => {
    const draft = emptyDraft('2027-01')
    draft.goals = [goal({})]
    draft.income = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, label: `Source ${i + 1}`, amount: '150000', frequency: i % 3 === 0 ? 'quarterly' : i % 3 === 1 ? 'yearly' : 'monthly', endYear: i === 2 ? '2030' : '', growthPercent: i === 3 ? '5' : '', include: true }))
    const { plan, problems } = buildPlan(draft, 'A')
    expect(problems).toEqual([])
    const streams = plan!.income_streams
    expect(streams).toHaveLength(7)
    expect(streams[0]).toMatchObject({ amount: '150000.00', frequency: 'quarterly', monthly_net: '50000.00', start_year: 2027, ends_after: null })
    expect(streams[1]).toMatchObject({ frequency: 'yearly', monthly_net: '12500.00' })
    expect(streams[2]).toMatchObject({ frequency: 'monthly', monthly_net: '150000.00', end_year: 2030 })
    expect(streams[3]).toMatchObject({ annual_growth: '0.050000' })
    expect(streams[4]).not.toHaveProperty('annual_growth') // blank means no automatic increase
  })

  it('flags an end year in the past or a bad growth rate', () => {
    const row = { id: 'i', label: 'Pay', amount: '1000', frequency: 'monthly' as const, endYear: '2026', growthPercent: '', include: true }
    expect(incomeIssues(row, '2027-01')).toContain('past')
    expect(incomeIssues({ ...row, endYear: '2030', growthPercent: '45' }, '2027-01')).toContain('range')
    expect(incomeIssues({ ...row, endYear: '2027' }, '2027-01')).toEqual([])
  })
})
