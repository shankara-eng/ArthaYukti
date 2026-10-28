import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../api/client'
import App from '../App'
import family from '../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 3, on_track: 2, delayed: 1, not_achievable: 0, plan_feasible: false, uncovered_deficit_months: [], overcommitment_ratio: '1.1000', total_shortfall_today: '40000.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const rescue = {
  is_baseline_feasible: false,
  baseline_summary: summary,
  alternatives: [
    {
      alternative_id: 'alt_delay',
      title: 'Let the home goal wait',
      description: 'Moves the home deadline later.',
      strategy: 'delay',
      is_feasible: true,
      scenario: { name: 'Delay', extra_monthly_savings: '0.00' },
      result_summary: { ...summary, on_track: 3, delayed: 0, plan_feasible: true, total_shortfall_today: '0.00' },
      monthly_savings_change: '0.00',
      total_shortfall_today: '0.00',
      constraints_satisfied: ['no_new_debt'],
      constraints_violated: [],
      tradeoffs: ['The home goal arrives later.'],
      assumptions: ['Income stays as entered.'],
    },
  ],
  recommended_alternative_id: 'alt_delay',
  unresolved_gap: null,
  binding_constraint: null,
  run_id: 'run_1',
  ranking_criteria: 'Fewest delayed goals first.',
  missing_information: [],
  assumptions: ['Spending stays as entered.'],
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
})

const backend = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
    'GET /plans/p1': () => json({ id: 'p1', plan: family.plan, created_at: 'x', updated_at: 'y' }),
    'GET /insurance/reminders': () => json([]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    ...extra,
  })

