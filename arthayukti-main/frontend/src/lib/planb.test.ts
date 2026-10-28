import { describe, expect, it } from 'vitest'
import { addMonths, agreementDraft, blankItem, blankPlanB, buildSearch, reviseInput, thresholdsOf, type ItemDraft, type PlanBDraft } from './planb'

const item = (patch: Partial<ItemDraft>): ItemDraft => ({ ...blankItem('essential'), ...patch })

/** The research example: income 1,00,000 to 60,000 for six months from Nov 2026. */
function example(patch: Partial<PlanBDraft> = {}): PlanBDraft {
  return {
    ...blankPlanB('2026-11'),
    months: '12',
    liquidCash: '3,00,000',
    floor: '1,80,000',
    incomeBefore: '1,00,000',
    reducedIncome: '60,000',
    incomeAfter: '1,00,000',
    items: [
      item({ id: 'living', label: 'Living essentials', monthly: '30000' }),
      item({ id: 'flex', label: 'Flexible spending', kind: 'flexible', monthly: '10000', allowReduce: true, minMonthly: '5000' }),
      item({ id: 'edu', label: 'Education', kind: 'goal_contribution', monthly: '10000', balanceId: 'bal_edu' }),
      item({ id: 'home', label: 'Home', kind: 'goal_contribution', monthly: '10000', protectedGoal: false, allowPause: true, maxPause: '6' }),
    ],
    balances: [{ id: 'bal_edu', label: 'Education savings', balance: '1,20,000' }],
    ...patch,
  }
}

describe('buildSearch', () => {
  it('builds the worked example as exact decimal strings', () => {
    const built = buildSearch(example())
    expect(built.problems).toBeNull()
    const { request } = built
    expect(request?.input).toMatchObject({
      start_month: '2026-11',
      months: 12,
      liquid_cash: '300000.00',
      reserve_floor: '180000.00',
      income: [
        { from_month: '2026-11', to_month: '2027-04', monthly_net: '60000.00' },
        { from_month: '2027-05', to_month: '2027-10', monthly_net: '100000.00' },
      ],
      adjustments: [],
    })
    expect(request?.input.items.map((i) => [i.id, i.kind, i.monthly, i.protected])).toEqual([
      ['living', 'essential', '30000.00', true],
      ['flex', 'flexible', '10000.00', true],
      ['edu', 'goal_contribution', '10000.00', true],
      ['home', 'goal_contribution', '10000.00', false],
    ])
    expect(request?.input.permissions).toEqual([
      { item_id: 'flex', action: 'reduce_to', min_monthly: '5000.00' },
      { item_id: 'home', action: 'pause', max_months: 6 },
    ])
    expect(request?.input.protected_balances).toEqual([{ id: 'bal_edu', label: 'Education savings', balance: '120000.00' }])
    expect(request?.adjust_from).toBe('2026-11')
    expect(request?.adjust_months).toBe(6)
  })

  it('never makes a protected item adjustable, even if the form says so', () => {
    const draft = example()
    draft.items[2] = { ...draft.items[2], allowPause: true, allowReduce: true }
    draft.items[0] = { ...draft.items[0], allowPause: true }
    const permissions = buildSearch(draft).request?.input.permissions ?? []
    expect(permissions.map((p) => p.item_id)).not.toContain('edu')
    expect(permissions.map((p) => p.item_id)).not.toContain('living')
  })

  it('leaves an unknown duration open, so the service assumes it continues and says so', () => {
    const built = buildSearch(example({ durationKnown: false, incomeAfter: '' }))
    expect(built.request?.input.income).toEqual([
      { from_month: '2026-11', to_month: null, monthly_net: '60000.00' },
    ])
    expect(built.request?.adjust_months).toBeNull()
  })

  it('models a lost income as zero and a new cost as a protected obligation', () => {
    const loss = buildSearch(example({ disruption: 'income_loss', reducedIncome: '' }))
    expect(loss.request?.input.income[0].monthly_net).toBe('0.00')
    const cost = buildSearch(example({ disruption: 'new_expense', newCost: '12,000' }))
    const added = cost.request?.input.items.at(-1)
    expect(added).toMatchObject({ id: 'new_expense', kind: 'protected_obligation', monthly: '12000.00', from_month: '2026-11', to_month: '2027-04' })
    expect(cost.request?.input.income[0].monthly_net).toBe('100000.00') // income itself is unchanged
  })

  it('starts the change later than the first month with income before it', () => {
    const built = buildSearch(example({ disruptionStart: '2027-01' }))
    expect(built.request?.input.income[0]).toEqual({ from_month: '2026-11', to_month: '2026-12', monthly_net: '100000.00' })
    expect(built.request?.adjust_from).toBe('2027-01')
  })

  it('builds restoration rules only from conditions that are not a date, scaled from each original amount', () => {
    const draft = example()
    draft.restore = { incomeAtLeast: '1,00,000', cashAtLeast: '2,40,000', confirm: false, mode: 'steps', stepPercents: '50,100', gap: '2', guard: true }
    const rules = buildSearch(draft).request?.input.restorations ?? []
    expect(rules.map((r) => r.item_id)).toEqual(['flex', 'home'])
    expect(rules[0].conditions).toEqual([
      { type: 'income_at_least', amount: '100000.00' },
      { type: 'liquid_at_least', amount: '240000.00' },
    ])
    expect(rules[0].steps).toEqual(['5000.00', '10000.00'])
    expect(rules[0].step_gap_months).toBe(2)
    expect(buildSearch(example()).request?.input.restorations).toEqual([]) // no conditions, so no restoration rule
  })

  it('names each problem and sends nothing', () => {
    const built = buildSearch(
      example({ months: '0', liquidCash: '-5', floor: '', durationMonths: '7', items: [item({ id: 'x', label: ' ', monthly: '' })], reviewMonth: '2027-13' }),
    )
    expect(built.request).toBeNull()
    expect(built.problems).toMatchObject({ months: 'months', liquidCash: 'money', floor: 'money', 'x.label': 'name', 'x.monthly': 'money', reviewMonth: 'month' })
  })

  it('refuses a change that ends after the modelled months and a reduction floor above the amount', () => {
    expect(buildSearch(example({ months: '4' })).problems).toMatchObject({ durationMonths: 'durationBeyond' })
    const draft = example()
    draft.items[1] = { ...draft.items[1], minMonthly: '20000' }
    expect(buildSearch(draft).problems).toMatchObject({ 'flex.minMonthly': 'money' })
    expect(buildSearch(example({ items: [] })).problems).toMatchObject({ items: 'items' })
    expect(buildSearch(example({ restore: { ...example().restore, mode: 'steps', stepPercents: '100,50' } })).problems).toMatchObject({ 'restore.stepPercents': 'steps' })
  })

  it('carries the items the person refused', () => {
    expect(buildSearch(example({ excluded: ['flex'] })).request?.excluded_item_ids).toEqual(['flex'])
  })
})

