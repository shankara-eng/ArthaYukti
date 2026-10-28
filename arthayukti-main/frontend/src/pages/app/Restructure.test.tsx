import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { parseRoute } from '../../lib/route'
import { rateToPercent } from '../../lib/inflation'
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
  unassigned_savings: '0.00',
}

const analysis = (extra = {}) => ({
  monthly_essentials: '40000.00', target_months: 6, target_amount: '240000.00', has_goal: true, goal_id: 'reserve', goal_label: 'Emergency fund',
  goal_target_today: '240000.00', reserve_held: '120000.00', months_covered: '3.0', progress: '0.5000', shortfall_to_target: '120000.00',
  projected: [{ month: '2027-01', balance: '130000.00' }, { month: '2027-02', balance: '140000.00' }, { month: '2027-03', balance: '150000.00' }],
  goal_status: 'on_track', projected_completion: '2027-12', notes: ['The reserve is the saved balance of your emergency-fund goal, counted once.'], ...extra,
})

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

const backend = (extra: Parameters<typeof mockApi>[0] = {}, plan: unknown = PLAN) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
    'GET /plans/p1': () => json({ id: 'p1', plan, created_at: 'x', updated_at: 'y' }),
    'GET /insurance/reminders': () => json([]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    'GET /auth/preferences': () => json({ default_inflation_annual: '0.065000', is_default: false }),
    ...extra,
  })

describe('navigation', () => {
  it('lists the new structure and none of the removed pages', async () => {
    window.location.hash = '/dashboard'
    backend()
    render(<App />)
    await screen.findByRole('heading', { name: 'Where you stand' })
    const text = screen.getAllByRole('navigation', { name: 'Main menu' }).map((n) => n.textContent ?? '').join(' ')
    for (const label of ['Dashboard', 'User Profile', 'Income and Expenditures', 'Insurance', 'Debts', 'Equities', 'Calculators', 'Emergency Funds', 'Financial goals', 'Financial outlook', 'Plan B and Rescue', 'Settings']) {
      expect(text).toContain(label)
    }
    for (const gone of ['Taxes', 'Import & transactions', 'Household profile', 'Assets & investments', 'Income & expenses']) {
      expect(text).not.toContain(gone)
    }
  })

  it('sends old bookmarks to where the content lives now, and the Taxes page no longer exists', () => {
    expect(parseRoute('#/assets')).toBe('equities')
    expect(parseRoute('#/import')).toBe('finances')
    expect(parseRoute('#/taxes')).toBe('dashboard')
    expect(parseRoute('#/emergency')).toBe('emergency')
    expect(parseRoute('#/calculators')).toBe('calculators') // a section of real calculators; Insurance, Debts and Equities stand apart from it
  })

  it('opens Plan B from its own navigation entry', async () => {
    window.location.hash = '/plan-b'
    backend({ 'GET /recovery/agreements': () => json([]) })
    render(<App />)
    expect(await screen.findByText('Protect what matters. Change what is flexible. Know when to restart.')).toBeInTheDocument()
  })
})

describe('Income and Expenditures', () => {
  it('has the incomes heading and the transactions section on one page, and no Calculators shortcut', async () => {
    window.location.hash = '/finances'
    backend({ 'GET /financials/transactions': () => json([]), 'GET /financials/accounts': () => json([]) })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your Incomes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Opens*Calculators/ })).not.toBeInTheDocument()
  })
})

