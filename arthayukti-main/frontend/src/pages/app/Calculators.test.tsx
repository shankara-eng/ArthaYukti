import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const aggregate = {
  included: 1,
  principal: '100000.00',
  value: '112682.51',
  gain: '12682.51',
  total_gains: '12682.51',
  total_losses: '0.00',
  tax: '1268.25',
  post_tax_value: '111414.26',
  inflation_adjusted_value: '111414.26',
  mixed_valuation_dates: false,
}
const row = { year: 1, from_month: '2027-01', to_month: '2027-12', months: 12, phase: 'contributing', instalment: '0.00', instalments: 0, opening: '0.00', contributions: '100000.00', growth: '12682.51', closing: '112682.51', cumulative_invested: '100000.00', cumulative_gain: '12682.51', inflation_adjusted_closing: '112682.51' }
const RESULT = {
  mode: 'individual',
  common_date: null,
  investments: [
    { id: 'x', name: 'Fund A', status: 'at_maturity', start_month: '2027-01', valuation_month: '2027-12', months_valued: 12, principal: '100000.00', value: '112682.51', gain: '12682.51', tax: '1268.25', post_tax_value: '111414.26', inflation_adjusted_value: '111414.26', contributions_made: 0, annual: [row] },
  ],
  aggregate,
  compilation: {
    investment_ids: ['x'],
    aggregate,
    years: [{ year: 2027, contributions: '100000.00', closing_active: '112682.51', matured_held: '0.00', closing_total: '112682.51', cumulative_invested: '100000.00', cumulative_gain: '12682.51' }],
  },
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/equities'
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
    'GET /calculators/scenarios': () => json([]),
    'POST /calculators/maturity-check': () => json([]),
    'POST /calculators/run': () => json(RESULT),
    ...extra,
  })

async function fillValidInvestment() {
  await screen.findByRole('heading', { name: 'Investment calculators' })
  fireEvent.change(await screen.findByLabelText('Lump sum on day one (₹)'), { target: { value: '100000' } })
  // Recurring investing is on by default, so it needs an instalment or must be switched off.
  fireEvent.click(screen.getByLabelText('Also invest regularly'))
}

describe('the Calculators page', () => {
  it('asks for the marked fields and sends nothing until the form is valid', async () => {
    const { calls } = backend()
    render(<App />)
    expect(await screen.findByText('Fix the highlighted fields to see results.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/calculators/run')).toBe(false)
  })

  it('values the investment on the server and shows its figures', async () => {
    const { calls } = backend()
    render(<App />)
    await fillValidInvestment()
    expect((await screen.findAllByText('₹1,12,682.51')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹1,11,414.26').length).toBeGreaterThan(0)
    const sent = calls.find((c) => c.path === '/calculators/run')
    expect(sent?.body).toMatchObject({
      mode: 'individual',
      investments: [{ name: 'Investment 1', lump_sum: '100000.00', growth_years: 10, annual_growth: '0.120000', tax_rate: '0.0000' }],
    })
    expect(calls.some((c) => c.path === '/calculators/maturity-check')).toBe(true)
  })

  it('shows the year-by-year table on request and keeps the compiled report', async () => {
    backend()
    render(<App />)
    await fillValidInvestment()
    fireEvent.click(await screen.findByRole('button', { name: 'Show the yearly table' }))
    const table = await screen.findByRole('table', { name: 'Fund A: Year by year' })
    expect(within(table).getByText('2027-01 → 2027-12')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Compiled report' })).toBeInTheDocument()
  })

  it('asks for an explicit decision when an investment matures before the common date', async () => {
    const { calls } = backend({
      'POST /calculators/maturity-check': (init) => {
        const first = (JSON.parse(String(init?.body)) as { investments: { id: string }[] }).investments[0]
        return json([{ investment_id: first.id, name: 'Investment 1', matures: '2036-12' }])
      },
    })
    render(<App />)
    await fillValidInvestment()
    fireEvent.click(screen.getByLabelText(/All on one common date/))
    fireEvent.change(screen.getByLabelText('Common date (month)'), { target: { value: '2040-12' } })
    expect(await screen.findByText('Choose what happens after maturity')).toBeInTheDocument()
    expect(screen.getByText('Growth ends 2036-12')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Hold it as it is (no growth)'))
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/calculators/maturity-check')
      const body = last?.body as { investments: { after_maturity?: { action: string } }[] } | undefined
      expect(body?.investments[0].after_maturity).toEqual({ action: 'hold' })
    })
    expect(calls.some((c) => c.path === '/calculators/run')).toBe(false) // nothing is valued until the person chooses
  })

  it('saves the calculator under a name and lists it', async () => {
    let saved: unknown = null
    const { calls } = backend({
      'POST /calculators/scenarios': (init) => {
        saved = JSON.parse(String(init?.body))
        return json({ id: 's1', name: 'Mine', config: (saved as { config: unknown }).config, created_at: 'x', updated_at: 'x' }, 201)
      },
    })
    render(<App />)
    await fillValidInvestment()
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Give it a name to save it.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name', { selector: '#' + (screen.getAllByLabelText('Name')[0] as HTMLElement).id }), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/calculators/scenarios')).toBe(true))
    expect(saved).toMatchObject({ name: 'Mine', config: { investments: [{ lump_sum: '100000.00' }] } })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('says so when the name is already taken', async () => {
    backend({ 'POST /calculators/scenarios': () => json({ error: { code: 'name_taken', message: 'x' } }, 409) })
    render(<App />)
    await fillValidInvestment()
    fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'Mine' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('You already have a saved calculator with that name.')).toBeInTheDocument()
  })

  it('downloads the CSV from the server and reports a failure', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    let fail = false
    const { calls } = backend({
      'POST /calculators/export': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : new Response('﻿ArthaYukti investment calculator\r\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })),
    })
    render(<App />)
    await fillValidInvestment()
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/calculators/export')).toBe(true))
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('The download could not be prepared.')).toBeInTheDocument()
  })
})
