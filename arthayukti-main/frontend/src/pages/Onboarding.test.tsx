import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../api/client'
import App from '../App'
import { json, mockApi } from '../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const projection = {
  as_of: '2027-01',
  horizon_months: 12,
  summary: { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' },
  goals: [
    {
      goal_id: 'goal_1', label: 'Car', status: 'on_track', target_date: '2029-01', target_amount_today: '500000.00', inflated_target_at_deadline: '500000.00', balance_at_deadline: '500000.00',
      shortfall_at_deadline_nominal: '0.00', shortfall_at_deadline_today: '0.00', required_monthly_level_standalone: '1.00', projected_completion: '2028-06', delay_months: 0,
      average_monthly_contribution: '1.00', total_contributed: '1.00', total_withdrawn: '0.00', crowded_out_by: [],
    },
  ],
  monthly: [{ month: '2027-01', income: '90000.00', expenses: '30000.00', commitments: '0.00', one_offs: '0.00', surplus: '60000.00', free_cash: '0.00', uncovered_deficit: '0.00', goals: [] }],
  warnings: [],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/onboarding'
  setAccessToken(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const backend = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([]),
    'GET /insurance/reminders': () => json([]),
    'POST /plans': (init) => json({ id: 'p1', plan: JSON.parse(String(init?.body)), created_at: 'x', updated_at: 'y' }, 201),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    ...extra,
  })

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('guided setup', () => {
  it('walks through every step, shows live totals from what was typed, and saves a plan built from it', async () => {
    const { calls } = backend()
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add another source' }))
    type('Where does it come from?', 'Salary')
    type('Amount', '90000')
    next()

    fireEvent.click(await screen.findByRole('button', { name: 'Add an expense' }))
    type('What is it for?', 'Rent')
    type('Amount', '30000')
    expect(screen.getByText('Left over each month').closest('div')).toHaveTextContent('₹60,000')
    next()

    // Savings, investments, loans: skipped
    for (const heading of ['Savings and emergency fund', 'Investments and other assets', 'Loans and dues']) {
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      next()
    }

    expect(await screen.findByRole('heading', { name: 'Your goals' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a goal' }))
    type('Name', 'Car')
    type('Amount needed', '500000')
    next()

    expect(await screen.findByRole('heading', { name: 'Insurance' })).toBeInTheDocument()
    next()

    expect(await screen.findByRole('heading', { name: 'Review your financial picture' })).toBeInTheDocument()
    expect(screen.getByText(/Car/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save and build my outlook' }))

    expect(await screen.findByRole('heading', { name: 'Your first outlook' })).toBeInTheDocument()
    const saved = calls.find((c) => c.method === 'POST' && c.path === '/plans')
    expect(saved?.auth).toBe('Bearer tok_session')
    const plan = saved?.body as { income_streams: { label: string; monthly_net: string }[]; expenses: { monthly: string; essential: boolean }[]; goals: { label: string; priority: number; inflation_linked: boolean }[]; assumptions: { general_inflation_annual: string } }
    expect(plan.income_streams).toMatchObject([{ label: 'Salary', monthly_net: '90000.00' }])
    expect(plan.expenses).toMatchObject([{ monthly: '30000.00', essential: true }])
    expect(plan.goals).toMatchObject([{ label: 'Car', priority: 1, inflation_linked: true }])
    expect(plan.assumptions.general_inflation_annual).toBe('0.050000')
    expect(calls.filter((c) => c.path.startsWith('/financials') || c.path.startsWith('/insurance/policies'))).toHaveLength(0)
    expect(await screen.findByText('On time')).toBeInTheDocument()
  })

  it('keeps the person on a step with a message when something needed is missing', async () => {
    const { calls } = backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add another source' }))
    next() // a source with no name or amount
    expect(await screen.findByText('Give this a name.')).toBeInTheDocument()
    expect(screen.getAllByText('Enter an amount above zero.').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Money coming in' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('asks before removing a record, and keeps it if the answer is no', async () => {
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add another source' }))
    type('Where does it come from?', 'Rent received')
    fireEvent.click(screen.getByRole('button', { name: 'Remove income source 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.getByLabelText('Where does it come from?')).toHaveValue('Rent received')
    fireEvent.click(screen.getByRole('button', { name: 'Remove income source 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(screen.queryByLabelText('Where does it come from?')).toBeNull()
  })

  it('does not include an unknown-tenure loan in the plan, and says so', async () => {
    const { calls } = backend({ 'POST /financials/liabilities': () => json({ id: 'l1' }, 201) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    next() // income: none
    next() // expenses: none
    next() // savings
    next() // assets
    fireEvent.click(await screen.findByRole('button', { name: 'Add a loan' }))
    type('Lender or loan', 'Friend')
    type('Still owed', '40000')
    type('Monthly payment', '2000')
    expect(screen.getByText(/saved but its payments are left out of the plan/)).toBeInTheDocument()
    next()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a goal' }))
    type('Name', 'Trip')
    type('Amount needed', '60000')
    next()
    next() // insurance
    fireEvent.click(await screen.findByRole('button', { name: 'Save and build my outlook' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/plans' && c.method === 'POST')).toBe(true))
    const plan = calls.find((c) => c.path === '/plans' && c.method === 'POST')?.body as { commitments: unknown[] }
    expect(plan.commitments).toEqual([])
    // The loan itself is still recorded for net worth, with no months invented.
    const loan = calls.find((c) => c.path === '/financials/liabilities')?.body as { monthly_emi: string; remaining_months: number }
    expect(loan).toMatchObject({ monthly_emi: '2000.00', remaining_months: 0 })
  })

  it('reads in Hindi', async () => {
    backend()
    render(<App />)
    await screen.findByRole('button', { name: 'Start' })
    fireEvent.click(screen.getAllByRole('button', { name: 'हिन्दी' })[0])
    const heading = await screen.findByRole('heading', { name: 'आइए आपकी आर्थिक दुनिया समझें।' })
    expect(within(heading.closest('section') as HTMLElement).getByText('इस संस्करण में नहीं पूछा गया', { exact: false })).toBeInTheDocument()
  })
})