describe('agreements', () => {
  it('saves the searched situation with only the chosen adjustments', () => {
    const request = buildSearch(example()).request!
    const adjustments = [{ item_id: 'home', action: 'pause' as const, from_month: '2026-11', to_month: '2027-04' }]
    const draft = agreementDraft(request, adjustments, { selectedLabel: 'Smallest total sacrifice', rationale: 'r', fallback: 'f', plan: { id: 'p1', name: 'My plan' } })
    expect(draft.input.adjustments).toEqual(adjustments)
    expect(draft.input.items).toEqual(request.input.items)
    expect(draft).toMatchObject({ selected_label: 'Smallest total sacrifice', source_plan_id: 'p1', source_plan_name: 'My plan', fallback_note: 'f' })
    expect(request.input.adjustments).toEqual([]) // the searched request is not changed
  })

  it('reads and rewrites the restoration conditions without touching the rest', () => {
    const draft = example()
    draft.restore = { incomeAtLeast: '1,00,000', cashAtLeast: '', confirm: true, mode: 'all', stepPercents: '', gap: '1', guard: true }
    const input = buildSearch(draft).request!.input
    expect(thresholdsOf(input)).toEqual({ incomeAtLeast: '100000', cashAtLeast: '', confirm: true })
    const revised = reviseInput(input, { incomeAtLeast: '90,000', cashAtLeast: '2,00,000', confirm: false, floor: '1,70,000', reviewMonth: '2027-06' })
    expect(revised.problem).toBeNull()
    expect(revised.input?.reserve_floor).toBe('170000.00')
    expect(revised.input?.review_month).toBe('2027-06')
    expect(revised.input?.restorations?.[0].conditions).toEqual([
      { type: 'income_at_least', amount: '90000.00' },
      { type: 'liquid_at_least', amount: '200000.00' },
    ])
    expect(revised.input?.items).toEqual(input.items)
    expect(reviseInput(input, { ...thresholdsOf(input), floor: 'abc', reviewMonth: '' }).problem).toBe('money')
    expect(reviseInput(input, { ...thresholdsOf(input), floor: '1', reviewMonth: '2027-13' }).problem).toBe('month')
  })
})

describe('addMonths', () => {
  it('crosses year boundaries', () => {
    expect(addMonths('2026-11', 5)).toBe('2027-04')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
  })
})
