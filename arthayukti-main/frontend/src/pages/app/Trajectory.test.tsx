import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

// The page waits briefly before asking, and renders many sections: allow for a loaded machine.
configure({ asyncUtilTimeout: 4000 })

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const bal = (netWorth: string, extra: Record<string, string> = {}) => ({
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
  ...extra,
})
const ev = (month: string, kind: string, label: string, cash: string, note = 'A note.') => ({ month, kind, label, source_id: null, cash_delta: cash, asset_delta: '0.00', liability_delta: '0.00', net_worth_effect: cash, principal: null, interest: null, note })
const row = (month: string, opening: string, closing: string, events: Record<string, unknown[]> = {}) => ({
  month,
  opening_balances: bal(opening),
  income_events: [],
  expense_events: [],
  debt_events: [],
  insurance_events: [],
  investment_events: [],
  deposit_events: [],
  goal_events: [],
  other_events: [],
  ...events,
  closing_balances: bal(closing),
  net_worth: closing,
  uncovered_cash_deficit: '0.00',
})

const RESULT = {
  model_version: 'trajectory-1.0',
  as_of: '2027-01',
  horizon_months: 120,
  view: 'baseline',
  input_snapshot_hash: 'a'.repeat(64),
  reference_age: null,
  effective_assumptions: [{ id: 'timing', label: 'Timing', value: 'Monthly.', kind: 'default_rule', source: 'Model trajectory-1.0', edit_route: null }],
  completeness: { status: 'complete', recorded: true, stale_quotes: 0, missing: [] },
  warnings: [],
  provenance: [{ component: 'cash', label: 'Spendable cash', kind: 'user_entered', source: 'Your liquid account balances', detail: null, as_of: null }],
  summary: {
    current_assets: '100000.00',
    current_liabilities: '0.00',
    current_net_worth: '100000.00',
    current_cash: '100000.00',
    horizon_assets: '580000.00',
    horizon_liabilities: '0.00',
    horizon_net_worth: '580000.00',
    horizon_cash: '580000.00',
    projected_debt_free_dates: [],
    all_debts_cleared_month: null,
    reconciles: true,
  },
  drivers: { income: '1200000.00', spending: '720000.00', interest_paid: '0.00', principal_repaid: '0.00', premiums_paid: '0.00', benefits_received: '0.00', goal_spending: '0.00', market_growth: '0.00', goal_growth: '0.00', investment_charges: '0.00', shortfall: '0.00' },
  goals: [],
  comparison: null,
  checkpoints: [
    { month: '2027-01', months_ahead: 0, age: null, assets: '100000.00', liabilities: '0.00', net_worth: '100000.00', cash: '100000.00' },
    { month: '2036-12', months_ahead: 120, age: null, assets: '580000.00', liabilities: '0.00', net_worth: '580000.00', cash: '580000.00' },
  ],
  opening_balances: bal('100000.00'),
  monthly_ledger: [
    row('2027-01', '100000.00', '140000.00', { income_events: [ev('2027-01', 'income', 'Planned income', '100000.00', 'From the Income module.')], insurance_events: [ev('2027-01', 'premium', 'Premium: Acme Term', '-12000.00', 'An expense. Cover is not an asset.')] }),
    row('2027-02', '140000.00', '580000.00'),
  ],
}

const withResult = (extra: Record<string, unknown>) => ({ ...RESULT, ...extra })

/** The page's selects are comboboxes: open one and click its option. */
function pick(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/trajectory'
  setAccessToken(null)
  Element.prototype.scrollIntoView = vi.fn() // jsdom has none, and the page's selects scroll their chosen entry into view
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const backend = (extra: Parameters<typeof mockApi>[0] = {}, plan: unknown = family.plan) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
    'GET /plans/p1': () => json({ id: 'p1', plan, created_at: 'x', updated_at: 'y' }),
    'GET /insurance/reminders': () => json([]),
    'GET /financials/liabilities': () => json([{ id: 'l1', liability_name: 'Car loan', liability_type: 'auto_loan', principal_amount: '1.00', current_balance: '1.00', interest_rate: '0.100000', monthly_emi: '1.00', remaining_months: 1, created_at: 'x' }]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    'POST /trajectory/project': () => json(RESULT),
    ...extra,
  })