describe('Insurance, Debts and Equities', () => {
  it('are separate areas of their own, each opening directly, not nested under Calculators', async () => {
    window.location.hash = '/debts'
    backend({ 'GET /financials/liabilities': () => json([]) })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Loan repayment calculator' })).toBeInTheDocument()
    expect(screen.queryByText('Back to Calculators')).not.toBeInTheDocument()
    const menu = screen.getAllByRole('navigation', { name: 'Main menu' })[0]
    for (const name of ['Insurance', 'Debts', 'Equities']) expect(within(menu).getByRole('button', { name })).toBeInTheDocument()
    // Calculators is its own entry beside them, not a parent: none of the three is nested under it.
    expect(within(menu).getByRole('button', { name: 'Calculators' })).toBeInTheDocument()
  })

  it('opens Insurance on its own', async () => {
    window.location.hash = '/insurance'
    backend({ 'GET /insurance/policies': () => json([]), 'GET /insurance/dashboard': () => json({ effective_health_sum_insured: '0.00', health_ncb_total: '0.00', maximum_possible_cover: null, next_increase_amount: null, next_increase_date: null, total_base_cover: '0.00', total_cover_growth: '0.00', total_effective_cover: '0.00', upcoming_alerts_count: 0 }) })
    render(<App />)
    expect(await screen.findByText(/Cover and premiums are exactly what you enter/)).toBeInTheDocument()
  })

  it('Equities shows the investment calculator first and the holdings on request', async () => {
    window.location.hash = '/equities'
    backend({ 'GET /calculators/scenarios': () => json([]), 'GET /financials/investments': () => json([]), 'GET /financials/accounts': () => json([]) })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Investment calculators' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Holdings and balances' }))
    expect(await screen.findByLabelText('Symbol')).toBeInTheDocument()
  })

  it('starts a new investment from the persons default inflation, which they can still override', async () => {
    window.location.hash = '/equities'
    backend({ 'GET /calculators/scenarios': () => json([]) })
    render(<App />)
    const field = await screen.findByLabelText('Yearly inflation (%)')
    expect(field).toHaveValue('6.5')
    fireEvent.change(field, { target: { value: '3' } })
    expect(field).toHaveValue('3')
  })
})