describe('rescue analysis', () => {
  it('sends the plan and the limits, and shows the engine’s options without applying any', async () => {
    window.location.hash = '/rescue'
    const { calls } = backend({ 'POST /rescue/analyze': () => json(rescue) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run the analysis' }))
    expect(await screen.findByText('Let the home goal wait')).toBeInTheDocument()
    expect(screen.getByText('Suggested option')).toBeInTheDocument()
    expect(screen.getByText('The home goal arrives later.')).toBeInTheDocument()

    const sent = calls.find((c) => c.path === '/rescue/analyze')
    expect(sent?.auth).toBe('Bearer tok_session')
    expect(sent?.body).toMatchObject({ avoid_new_debt: true, max_delay_months: 24, allow_discretionary_cut_pct: '0.20', allow_asset_sale: false, asset_sale_amount: '0.00' })
    // Nothing was written back to the saved plan.
    expect(calls.some((c) => c.path.startsWith('/plans') && c.method !== 'GET')).toBe(false)
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
  })

  it('refuses limits the engine would reject before sending anything', async () => {
    window.location.hash = '/rescue'
    const { calls } = backend()
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Longest delay I accept (months)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run the analysis' }))
    expect(await screen.findByText('Enter a whole number of months from 0 to 120.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/rescue/analyze')).toBe(false)
  })

  it('says so when the analysis fails, and shows no made-up options', async () => {
    window.location.hash = '/rescue'
    backend({ 'POST /rescue/analyze': () => json({ error: { code: 'http_error', message: 'boom' } }, 500) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run the analysis' }))
    expect(await screen.findByText('The analysis could not run. Your plan was not changed.')).toBeInTheDocument()
    expect(screen.queryByText('Suggested option')).toBeNull()
  })
})

describe('stored prices', () => {
  it('shows an unavailable price as unavailable, with no number', async () => {
    window.location.hash = '/equities'
    const { calls } = backend({
      'GET /financials/investments': () => json([]),
      'GET /financials/accounts': () => json([]),
      'GET /financials/net-worth': () => json({ total_assets: '0.00', liquid_assets: '0.00', illiquid_assets: '0.00', total_liabilities: '0.00', net_worth: '0.00' }),
      'GET /market/quotes/ABC': () => json({ symbol: 'ABC', status: 'unavailable', price: null, currency: null, asset_type: null, source: null, fetched_at: null, message: 'No stored price for ABC.', metadata: {} }),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Holdings and balances' }))
    fireEvent.change(await screen.findByLabelText('Symbol'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText('No stored price for ABC.')).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText('Price')).toBeNull()
    expect(calls.some((c) => c.path === '/market/quotes/ABC')).toBe(true)
  })

  it('refuses a symbol the server would reject', async () => {
    window.location.hash = '/equities'
    const { calls } = backend({ 'GET /financials/investments': () => json([]), 'GET /financials/accounts': () => json([]) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Holdings and balances' }))
    fireEvent.change(await screen.findByLabelText('Symbol'), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText(/Use letters, numbers/)).toBeInTheDocument()
    expect(calls.some((c) => c.path.startsWith('/market'))).toBe(false)
  })
})

describe('ledger entry and import', () => {
  it('saves one transaction as typed and says what CSV import really does', async () => {
    window.location.hash = '/finances'
    const { calls } = backend({
      'GET /financials/transactions': () => json([]),
      'GET /financials/accounts': () => json([]),
      'POST /financials/transactions': (init) => json({ id: 't1', account_id: null, created_at: 'x', description: null, is_essential: false, ...JSON.parse(String(init?.body)) }, 201),
    })
    render(<App />)
    expect(await screen.findByText(/straight away/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-02-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1200' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Groceries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/financials/transactions')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.path === '/financials/transactions')?.body).toMatchObject({
      transaction_date: '2027-02-03',
      amount: '1200.00',
      transaction_type: 'debit',
      category: 'Groceries',
      account_id: null,
    })
    expect(await screen.findByText('Saved to your ledger.')).toBeInTheDocument()
  })

  it('checks the entry before sending', async () => {
    window.location.hash = '/finances'
    const { calls } = backend({ 'GET /financials/transactions': () => json([]), 'GET /financials/accounts': () => json([]) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save transaction' }))
    expect(await screen.findByText('Choose a date.')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount above zero.')).toBeInTheDocument()
    // The app's own background projection calls may land at any moment; what must not be sent is the ledger entry.
    expect(calls.filter((c) => c.method === 'POST' && c.path.startsWith('/financials')).map((c) => c.path)).toEqual([])
  })
})

describe('cover growth', () => {
  const policy = { id: 'pol1', policy_number: 'P-1', policy_type: 'term_life', insurer_name: 'Acme', plan_name: 'Acme', start_date: '2027-01-01', renewal_date: null, expiry_date: null, base_sum_assured: '1000000.00', current_effective_sum_assured: '1000000.00', premium_amount: '12000.00', premium_frequency: 'annual', status: 'active', policy_details: null, created_at: 'x', updated_at: 'x' }

  it('records a rule and applies a step through the real endpoints, showing what the server returned', async () => {
    window.location.hash = '/insurance'
    const rule = { id: 'esc1', policy_id: 'pol1', escalation_type: 'fixed_percentage', base_sum_assured: '1000000.00', current_effective_sum_assured: '1000000.00', escalation_rate: '0.050000', fixed_escalation_amount: null, escalation_frequency: 'annual', custom_interval_months: null, first_escalation_date: null, next_escalation_date: '2028-01-01', maximum_total_cover: null, maximum_increase_percentage: null, maximum_cover_multiple: null, premium_increases_with_cover: false, medical_underwriting_required: false, age_limit: null, escalation_status: 'active', notes: null, created_at: 'x', updated_at: 'x' }
    const { calls } = backend({
      'GET /insurance/policies': () => json([policy]),
      'GET /insurance/dashboard': () => json({ effective_health_sum_insured: '0.00', health_ncb_total: '0.00', maximum_possible_cover: null, next_increase_amount: null, next_increase_date: null, total_base_cover: '1000000.00', total_cover_growth: '0.00', total_effective_cover: '1000000.00', upcoming_alerts_count: 0 }),
      'POST /insurance/escalations': () => json(rule, 201),
      'POST /insurance/escalations/esc1/process-event': () => json({ id: 'h1', escalation_id: 'esc1', policy_id: 'pol1', effective_date: '2028-01-01', event_type: 'scheduled', prior_cover: '1000000.00', increase_amount: '50000.00', resulting_cover: '1050000.00', premium_before: null, premium_after: null, underwriting_requirement: null, source: 'manual', idempotency_key: 'k', created_at: 'x' }, 201),
      'GET /insurance/escalations/esc1': () => json({ ...rule, current_effective_sum_assured: '1050000.00' }),
    })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Yearly rate (%)'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('Rule saved.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/insurance/escalations' && c.method === 'POST')?.body).toMatchObject({ policy_id: 'pol1', escalation_type: 'fixed_percentage', escalation_rate: '0.050000', escalation_frequency: 'annual' })

    fireEvent.click(screen.getByRole('button', { name: 'Apply a step now' }))
    expect((await screen.findAllByText('₹10,50,000')).length).toBeGreaterThan(0)
    expect(calls.some((c) => c.path === '/insurance/escalations/esc1/process-event')).toBe(true)
  })
})
