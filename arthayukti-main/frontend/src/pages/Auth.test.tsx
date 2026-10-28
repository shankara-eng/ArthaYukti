import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../api/client'
import App from '../App'
import family from '../../../contracts/samples/family_stretched.json'
import { json, mockApi, unauthorized } from '../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const SESSION = { access_token: 'tok_session', token_type: 'bearer', user: PROFILE }
const plan = family.plan
const projection = {
  as_of: '2027-01',
  horizon_months: 12,
  summary: { goals_total: 3, on_track: 3, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' },
  goals: [],
  monthly: [],
  warnings: [],
}

const common = {
  'GET /health': () => json({ status: 'ok' }),
  'GET /insurance/reminders': () => json([]),
  'GET /financials/net-worth': () => json({ total_assets: '0.00', liquid_assets: '0.00', illiquid_assets: '0.00', total_liabilities: '0.00', net_worth: '0.00' }),
  'GET /financials/investments': () => json([]),
  'GET /financials/liabilities': () => json([]),
  'GET /insurance/dashboard': () => json({ effective_health_sum_insured: '0.00', health_ncb_total: '0.00', maximum_possible_cover: null, next_increase_amount: null, next_increase_date: null, total_base_cover: '0.00', total_cover_growth: '0.00', total_effective_cover: '0.00', upcoming_alerts_count: 0 }),
  'POST /projections': () => json(projection),
  'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
}

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
  window.sessionStorage.clear()
  setAccessToken(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function signIn(email = 'asha@example.test', password = 'Correct-Pass-123') {
  fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('signing in', () => {
  it('sends a signed-out visitor from a private page to the sign-in screen', async () => {
    window.location.hash = '/dashboard'
    mockApi({})
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
  })

  it('signs in through the real endpoint, keeps the token (not the password) for this tab, and lands a new account on the homepage', async () => {
    window.location.hash = '/login'
    const { calls } = mockApi({
      ...common,
      'POST /auth/login': () => json(SESSION),
      'GET /plans': () => json([]),
    })
    render(<App />)
    await signIn()
    // A new account goes straight to the homepage with guidance, not into a setup wizard.
    expect(await screen.findByRole('heading', { name: 'Welcome. Start with whatever you know.' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/dashboard')
    expect(screen.queryByRole('heading', { name: 'Let us understand your financial world.' })).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/plans')).toBe(false)

    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'asha@example.test', password: 'Correct-Pass-123' })
    expect(calls.find((c) => c.path === '/plans')?.auth).toBe('Bearer tok_session')
    expect(window.sessionStorage.getItem('arthayukti.session')).toBe('tok_session')
    const stored = JSON.stringify({ ...window.sessionStorage }) + JSON.stringify({ ...window.localStorage })
    expect(stored).not.toContain('Correct-Pass-123')
  })

  it('opens the dashboard for someone who already has a saved plan', async () => {
    window.location.hash = '/login'
    mockApi({
      ...common,
      'POST /auth/login': () => json(SESSION),
      'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: '2027-01-01' }]),
      'GET /plans/p1': () => json({ id: 'p1', plan, created_at: 'x', updated_at: 'y' }),
    })
    render(<App />)
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Where you stand' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/dashboard')
  })

  it('does not pretend a failed sign-in worked', async () => {
    window.location.hash = '/login'
    mockApi({ 'POST /auth/login': () => json({ error: { code: 'unauthorized', message: 'Incorrect email or password.' } }, 401) })
    render(<App />)
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(window.sessionStorage.getItem('arthayukti.session')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
  })

  it('says so when the server cannot be reached, and when there are too many attempts', async () => {
    window.location.hash = '/login'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    render(<App />)
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the server')
    cleanup()
    mockApi({ 'POST /auth/login': () => json({ error: { code: 'rate_limited', message: 'slow down' } }, 429) })
    render(<App />)
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  })

  it('checks the form before sending anything', async () => {
    window.location.hash = '/login'
    const { fetchMock } = mockApi({})
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows and hides the password on request', async () => {
    window.location.hash = '/login'
    mockApi({})
    render(<App />)
    const field = await screen.findByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
  })
})

describe('a session that ends', () => {
  it('returns to sign-in with a message when the server stops accepting the token', async () => {
    window.sessionStorage.setItem('arthayukti.session', 'tok_old')
    window.location.hash = '/dashboard'
    mockApi({
      ...common,
      'GET /auth/me': () => json(PROFILE),
      'GET /plans': () => unauthorized(),
    })
    render(<App />)
    expect(await screen.findByText('Your session ended. Please sign in again.')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('arthayukti.session')).toBeNull()
  })

  it('drops a stored token the server no longer accepts', async () => {
    window.sessionStorage.setItem('arthayukti.session', 'tok_old')
    window.location.hash = '/dashboard'
    mockApi({ 'GET /auth/me': () => unauthorized() })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('arthayukti.session')).toBeNull()
  })

  it('signs out through the server and forgets the token', async () => {
    window.sessionStorage.setItem('arthayukti.session', 'tok_session')
    window.location.hash = '/dashboard'
    const { calls } = mockApi({
      ...common,
      'GET /auth/me': () => json(PROFILE),
      'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
      'GET /plans/p1': () => json({ id: 'p1', plan, created_at: 'x', updated_at: 'y' }),
      'POST /auth/logout': () => json({ message: 'ok' }),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true)
    expect(window.sessionStorage.getItem('arthayukti.session')).toBeNull()
  })
})

describe('creating an account', () => {
  async function fillSignup(overrides: Partial<Record<'name' | 'email' | 'password' | 'again', string>> = {}, consent = true) {
    const v = { name: 'Asha', email: 'asha@example.test', password: 'Fresh-Pass-12345', again: 'Fresh-Pass-12345', ...overrides }
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: v.name } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: v.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: v.password } })
    fireEvent.change(screen.getByLabelText('Type the password again'), { target: { value: v.again } })
    if (consent) fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  }

  it('refuses weak passwords, mismatches and a missing confirmation before sending', async () => {
    window.location.hash = '/signup'
    const { fetchMock } = mockApi({})
    render(<App />)
    await fillSignup({ password: 'short', again: 'short' }, false)
    expect(await screen.findByText('The password needs at least 10 characters.')).toBeInTheDocument()
    expect(screen.getByText('Please confirm this to continue.')).toBeInTheDocument()
    await fillSignup({ password: 'Fresh-Pass-12345', again: 'Different-Pass-1' }, false)
    expect(await screen.findByText('The two passwords are not the same.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the account through the real endpoint with only basic details and lands on the homepage', async () => {
    window.location.hash = '/signup'
    const { calls } = mockApi({ ...common, 'POST /auth/signup': () => json(SESSION, 201), 'GET /plans': () => json([]) })
    render(<App />)
    await fillSignup()
    expect(await screen.findByRole('heading', { name: 'Welcome. Start with whatever you know.' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/dashboard')
    // Only name, email and password go to the server: no income, spending, goals or any other financial detail.
    expect(calls.find((c) => c.path === '/auth/signup')?.body).toEqual({ email: 'asha@example.test', password: 'Fresh-Pass-12345', full_name: 'Asha' })
    expect(calls.some((c) => c.method === 'POST' && c.path === '/plans')).toBe(false)
  })

  it('does not say whether an address already exists', async () => {
    window.location.hash = '/signup'
    mockApi({ 'POST /auth/signup': () => json({ error: { code: 'http_error', message: 'We could not create an account with these details.' } }, 400) })
    render(<App />)
    await fillSignup()
    expect(await screen.findByRole('alert')).toHaveTextContent('could not create an account with these details')
    expect(screen.queryByText(/already exists|already registered/i)).toBeNull()
  })
})

describe('forgotten password', () => {
  async function ask() {
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'asha@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  }

  it('gives the same generic answer the server gives', async () => {
    window.location.hash = '/forgot-password'
    mockApi({ 'POST /auth/password-reset/request': () => json({ message: 'If that address is registered, a reset link has been sent to it.' }) })
    render(<App />)
    await ask()
    expect(await screen.findByRole('status')).toHaveTextContent('If that address is registered')
  })

  it('says plainly when reset by e-mail is not available', async () => {
    window.location.hash = '/forgot-password'
    mockApi({ 'POST /auth/password-reset/request': () => json({ error: { code: 'http_error', message: 'not available' } }, 503) })
    render(<App />)
    await ask()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not available yet'))
  })
})