const calls = (all: { method: string; path: string; body: unknown }[]) => all.filter((c) => c.path === '/trajectory/project')
const last = (all: { method: string; path: string; body: unknown }[]) => calls(all).slice(-1)[0]?.body as Record<string, unknown>

describe('the Financial Trajectory tab', () => {
  it('is in the navigation and opens with its own title and the plan start', async () => {
    const made = backend()
    render(<App />)
    expect((await screen.findAllByRole('heading', { name: 'Financial Trajectory' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('navigation', { name: 'Main menu' })[0]).toHaveTextContent('Financial Trajectory')
    expect(screen.getByText('Starting January 2027')).toBeInTheDocument()
    await screen.findByText('Net worth now')
    expect(calls(made.calls)).toHaveLength(1) // one request on opening
  })

  it('asks the server for the baseline from the saved plan, ten years by default, and shows its figures', async () => {
    const { calls: made } = backend()
    render(<App />)
    await screen.findByText('Net worth now')
    const body = last(made)
    expect(body).toMatchObject({ plan_id: 'p1', view: 'baseline', horizon: { months: 120 }, selected_goal_ids: [], include_monthly_ledger: true })
    expect(Object.keys(body)).not.toContain('plan')
    const metrics = within(document.getElementById('trajectory-metrics') as HTMLElement)
    expect(metrics.getByText('Net worth now').parentElement).toHaveTextContent('₹1,00,000')
    expect(metrics.getByText(/Projected net worth, December 2036/).parentElement).toHaveTextContent('₹5,80,000')
    expect(screen.getByText(/Net worth is assets minus liabilities/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Checkpoints' })).toBeInTheDocument()
  })

  it('shows no figures while it calculates, and never an earlier answer for new choices', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let count = 0
    const { calls: made } = backend({
      'POST /trajectory/project': async () => {
        count += 1
        if (count === 2) await gate
        return json(count === 2 ? withResult({ summary: { ...RESULT.summary, horizon_net_worth: '777777.00' } }) : RESULT)
      },
    })
    render(<App />)
    await screen.findByText('Net worth now')
    pick('Look ahead', '20 years')
    await waitFor(() => expect(calls(made)).toHaveLength(2))
    // The second request is still out: the first answer must not stand in for it.
    expect(screen.queryByText('Net worth now')).not.toBeInTheDocument()
    expect(screen.getByText('Your records or choices changed. Recalculating…')).toBeInTheDocument()
    release()
    expect(await screen.findByText('₹7,77,777')).toBeInTheDocument()
    expect(last(made)).toMatchObject({ horizon: { months: 240 } })
  })

  it('ignores an answer that arrives after the choices have moved on', async () => {
    let releaseFirst: () => void = () => undefined
    const first = new Promise<void>((resolve) => (releaseFirst = resolve))
    let count = 0
    backend({
      'POST /trajectory/project': async () => {
        count += 1
        if (count === 1) {
          await first
          return json(withResult({ summary: { ...RESULT.summary, horizon_net_worth: '111111.00' } }))
        }
        return json(withResult({ summary: { ...RESULT.summary, horizon_net_worth: '222222.00' } }))
      },
    })
    render(<App />)
    await waitFor(() => expect(count).toBe(1))
    pick('Look ahead', '30 years')
    expect(await screen.findByText('₹2,22,222')).toBeInTheDocument()
    releaseFirst()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('₹1,11,111')).not.toBeInTheDocument()
  })

  it('says so, keeps the choices and shows no invented numbers when the calculation fails', async () => {
    let fail = true
    backend({ 'POST /trajectory/project': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : json(RESULT)) })
    render(<App />)
    expect(await screen.findByText('The trajectory could not be calculated. Your choices are kept.')).toBeInTheDocument()
    expect(screen.queryByText('Net worth now')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Look ahead')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Net worth now')).toBeInTheDocument()
  })

  it('explains an age horizon that has no reference age, in plain words', async () => {
    backend({ 'POST /trajectory/project': (init) => ((JSON.parse(String(init?.body)).horizon.target_age ? json({ error: { code: 'age_reference_missing', message: 'x' } }, 422) : json(RESULT))) })
    render(<App />)
    await screen.findByText('Net worth now')
    pick('Look ahead', 'To an age')
    fireEvent.change(await screen.findByLabelText('Target age'), { target: { value: '60' } })
    expect(await screen.findByText(/needs your current age/)).toBeInTheDocument()
  })

  it('sends a target age, and shows ages in the checkpoints when the server knows one', async () => {
    const aged = withResult({ reference_age: 40, checkpoints: [{ ...RESULT.checkpoints[0], age: 40 }, { ...RESULT.checkpoints[1], age: 50 }] })
    const { calls: made } = backend({ 'POST /trajectory/project': () => json(aged) })
    render(<App />)
    await screen.findByText('Net worth now')
    pick('Look ahead', 'To an age')
    fireEvent.change(await screen.findByLabelText('Target age'), { target: { value: '50' } })
    await waitFor(() => expect(last(made)).toMatchObject({ horizon: { target_age: 50 } }))
    const table = await screen.findByRole('table', { name: 'Checkpoints' })
    expect(within(table).getByRole('columnheader', { name: 'Age' })).toBeInTheDocument()
  })

  it('does not ask until an age is a valid age', async () => {
    const { calls: made } = backend()
    render(<App />)
    await screen.findByText('Net worth now')
    const before = calls(made).length
    pick('Look ahead', 'To an age')
    fireEvent.change(await screen.findByLabelText('Target age'), { target: { value: '999' } })
    expect(await screen.findByText('Enter an age from 1 to 120.')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(calls(made)).toHaveLength(before)
  })
})

describe('states: empty, partial, stale and incomplete', () => {
  it('shows an empty state with links, and no ₹0 net worth, when nothing is recorded', async () => {
    backend({ 'POST /trajectory/project': () => json(withResult({ completeness: { status: 'insufficient', recorded: false, stale_quotes: 0, missing: [{ record: 'account', record_id: null, field: 'balance', reason: 'Record at least one account balance.', edit_route: 'equities' }] }, warnings: [] })) })
    render(<App />)
    expect(await screen.findByText('Nothing recorded to project from yet')).toBeInTheDocument()
    expect(screen.queryByText('Net worth now')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Record debts' })).toHaveAttribute('href', '#/debts')
    expect(screen.getAllByRole('link', { name: /Add (account balances|holdings)/ })[0]).toHaveAttribute('href', '#/equities')
  })

  it('shows what is known and labels what is not: partial, a stale price, an unknown loan payoff', async () => {
    const partial = withResult({
      completeness: { status: 'partial', recorded: true, stale_quotes: 1, missing: [{ record: 'debt', record_id: 'l1', field: 'monthly_emi', reason: 'No payment is recorded for this debt, so no schedule can be worked out.', edit_route: 'debts' }] },
      warnings: [
        { code: 'stale_quote', severity: 'warning', message: 'Acme: valued at the last stored price (2026-10-01, TEST_FEED), which is old.', component: 'equities', record_id: 'h1', edit_route: 'equities', related_id: null },
        { code: 'loan_payment_missing', severity: 'warning', message: 'Car loan: the balance is recorded but no payment is, so its payoff date is unknown.', component: 'debts', record_id: 'l1', edit_route: 'debts', related_id: null },
        { code: 'renewal_price_unknown', severity: 'info', message: 'Renewal premiums are held at today’s amount.', component: 'insurance', record_id: null, edit_route: 'insurance', related_id: null },
      ],
      summary: { ...RESULT.summary, projected_debt_free_dates: [{ id: 'l1', name: 'Car loan', month: null, status: 'no_payment', reason: 'x', balance_now: '1.00', interest_in_period: '0.00' }] },
    })
    backend({ 'POST /trajectory/project': () => json(partial) })
    render(<App />)
    const health = within(await screen.findByRole('region', { name: 'Input health' }))
    expect(health.getByText(/Some parts could not be fully projected/)).toBeInTheDocument()
    expect(health.getByText(/valued at the last stored price \(2026-10-01, TEST_FEED\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 stored price is old: see Input health/)).toBeInTheDocument()
    expect(screen.getByText('Not known: see Input health')).toBeInTheDocument() // the debt-free date is not invented
    fireEvent.click(health.getByRole('button', { name: 'Show details' }))
    const editLinks = health.getAllByRole('link', { name: 'Edit at source' }).map((a) => a.getAttribute('href'))
    expect(editLinks).toEqual(expect.arrayContaining(['#/equities', '#/debts', '#/insurance']))
    expect(health.getByText('Missing for a reliable projection')).toBeInTheDocument()
    expect(health.getByText(/No payment is recorded for this debt/)).toBeInTheDocument()
  })

  it('warns loudly when the ledger does not reconcile', async () => {
    backend({ 'POST /trajectory/project': () => json(withResult({ summary: { ...RESULT.summary, reconciles: false } })) })
    render(<App />)
    expect(await screen.findByText('The ledger did not reconcile. Do not rely on these figures.')).toBeInTheDocument()
  })

  it('lets a possible double-counted loan be linked, and asks again with the link', async () => {
    const dup = withResult({
      warnings: [{ code: 'possible_duplicate_debt', severity: 'warning', message: "'Home EMI' in the plan and 'Home loan' in your debts have the same payment. If they are one loan it is counted twice: link them.", component: 'debts', record_id: 'l1', edit_route: 'debts', related_id: 'c0' }],
      completeness: { status: 'partial', recorded: true, stale_quotes: 0, missing: [] },
    })
    const { calls: made } = backend({ 'POST /trajectory/project': (init) => json(JSON.parse(String(init?.body)).linked_commitments?.length ? withResult({ warnings: [], completeness: RESULT.completeness }) : dup) })
    render(<App />)
    const health = within(await screen.findByRole('region', { name: 'Input health' }))
    fireEvent.click(health.getByRole('button', { name: 'Show details' }))
    fireEvent.click(health.getByRole('button', { name: 'These are the same loan: count it once' }))
    await waitFor(() => expect(last(made)).toMatchObject({ linked_commitments: [{ commitment_id: 'c0', liability_id: 'l1' }] }))
  })
})

describe('views, goals and assumptions', () => {
  it('does not ask for selected goals until one is chosen, then asks with it and shows the comparison', async () => {
    const withGoal = withResult({
      view: 'selected_goals',
      goals: [{ goal_id: 'home', label: 'Home', type: 'home', status: 'on_track', target_date: '2030-12', projected_completion: '2030-06', delay_months: null, effect: 'asset_purchase', effect_month: '2030-12' }],
      comparison: { baseline_horizon_net_worth: '580000.00', baseline_horizon_cash: '580000.00', net_worth_difference: '-100000.00', cash_difference: '-300000.00' },
    })
    const { calls: made } = backend({ 'POST /trajectory/project': (init) => json(JSON.parse(String(init?.body)).view === 'selected_goals' ? withGoal : RESULT) })
    render(<App />)
    await screen.findByText('Net worth now')
    const before = calls(made).length
    fireEvent.click(screen.getByRole('button', { name: 'With selected goals' }))
    expect(await screen.findByText('Goals to include')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(calls(made)).toHaveLength(before) // no goal chosen yet: nothing is asked
    fireEvent.click(screen.getByRole('checkbox', { name: /Home ·/ }))
    await waitFor(() => expect(last(made)).toMatchObject({ view: 'selected_goals', selected_goal_ids: ['home'] }))
    const goals = await screen.findByRole('table', { name: 'Goal impact' })
    expect(within(goals).getByText('On track')).toBeInTheDocument()
    expect(within(goals).getByText('It buys an asset')).toBeInTheDocument()
    const comparison = screen.getByRole('table', { name: 'Against the baseline' })
    expect(within(comparison).getByText('-₹1,00,000')).toBeInTheDocument()
  })

  it('never guesses a custom goal’s effect, and sends the one the person chooses', async () => {
    const plan = { ...family.plan, goals: [...family.plan.goals, { id: 'trip', label: 'World trip', type: 'custom', target_amount_today: '200000.00', target_date: '2031-12', priority: 4, inflation_linked: false, current_savings: '0.00', flexibility: { max_delay_months: 24, min_target_pct: '0.8000' } }] }
    const { calls: made } = backend({}, plan)
    render(<App />)
    await screen.findByText('Net worth now')
    fireEvent.click(screen.getByRole('button', { name: 'With selected goals' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /World trip ·/ }))
    await waitFor(() => expect(last(made)).toMatchObject({ selected_goal_ids: ['trip'] }))
    expect(last(made)).toMatchObject({ goal_effects: [] }) // nothing chosen: the server holds the money aside
    expect(screen.getByText(/never guessed from its name/)).toBeInTheDocument()
    pick('World trip: When it is funded', 'It is spent')
    await waitFor(() => expect(last(made)).toMatchObject({ goal_effects: [{ goal_id: 'trip', effect: 'spend' }] }))
  })

  it('asks the scenario view to use the situation chosen in the top bar, and does not ask without one', async () => {
    const { calls: made } = backend()
    render(<App />)
    await screen.findByText('Net worth now')
    const before = calls(made).length
    fireEvent.click(screen.getByRole('button', { name: 'Scenario' }))
    expect(await screen.findByText('Choose a situation other than Normal in the top bar to use this view.')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(calls(made)).toHaveLength(before)
  })

  it('sends return assumptions only when typed, refuses a bad one, and labels none as held constant', async () => {
    const { calls: made } = backend()
    render(<App />)
    await screen.findByText('Net worth now')
    expect(last(made)).toMatchObject({ return_assumptions: [] }) // nothing is assumed for the person
    fireEvent.click(screen.getByText('More options'))
    const field = screen.getByLabelText('Shares, funds and crypto')
    fireEvent.change(field, { target: { value: 'lots' } })
    expect(await screen.findByText('Enter a rate from -50 to 50, with at most two decimals.')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '11.5' } })
    await waitFor(() => expect(last(made)).toMatchObject({ return_assumptions: [{ scope: 'class', key: 'market_investments', annual_rate: '0.115000' }] }))
  })

  it('sends the premium rule and growth the person sets', async () => {
    const { calls: made } = backend()
    render(<App />)
    await screen.findByText('Net worth now')
    fireEvent.click(screen.getByText('More options'))
    fireEvent.change(screen.getByLabelText('Yearly rise in insurance premiums (%)'), { target: { value: '8' } })
    pick('Insurance premiums', 'Add from each policy')
    await waitFor(() => expect(last(made)).toMatchObject({ premium_growth_annual: '0.080000', premiums_in_spending: 'no' }))
  })
})

describe('the detail sections', () => {
  it('lists coming-up events, the monthly detail with every event, and the assumptions and sources', async () => {
    const detailed = withResult({
      summary: { ...RESULT.summary, projected_debt_free_dates: [{ id: 'l1', name: 'Car loan', month: '2030-05', status: 'ok', reason: null, balance_now: '1.00', interest_in_period: '1.00' }], all_debts_cleared_month: '2030-05' },
    })
    backend({ 'POST /trajectory/project': () => json(detailed) })
    render(<App />)
    await screen.findByText('Net worth now')
    expect(screen.getAllByText('May 2030').length).toBeGreaterThan(0) // the debt-free date
    const coming = within(document.getElementById('trajectory-timeline') as HTMLElement)
    expect(coming.getByText(/Insurance premium: Premium: Acme Term/)).toBeInTheDocument()
    expect(coming.getByText(/Debt paid off: Car loan/)).toBeInTheDocument()
    const ledger = within(screen.getByRole('table', { name: 'Month by month' }))
    fireEvent.click(ledger.getByRole('button', { name: /Details Jan 2027/ }))
    const events = await screen.findByRole('table', { name: 'Jan 2027' })
    expect(within(events).getByText('Premium: Acme Term')).toBeInTheDocument()
    expect(within(events).getByText('An expense. Cover is not an asset.')).toBeInTheDocument()
    expect(within(events).getAllByText('-₹12,000')).toHaveLength(2) // its cash effect and its effect on net worth
    fireEvent.click(screen.getByText('Assumptions used'))
    expect(screen.getByText(/Model trajectory-1.0 · inputs aaaaaaaaaaaa/)).toBeInTheDocument()
    expect(screen.getByText('Timing')).toBeInTheDocument()
  })

  it('draws each chart with a text summary and a legend that does not rely on colour', async () => {
    backend()
    render(<App />)
    await screen.findByText('Net worth now')
    expect(screen.getByRole('img', { name: /Net worth over time: ₹1,00,000 in Jan 2027, ₹5,80,000 in Feb 2027/ })).toBeInTheDocument()
    expect(screen.getByText('Assets (solid line)')).toBeInTheDocument()
    expect(screen.getAllByText('Debts and shortfall (dashed line)').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /Cash balance/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Debt outstanding/ })).toBeInTheDocument()
    expect(screen.getByText('Where the assets are')).toBeInTheDocument()
  })

  it('shows the hindi title when the language is Hindi', async () => {
    window.localStorage.setItem('arthayukti.language', 'hi')
    backend()
    render(<App />)
    expect(await screen.findAllByText('वित्तीय प्रक्षेप-पथ')).not.toHaveLength(0)
  })
})