describe('Debts calculator', () => {
  const answer = {
    monthly_emi: '8884.88', total_principal: '100000.00', total_interest_paid: '6618.56', total_amount_paid: '106618.56', effective_months: 12, months_saved: 0, interest_saved: '0.00',
    schedule: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, payment: '8884.88', principal_paid: '7884.88', interest_paid: '1000.00', extra_payment: '0.00', remaining_balance: i === 11 ? '0.00' : '50000.00' })),
  }
  const modules = { 'GET /financials/liabilities': () => json([]) }

  async function open() {
    window.location.hash = '/debts'
    render(<App />)
    return screen.findByLabelText('Amount still owed (₹)')
  }

  it('asks for what is missing and sends nothing until the form is valid', async () => {
    const { calls } = backend(modules)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText('Enter the amount owed.')).toBeInTheDocument()
    expect(screen.getByText('Enter a rate from 0 to 30, with at most two decimals.')).toBeInTheDocument()
    expect(screen.getByText('Enter whole months from 1 to 1200.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/debt/amortize')).toBe(false)
  })

  it('sends the typed figures to the debt engine and shows what it returns, apart from what was typed', async () => {
    const { calls } = backend({ ...modules, 'POST /debt/amortize': () => json(answer) })
    const balance = await open()
    fireEvent.change(balance, { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('Loan interest rate (% a year)'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Months left to repay'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    const region = await screen.findByRole('region', { name: 'Calculated by ArthaYukti' })
    expect(within(region).getAllByText(/8,884\.88/).length).toBeGreaterThan(0)
    expect(within(region).getByText('You entered')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/debt/amortize')?.body).toEqual({ principal: '100000.00', annual_interest_rate: '0.120000', tenure_months: 12, monthly_emi: null, extra_monthly_payment: '0.00' })
    expect(screen.getByText(/not a quote from a lender/)).toBeInTheDocument()
  })

  it('explains a payment that is too low instead of showing a schedule that never ends', async () => {
    backend({ ...modules, 'POST /debt/amortize': () => json({ error: { code: 'payment_too_low', message: 'x' } }, 422) })
    fireEvent.change(await open(), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('Loan interest rate (% a year)'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Months left to repay'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Your monthly payment (₹), optional'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText('That payment is too low to pay the loan off. Raise it above the monthly interest.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Calculated by ArthaYukti' })).toBeNull()
  })

  it('will not compare repayment orders until there are saved debts', async () => {
    const { calls } = backend(modules)
    await open()
    expect(await screen.findByText('Add your debts below first, then compare.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare repayment orders' })).toBeNull()
    expect(calls.some((c) => c.path === '/debt/compare-strategies')).toBe(false)
  })
})

describe('Emergency Funds', () => {
  const profile = { 'GET /household/profile': () => json({ emergency_fund_months_target: 6 }) }

  it('shows the reserve, target, cover and progress that the server worked out, and the engine projection', async () => {
    window.location.hash = '/emergency'
    const { calls } = backend({ ...profile, 'POST /emergency-fund/analyze': () => json(analysis()) })
    render(<App />)
    expect(await screen.findByText('Held in your reserve')).toBeInTheDocument()
    expect(await screen.findByText('3.0')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress to target' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText(/Still to build/)).toBeInTheDocument()
    expect(screen.getByText('On track · Reaches its goal target in December 2027')).toBeInTheDocument()
    const sent = calls.find((c) => c.path === '/emergency-fund/analyze')?.body as { target_months: number; plan: { goals: { type: string }[] } }
    expect(sent.target_months).toBe(6)
    expect(sent.plan.goals[0].type).toBe('emergency_fund')
  })

  it('saves the target to the profile and refuses one outside 1 to 60 months', async () => {
    window.location.hash = '/emergency'
    const { calls } = backend({ ...profile, 'POST /emergency-fund/analyze': () => json(analysis()), 'PUT /household/profile': () => json({ emergency_fund_months_target: 9 }) })
    render(<App />)
    const field = await screen.findByLabelText('Your target, in months of essentials')
    expect(field).toHaveValue('6')
    fireEvent.change(field, { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }))
    expect(await screen.findByText('Enter whole months from 1 to 60.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/household/profile')).toBe(false)
    fireEvent.change(field, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }))
    expect(await screen.findByText('Target saved.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/household/profile')?.body).toEqual({ emergency_fund_months_target: 9 })
  })

  it('changing the held reserve edits the goal in the plan and saves nothing by itself', async () => {
    window.location.hash = '/emergency'
    const { calls } = backend({ ...profile, 'POST /emergency-fund/analyze': () => json(analysis()) })
    render(<App />)
    const held = await screen.findByLabelText('Saved in the emergency fund (₹)')
    fireEvent.change(held, { target: { value: '150000' } })
    // The analysis is requested again with the edited plan (after a short pause for typing).
    const lastSavings = () => (calls.filter((c) => c.path === '/emergency-fund/analyze').at(-1)?.body as { plan: { goals: { current_savings: string }[] } } | undefined)?.plan.goals[0].current_savings
    await waitFor(() => expect(lastSavings()).toBe('150000.00'))
    expect(calls.some((c) => (c.method === 'PUT' || c.method === 'POST') && c.path.startsWith('/plans'))).toBe(false)
  })

  it('invents nothing when there is no emergency goal, and only adds one when asked', async () => {
    window.location.hash = '/emergency'
    const none = analysis({ has_goal: false, goal_id: null, goal_label: null, goal_target_today: null, reserve_held: null, months_covered: null, progress: null, shortfall_to_target: null, projected: [], goal_status: null, projected_completion: null })
    const noGoalPlan = { ...PLAN, goals: [{ ...PLAN.goals[0], type: 'home', id: 'home' }] }
    const { calls } = backend({ ...profile, 'POST /emergency-fund/analyze': () => json(none) }, noGoalPlan)
    render(<App />)
    expect(await screen.findByText('No emergency fund yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Saved in the emergency fund (₹)')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Add an emergency fund goal' }))
    expect(await screen.findByLabelText('Saved in the emergency fund (₹)')).toHaveValue('₹0')
    const added = () => (calls.filter((c) => c.path === '/emergency-fund/analyze').at(-1)?.body as { plan: { goals: { type: string; target_amount_today: string }[] } } | undefined)?.plan.goals.find((g) => g.type === 'emergency_fund')?.target_amount_today
    await waitFor(() => expect(added()).toBe('240000.00'))
  })

  it('works for an account with no goals yet by sending only the spending, not an invalid plan', async () => {
    window.location.hash = '/emergency'
    const empty = { ...PLAN, goals: [] }
    const none = analysis({ has_goal: false, goal_id: null, goal_label: null, goal_target_today: null, reserve_held: null, months_covered: null, progress: null, shortfall_to_target: null, projected: [], goal_status: null, projected_completion: null })
    const { calls } = backend({ ...profile, 'POST /emergency-fund/analyze': () => json(none) }, empty)
    render(<App />)
    expect(await screen.findByText('No emergency fund yet')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path === '/emergency-fund/analyze')).toBe(true))
    const sent = calls.find((c) => c.path === '/emergency-fund/analyze')?.body as Record<string, unknown>
    expect(sent.plan).toBeUndefined()
    expect(Array.isArray(sent.expenses)).toBe(true)
  })

  it('says so when the figures cannot be loaded', async () => {
    window.location.hash = '/emergency'
    backend({ ...profile, 'POST /emergency-fund/analyze': () => json({ error: { code: 'server_error', message: 'x' } }, 500) })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('Default Inflation Rate', () => {
  it('shows the saved rate, keeps it as an annual percentage, and says whether it is the starting value', async () => {
    window.location.hash = '/settings'
    backend({ 'GET /auth/preferences': () => json({ default_inflation_annual: '0.050000', is_default: true }) })
    render(<App />)
    const field = await screen.findByLabelText('Default Inflation Rate (% per year)')
    await waitFor(() => expect(field).toHaveValue('5'))
    expect(screen.getByText(/starting value/)).toBeInTheDocument()
  })

  it('refuses an invalid rate and saves a valid one to the account', async () => {
    window.location.hash = '/settings'
    const { calls } = backend({ 'PUT /auth/preferences': (init) => json({ default_inflation_annual: JSON.parse(String(init?.body)).default_inflation_annual, is_default: false }) })
    render(<App />)
    const field = await screen.findByLabelText('Default Inflation Rate (% per year)')
    await waitFor(() => expect(field).toHaveValue('6.5'))
    fireEvent.change(field, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText('Enter a rate from 0 to 30 per year, with at most two decimals.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/auth/preferences')).toBe(false)
    fireEvent.change(field, { target: { value: '7.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText(/Saved\. New plans and investments will start from this rate/)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/auth/preferences')?.body).toEqual({ default_inflation_annual: '0.072500' })
  })

  it('reports a failed save and puts the rate into the plan on screen only when asked, without saving it', async () => {
    window.location.hash = '/settings'
    const { calls } = backend({ 'PUT /auth/preferences': () => json({ error: { code: 'server_error', message: 'x' } }, 500) })
    render(<App />)
    const field = await screen.findByLabelText('Default Inflation Rate (% per year)')
    await waitFor(() => expect(field).toHaveValue('6.5'))
    fireEvent.change(field, { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText('The rate could not be saved. Try again.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to my current plan' }))
    expect(await screen.findByText(/Applied to the plan on screen/)).toBeInTheDocument()
    expect(calls.some((c) => (c.method === 'PUT' || c.method === 'POST') && c.path.startsWith('/plans'))).toBe(false)
  })

  it('turns a six-decimal rate into the percentage a person reads', () => {
    expect(rateToPercent('0.065000')).toBe('6.5')
    expect(rateToPercent('0.050000')).toBe('5')
    expect(rateToPercent('0.000000')).toBe('0')
    expect(rateToPercent('0.072500')).toBe('7.25')
    expect(rateToPercent('0.300000')).toBe('30')
  })
})

describe('Outlook and Goals for an account with no goals yet', () => {
  it('says there is nothing to project and points to adding a goal, instead of loading forever', async () => {
    window.location.hash = '/outlook-feasibility'
    backend({}, { ...PLAN, goals: [] })
    render(<App />)
    expect(await screen.findByRole('link', { name: /goal/i })).toHaveAttribute('href', '#/dreams')
    expect(screen.queryByText(/Loading/)).toBeNull()
  })
})

describe('a new account', () => {
  it('lands on the homepage with guidance and no invented figures, with the guided setup still on offer', async () => {
    window.location.hash = '/dashboard'
    backend({}, null)
    mockApi({
      'GET /auth/me': () => json(PROFILE),
      'GET /plans': () => json([]),
      'GET /insurance/reminders': () => json([]),
      'GET /auth/preferences': () => json({ default_inflation_annual: '0.050000', is_default: true }),
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Welcome. Start with whatever you know.' })).toBeInTheDocument()
    for (const name of ['Income and Expenditures', 'Insurance', 'Debts', 'Equities', 'Emergency Funds', 'Goals', 'Financial outlook']) {
      expect(screen.getAllByRole('heading', { name }).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('button', { name: 'Start guided setup' })).toBeInTheDocument()
  })
})
