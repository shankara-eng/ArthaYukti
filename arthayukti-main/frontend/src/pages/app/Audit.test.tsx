import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { growthToPercent, percentToGrowth, toLine, toRow, type SpendRow } from '../../lib/expenditure'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const PLAN = {
  ...family.plan,
  income_streams: [{ id: 's1', label: 'Salary', monthly_net: '100000.00', frequency: 'monthly' }],
  expenses: [{ id: 'e1', label: 'Living essentials', monthly: '30000.00', essential: true }],
  commitments: [],
  goals: [{ ...family.plan.goals[0], id: 'reserve', label: 'Emergency fund', type: 'emergency_fund', target_amount_today: '240000.00', current_savings: '120000.00', priority: 1 }],
}

const SPEND = {
  plan_source: 'saved', horizon_months: 60, first_month: '2027-01', plan_growth_annual: '0.000000', total_projected_expenditure: '1800000.00',
  years: [{ year: 2027, months_included: 12, annual_expenditure: '360000.00', cumulative_expenditure: '360000.00', essential: '360000.00', discretionary: '0.00' }],
  lines: [],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  setAccessToken(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const backend = (extra: Parameters<typeof mockApi>[0] = {}, plan: unknown = PLAN) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
    'GET /plans/p1': () => json({ id: 'p1', plan, created_at: 'x', updated_at: 'y' }),
    'GET /insurance/reminders': () => json([]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    'GET /auth/preferences': () => json({ default_inflation_annual: '0.065000', is_default: false }),
    'POST /income/projection': () => json({ plan_source: 'saved', horizon_months: 60, first_month: '2027-01', total_projected_income: '0.00', years: [] }),
    'GET /financials/transactions': () => json([]),
    'GET /financials/accounts': () => json([]),
    ...extra,
  })

describe('expenditure rules in the browser', () => {
  const row = (extra: Partial<SpendRow> = {}): SpendRow => ({ id: 'x', name: 'Fees', category: '', amount: '30000.00', frequency: 'monthly', essential: true, start: '', end: '', growth: '', ...extra })

  it('keeps a plain monthly line plain and makes anything dated or periodic a schedule', () => {
    expect(toLine(row(), '2027-01')).toEqual({ id: 'x', label: 'Fees', monthly: '30000.00', essential: true })
    const quarterly = toLine(row({ frequency: 'quarterly' }), '2027-01')
    expect(quarterly).toMatchObject({ amount: '30000.00', frequency: 'quarterly', start_month: '2027-01' }) // starts with the plan when no start is given
    expect(quarterly).not.toHaveProperty('end_month')
    expect(toLine(row({ start: '2027-03', end: '2027-05', growth: '10' }), '2027-01')).toMatchObject({ start_month: '2027-03', end_month: '2027-05', annual_growth: '0.100000' })
    expect(toRow(toLine(row({ frequency: 'yearly', start: '2027-04' }), '2027-01'))).toMatchObject({ amount: '30000.00', frequency: 'yearly', start: '2027-04' })
  })

  it('reads growth percentages exactly, including a fall in spending, and refuses what the engine would', () => {
    expect(percentToGrowth('6')).toBe('0.060000')
    expect(percentToGrowth('7.25')).toBe('0.072500')
    expect(percentToGrowth('-2')).toBe('-0.020000')
    expect(percentToGrowth('-0')).toBe('0.000000')
    expect(percentToGrowth('30')).toBe('0.300000')
    for (const bad of ['31', '-11', '1.234', 'abc', '', '--1']) expect(percentToGrowth(bad)).toBeNull()
    expect(growthToPercent('0.072500')).toBe('7.25')
    expect(growthToPercent('-0.020000')).toBe('-2')
    expect(growthToPercent('0.000000')).toBe('0')
  })
})

describe('Expenditures on Income and Expenditures', () => {
  async function open(extra: Parameters<typeof mockApi>[0] = {}, plan: unknown = PLAN) {
    window.location.hash = '/finances'
    const mock = backend({ 'POST /expenditure/projection': () => json(SPEND), ...extra }, plan)
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Expenditures' })
    return mock
  }

  it('shows the lines and the engine projection year by year', async () => {
    const { calls } = await open()
    expect(await screen.findByDisplayValue('Living essentials')).toBeInTheDocument()
    expect(await screen.findByText(/Projected spending/)).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Year by year' })
    expect(within(table).getByText('2027')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/expenditure/projection')?.body).toMatchObject({ plan_id: 'p1', horizon_months: 60 })
  })

  it('sends a newly added scheduled line to the engine as an edited plan, and holds back invalid lines', async () => {
    const { calls } = await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Add an expenditure' }))
    expect(await screen.findByText('Fix the highlighted lines to see the projection.')).toBeInTheDocument()
    fireEvent.change(screen.getAllByLabelText('What is it').at(-1)!, { target: { value: 'Tuition' } })
    fireEvent.change(screen.getAllByLabelText('Amount (₹)').at(-1)!, { target: { value: '30000' } })
    fireEvent.change(screen.getAllByLabelText('Starts in (optional)').at(-1)!, { target: { value: '2027-03' } })
    fireEvent.change(screen.getAllByLabelText('Ends in (optional)').at(-1)!, { target: { value: '2027-02' } })
    expect(await screen.findByText('It cannot end before it starts.')).toBeInTheDocument()
    const before = calls.filter((c) => c.path === '/expenditure/projection').length
    fireEvent.change(screen.getAllByLabelText('Ends in (optional)').at(-1)!, { target: { value: '2027-05' } })
    await waitFor(() => {
      const sent = calls.filter((c) => c.path === '/expenditure/projection').at(-1)?.body as { plan?: { expenses: Record<string, unknown>[] } }
      expect(sent.plan?.expenses.at(-1)).toMatchObject({ label: 'Tuition', amount: '30000.00', frequency: 'monthly', start_month: '2027-03', end_month: '2027-05' })
    })
    // While the line was invalid nothing was sent for it.
    expect(calls.filter((c) => c.path === '/expenditure/projection').length).toBeGreaterThan(before)
  })

  it('takes the plan-wide yearly increase, or the persons default inflation on request, and refuses a rate out of range', async () => {
    const { calls } = await open()
    const field = await screen.findByLabelText('Yearly increase in spending (%)')
    fireEvent.change(field, { target: { value: '45' } })
    expect(await screen.findByText('Enter a rate from -10 to 30, with at most two decimals.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my default inflation' }))
    expect(field).toHaveValue('6.5')
    await waitFor(() => {
      const sent = calls.filter((c) => c.path === '/expenditure/projection').at(-1)?.body as { plan?: { assumptions: { expense_growth_annual: string } } }
      expect(sent.plan?.assumptions.expense_growth_annual).toBe('0.065000')
    })
  })

  it('does not ask the engine for a projection when there is no goal yet, and says why', async () => {
    const { calls } = await open({}, { ...PLAN, goals: [] })
    expect(await screen.findByText(/Add a goal first to see the projection/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/expenditure/projection')).toBe(false)
  })

  it('downloads the same projection as CSV and reports a failure', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    let fail = false
    const { calls } = await open({ 'POST /expenditure/projection/csv': () => (fail ? json({ error: { code: 'x', message: 'x' } }, 500) : new Response('﻿Year\r\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })) })
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/expenditure/projection/csv')).toBe(true))
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('The file could not be prepared. Try again.')).toBeInTheDocument()
  })
})

describe('Emergency Funds default target', () => {
  it('uses twelve months, says it is a default, and keeps it out of the profile until saved', async () => {
    window.location.hash = '/emergency'
    const analysis = { monthly_essentials: '30000.00', target_months: 12, target_amount: '360000.00', has_goal: true, goal_id: 'reserve', goal_label: 'Emergency fund', goal_target_today: '240000.00', reserve_held: '120000.00', months_covered: '4.0', progress: '0.3333', shortfall_to_target: '240000.00', projected: [], goal_status: 'on_track', projected_completion: '2027-12', notes: [] }
    const { calls } = backend({ 'GET /household/profile': () => json({ emergency_fund_months_target: null }), 'POST /emergency-fund/analyze': () => json(analysis) })
    render(<App />)
    const field = await screen.findByLabelText('Your target, in months of essentials')
    expect(field).toHaveValue('12')
    expect(screen.getByText(/default of 12 months/)).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path === '/emergency-fund/analyze')).toBe(true))
    const analysed = calls.find((c) => c.path === '/emergency-fund/analyze')?.body as { target_months: number } | undefined
    expect(analysed?.target_months).toBe(12)
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/household/profile')).toBe(false)
  })
})

describe('Holdings ledger', () => {
  const holding = { id: 'h1', asset_name: 'Acme Ltd', asset_type: 'stock', symbol: 'ACME', quantity: '1.0000', purchase_price: '0.00', current_value: '0.00', is_liquid: true, last_valuation_date: null, created_at: 'x' }
  const position = (extra: Record<string, unknown> = {}) => ({
    holding_id: 'h1', asset_name: 'Acme Ltd', symbol: 'ACME', quantity: '80.000000', cost_basis: '1525.00', average_cost: '19.0625', realised_gain: '3295.00', dividends_gross: '600.00', dividends_net: '540.00', fees_paid: '230.00',
    lots: [], sales: [],
    valuation: { basis: 'market_snapshot', status: 'stale', value: '3200.00', unit_price: '40.0000', as_of: '2026-10-20T00:00:00+00:00', source: 'FEED', unrealised_gain: '1675.00', message: 'Valued at the last stored price, which is old. Treat it as out of date.' },
    reconciliation: { has_ledger: true, record_quantity: '1.0000', ledger_quantity: '80.000000', matches: false, difference: '79.000000' },
    notes: [], ...extra,
  })
  const txn = { id: 't1', holding_id: 'h1', transaction_type: 'sell', trade_date: '2026-07-01', quantity: '250.000000', price: '40.0000', fees: '80.00', ratio_new: null, ratio_old: null, notes: null, created_at: 'x', quantity_after: '80.000000', cost_basis_after: '1525.00', realised_gain: '3295.00', cash: '9920.00' }

  async function open(extra: Parameters<typeof mockApi>[0] = {}) {
    window.location.hash = '/equities'
    const mock = backend({
      'GET /calculators/scenarios': () => json([]),
      'GET /financials/investments': () => json([holding]),
      'GET /financials/investments/h1/position': () => json(position()),
      'GET /financials/investments/h1/transactions': () => json([txn]),
      ...extra,
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Holdings and balances' }))
    await screen.findByRole('heading', { name: 'Transactions and corporate actions' })
    return mock
  }

  it('shows the position the transactions give, and where its valuation comes from', async () => {
    await open()
    const region = await screen.findByRole('region', { name: 'Position from your transactions' })
    expect(within(region).getByText('₹19.06')).toBeInTheDocument() // average cost 19.0625 shown to the paisa
    expect(within(region).getByText(/stored market price, out of date/)).toBeInTheDocument()
    expect(within(region).getByText(/which is old/)).toBeInTheDocument()
    expect(screen.getByText(/The holding record says 1 units; your transactions give 80/)).toBeInTheDocument()
  })

  it('records a purchase as typed and refuses a future date or a malformed number before sending', async () => {
    const { calls } = await open({ 'POST /financials/investments/h1/transactions': (init) => json({ ...txn, ...JSON.parse(String(init?.body)), id: 't2' }, 201) })
    fireEvent.click(await screen.findByRole('button', { name: 'Save transaction' }))
    expect(await screen.findByText('Choose a date that has already passed.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/transactions'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } })
    fireEvent.change(screen.getByLabelText('Units'), { target: { value: '10.5' } })
    fireEvent.change(screen.getByLabelText('Price per unit (₹)'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    expect(await screen.findAllByText('Enter a number above zero.')).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Price per unit (₹)'), { target: { value: '50.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/financials/investments/h1/transactions')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/transactions'))?.body).toEqual({ transaction_type: 'buy', trade_date: '2026-01-05', fees: '0.00', quantity: '10.5', price: '50.25' })
  })

  it('shows the servers reason when a sale does not fit the history', async () => {
    await open({ 'POST /financials/investments/h1/transactions': () => json({ error: { code: 'ledger_invalid', message: 'On 2026-02-01 you hold 10 units, so 11 cannot be sold.' } }, 422) })
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Units'), { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('Price per unit (₹)'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    expect(await screen.findByText('On 2026-02-01 you hold 10 units, so 11 cannot be sold.')).toBeInTheDocument()
  })

  it('removes a transaction and reports one that cannot be removed', async () => {
    let refuse = true
    const { calls } = await open({
      'DELETE /financials/investments/h1/transactions/t1': () => (refuse ? json({ error: { code: 'ledger_conflict', message: 'a later sale depends on it.' } }, 409) : new Response(null, { status: 204 })),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Remove Sale 2026-07-01/ }))
    expect(await screen.findByText(/This transaction cannot be removed|a later sale depends on it/)).toBeInTheDocument()
    refuse = false
    fireEvent.click(screen.getByRole('button', { name: /Remove Sale 2026-07-01/ }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').length).toBe(2))
  })

  it('updates the holding record only when asked, and says the entered value is untouched', async () => {
    const { calls } = await open({ 'POST /financials/investments/h1/apply-ledger': () => json({ quantity: '80.0000', purchase_price: '1525.00', precision_note: null }) })
    expect(calls.some((c) => c.path.endsWith('/apply-ledger'))).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Update the holding record from these transactions' }))
    expect(await screen.findByText(/The value you entered was not changed/)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.endsWith('/apply-ledger')).length).toBe(1)
  })

  it('says to add a holding first when there is none', async () => {
    window.location.hash = '/equities'
    backend({ 'GET /calculators/scenarios': () => json([]), 'GET /financials/investments': () => json([]) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Holdings and balances' }))
    expect(await screen.findByText('Add a holding first (above), then record its transactions.')).toBeInTheDocument()
  })
})

describe('Debt trajectory', () => {
  const loan = (extra: Record<string, unknown> = {}) => ({ id: 'l1', name: 'Bank loan', status: 'ok', reason: null, opening_balance: '100000.00', annual_rate: '0.120000', monthly_payment: '8884.88', months_to_payoff: 12, debt_free_month: '2027-10', total_interest: '6618.53', total_paid: '106618.53', paid_later_than_recorded: false, ...extra })
  const trajectory = (loans: unknown[], extra: Record<string, unknown> = {}) => ({
    start_month: '2026-11', loans, years: [{ year: 2026, months_included: 2, payments: '17769.76', principal: '15848.61', interest: '1921.15', closing_balance: '84151.39' }, { year: 2027, months_included: 10, payments: '88848.77', principal: '84151.39', interest: '4697.38', closing_balance: '0.00' }],
    total_interest: '6618.53', total_paid: '106618.53', complete: true, debt_free_month: '2027-10', ...extra,
  })

  it('shows each recorded debt and the year-by-year totals the engine returned', async () => {
    window.location.hash = '/outlook-debt'
    const { calls } = backend({ 'GET /debt/trajectory': () => json(trajectory([loan()])) })
    render(<App />)
    const table = await screen.findByRole('table', { name: 'All debts together, year by year' })
    expect(within(table).getAllByText('₹84,151.39').length).toBeGreaterThan(0)
    expect(screen.getByText('Every debt with a balance is included.')).toBeInTheDocument()
    expect(screen.getByText(/A year with fewer than 12 months/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/debt/trajectory')).toBe(true)
  })

  it('names the reason a debt could not be projected and says the totals leave it out', async () => {
    window.location.hash = '/outlook-debt'
    const limited = loan({ id: 'l2', name: 'Unpaid', status: 'limited', reason: 'No monthly payment is recorded for this debt, so no schedule can be worked out.', months_to_payoff: null, debt_free_month: null, total_interest: null, total_paid: null })
    backend({ 'GET /debt/trajectory': () => json(trajectory([loan(), limited], { complete: false, debt_free_month: null })) })
    render(<App />)
    expect(await screen.findByText(/No monthly payment is recorded for this debt/)).toBeInTheDocument()
    expect(screen.getByText('Some debts could not be projected (listed above), so these totals leave them out.')).toBeInTheDocument()
  })

  it('says so plainly when no debt has a balance', async () => {
    window.location.hash = '/outlook-debt'
    backend({ 'GET /debt/trajectory': () => json(trajectory([], { years: [], total_interest: '0.00', total_paid: '0.00', debt_free_month: null })) })
    render(<App />)
    expect(await screen.findByText('No debts with a balance are recorded. Add them below.')).toBeInTheDocument()
  })
})

describe('Holdings form', () => {
  it('can set a market symbol so a stored price can value the holding, and leaves it out when empty', async () => {
    window.location.hash = '/equities'
    const { calls } = backend({
      'GET /calculators/scenarios': () => json([]),
      'GET /financials/investments': () => json([]),
      'POST /financials/investments': (init) => json({ id: 'h9', created_at: 'x', symbol: null, is_liquid: true, last_valuation_date: null, asset_type: 'stock', purchase_price: '0.00', quantity: '1.0000', ...JSON.parse(String(init?.body)) }, 201),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Holdings and balances' }))
    const form = (await screen.findByRole('heading', { name: 'Add an asset' })).closest('section') as HTMLElement
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Acme Ltd' } })
    fireEvent.change(within(form).getByLabelText('Current value'), { target: { value: '5000' } })
    fireEvent.change(within(form).getByLabelText('Market symbol (optional)'), { target: { value: 'acme' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/financials/investments')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.path === '/financials/investments')?.body).toMatchObject({ asset_name: 'Acme Ltd', current_value: '5000.00', symbol: 'ACME' })
  })
})
