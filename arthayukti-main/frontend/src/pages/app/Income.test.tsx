import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { parseYears } from '../../lib/incomeForm'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }
const INCOME = {
  plan_source: 'saved',
  horizon_months: 120,
  first_month: '2027-01',
  total_projected_income: '1250000.00',
  plan_growth_annual: '0.000000',
  conventions: ['Figures are annual totals.', 'A raise repeats every year.'],
  years: [
    { year: 2027, months_included: 12, annual_income: '600000.00', cumulative_income: '600000.00' },
    { year: 2028, months_included: 12, annual_income: '650000.00', cumulative_income: '1250000.00' },
  ],
  sources: [
    { id: 'ravi', label: "Ravi's income", kind: 'legacy', frequency: 'monthly', entered_amount: '55000.00', monthly_equivalent: '55000.00', start_year: null, end_year: null, ends_after: null, annual_growth: null, growth_start_year: null, effective_growth_annual: '0.000000', step_ups: [], years: [] },
  ],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/finances'
  setAccessToken(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const saved = (init: RequestInit | undefined) => json({ id: 'p1', plan: JSON.parse(String(init?.body)), created_at: 'x', updated_at: 'z' })

const backend = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    'GET /auth/me': () => json(PROFILE),
    'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
    'GET /plans/p1': () => json({ id: 'p1', plan: family.plan, created_at: 'x', updated_at: 'y' }),
    'PUT /plans/p1': saved,
    'GET /insurance/reminders': () => json([]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    'POST /income/projection': () => json(INCOME),
    'POST /expenditure/projection': () => json({ plan_source: 'saved', horizon_months: 60, first_month: '2027-01', total_projected_expenditure: '0.00', years: [] }),
    ...extra,
  })

const puts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/plans/p1')
const incomeForm = async () => within(await screen.findByRole('form', { name: 'New income' }))

async function fillNew(name: string, amount: string, extra: Record<string, string> = {}) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add income' }))
  const form = await incomeForm()
  fireEvent.change(form.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(form.getByLabelText('Amount'), { target: { value: amount } })
  for (const [label, value] of Object.entries(extra)) fireEvent.change(form.getByLabelText(label), { target: { value } })
  return form
}

describe('Income and Expenditures: the three sections', () => {
  it('shows Your Incomes, Income Trajectory and Your Expenditures, in that order', async () => {
    backend()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Incomes' })
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const at = (title: string) => names.indexOf(title)
    expect(at('Your Incomes')).toBeGreaterThan(-1)
    expect(at('Income Trajectory')).toBeGreaterThan(at('Your Incomes'))
    expect(at('Your Expenditures')).toBeGreaterThan(at('Income Trajectory'))
  })
})

describe('Your Incomes: adding, editing and confirming', () => {
  it('keeps what is typed in the form until Confirm Income, then saves it once', async () => {
    const { calls } = backend()
    render(<App />)
    const form = await fillNew('Rent received', '12000')
    expect(puts(calls)).toHaveLength(0) // nothing is saved before it is confirmed
    expect(screen.queryByText('Rent received')).not.toBeInTheDocument()
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    const body = puts(calls)[0].body as { income_streams: { label: string; amount?: string; start_year?: number }[] }
    expect(body.income_streams.some((s) => s.label === 'Rent received' && s.amount === '12000.00' && s.start_year === 2027)).toBe(true)
    expect(await screen.findByText('Rent received')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'New income' })).not.toBeInTheDocument()
  })

  it('shows the problems beside the fields and saves nothing when the form is incomplete', async () => {
    const { calls } = backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add income' }))
    const form = await incomeForm()
    expect(form.queryByText('Give this stream a name.')).not.toBeInTheDocument() // not shouted before the first attempt
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await form.findByText('Give this stream a name.')).toBeInTheDocument()
    expect(form.getByText('Enter an amount above zero.')).toBeInTheDocument()
    expect(puts(calls)).toHaveLength(0)
  })

  it('ignores a second click on Confirm Income while the first is saving', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls } = backend({ 'PUT /plans/p1': async (init) => (await gate, saved(init)) })
    render(<App />)
    const form = await fillNew('Rent received', '12000')
    const button = form.getByRole('button', { name: 'Confirm Income' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.submit(screen.getByRole('form', { name: 'New income' }))
    expect(await form.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    release()
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New income' })).not.toBeInTheDocument())
    expect(puts(calls)).toHaveLength(1)
  })

  it('keeps the form and everything typed when the save fails, and the plan is unchanged', async () => {
    const { calls } = backend({ 'PUT /plans/p1': () => json({ error: { code: 'http_error', message: 'x' } }, 500) })
    render(<App />)
    const form = await fillNew('Rent received', '12000')
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await form.findByText('This could not be saved. What you entered is kept: try again.')).toBeInTheDocument()
    expect(form.getByLabelText('Name')).toHaveValue('Rent received')
    expect(form.getByLabelText('Amount')).toHaveValue('₹12,000')
    expect(screen.queryAllByText('Rent received')).toHaveLength(0) // not shown as an income
    expect(puts(calls).length).toBeGreaterThan(0)
  })

  it('Cancel closes the form without saving anything', async () => {
    const { calls } = backend()
    render(<App />)
    const form = await fillNew('Rent received', '12000')
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New income' })).not.toBeInTheDocument()
    expect(screen.queryByText('Rent received')).not.toBeInTheDocument()
    expect(puts(calls)).toHaveLength(0)
  })

  it('edits an existing income with Save Changes', async () => {
    const { calls } = backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: "Edit Ravi's income" }))
    const form = within(screen.getByRole('form', { name: 'Edit income' }))
    expect(form.queryByRole('button', { name: 'Confirm Income' })).not.toBeInTheDocument()
    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '60000' } })
    fireEvent.click(form.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    const body = puts(calls)[0].body as { income_streams: { id: string; amount?: string; start_year?: number }[] }
    expect(body.income_streams.find((s) => s.id === 'ravi')).toMatchObject({ amount: '60000.00', start_year: 2027 })
  })

  it('labels the raise and sends its start year; the start year needs a raise and must come after the first year', async () => {
    const { calls } = backend()
    render(<App />)
    const form = await fillNew('Salary', '1200000', { 'Annual Raise (%) (optional)': '10', 'Raise Starts In Year (optional)': '2028' })
    fireEvent.change(form.getByLabelText('Raise Starts In Year (optional)'), { target: { value: '2027' } })
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await form.findByText('Enter an Annual Raise, and a year after the first year (and not after the last year).')).toBeInTheDocument()
    expect(puts(calls)).toHaveLength(0)
    fireEvent.change(form.getByLabelText('Raise Starts In Year (optional)'), { target: { value: '2028' } })
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    const body = puts(calls)[0].body as { income_streams: { label: string; annual_growth?: string; growth_start_year?: number }[] }
    expect(body.income_streams.find((s) => s.label === 'Salary')).toMatchObject({ annual_growth: '0.100000', growth_start_year: 2028 })
  })

  it('does not accept a raise start year when no raise is entered', async () => {
    backend()
    render(<App />)
    const form = await fillNew('Salary', '1200000', { 'Raise Starts In Year (optional)': '2028' })
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await form.findByText('Enter an Annual Raise, and a year after the first year (and not after the last year).')).toBeInTheDocument()
  })

  it('checks a planned change in amount before using it: it must come after the first year', async () => {
    backend()
    render(<App />)
    const form = await fillNew('Salary', '1200000')
    fireEvent.click(form.getByRole('button', { name: 'Add a change in amount' }))
    fireEvent.change(form.getByLabelText('From year 1'), { target: { value: '2020' } })
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await form.findByText('Choose a year after the first year (and not after the last year).')).toBeInTheDocument()
  })

  it('removes an income only after asking, and not the last one', async () => {
    const { calls } = backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: "Remove stream Sunita's income" }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect((puts(calls)[0].body as { income_streams: unknown[] }).income_streams).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: "Remove stream Ravi's income" })).toBeDisabled())
  })
})

describe('Income Trajectory', () => {
  it('works nothing out until Calculate Trajectory, then shows total, chart and table that agree', async () => {
    const { calls } = backend()
    render(<App />)
    await screen.findByRole('heading', { name: 'Income Trajectory' })
    expect(screen.getByText('Choose a period, then select Calculate Trajectory.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/income/projection')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Calculate Trajectory' }))
    const table = await screen.findByRole('table', { name: 'Year by year' })
    expect(within(table).getByText('₹6,50,000')).toBeInTheDocument()
    expect(within(table).getAllByText('₹12,50,000')).toHaveLength(1)
    expect(screen.getByLabelText('2027: ₹6,00,000')).toBeInTheDocument()
    expect(screen.getAllByText('₹12,50,000').length).toBeGreaterThan(1) // the total and the last cumulative row
    const sent = calls.find((c) => c.path === '/income/projection')
    expect(sent?.body).toMatchObject({ plan_id: 'p1', horizon_months: 120 }) // the default 10 years
    expect(screen.getByText('A raise repeats every year.')).toBeInTheDocument()
  })

  it('sends the chosen number of years as months and refuses a period outside 1 to 50', async () => {
    const { calls } = backend()
    render(<App />)
    const period = await screen.findByLabelText('Projection Period (Years)')
    fireEvent.change(period, { target: { value: '51' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate Trajectory' }))
    expect(await screen.findByText('Enter a whole number of years from 1 to 50.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/income/projection')).toBe(false)
    fireEvent.change(period, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate Trajectory' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/income/projection' && (c.body as { horizon_months: number }).horizon_months === 300)).toBe(true))
  })

  it('says the result is out of date when the period changes, and clears it when calculated again', async () => {
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate Trajectory' }))
    await screen.findByRole('table', { name: 'Year by year' })
    expect(screen.queryByText(/Calculate again to update it/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Projection Period (Years)'), { target: { value: '5' } })
    expect(await screen.findByText(/Calculate again to update it/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate Trajectory' }))
    await waitFor(() => expect(screen.queryByText(/Calculate again to update it/)).not.toBeInTheDocument())
  })

  it('says the result is out of date when an income is confirmed afterwards', async () => {
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate Trajectory' }))
    await screen.findByRole('table', { name: 'Year by year' })
    const form = await fillNew('Rent received', '12000')
    fireEvent.click(form.getByRole('button', { name: 'Confirm Income' }))
    expect(await screen.findByText(/Calculate again to update it/)).toBeInTheDocument()
  })

  it('keeps the last result and says so when a calculation fails', async () => {
    let fail = false
    backend({ 'POST /income/projection': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : json(INCOME)) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate Trajectory' }))
    await screen.findByRole('table', { name: 'Year by year' })
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Calculate Trajectory' }))
    expect(await screen.findByText('The projection could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Year by year' })).toBeInTheDocument()
  })

  it('downloads the CSV from the server endpoint for the calculated period, and says so when it fails', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    let fail = false
    const { calls } = backend({
      'POST /income/projection/csv': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : new Response('﻿Year,Annual projected income,Cumulative projected income\r\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate Trajectory' }))
    await screen.findByRole('table', { name: 'Year by year' })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/income/projection/csv')).toBe(true))
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText('The export did not work. Try again.')).toBeInTheDocument()
  })
})

describe('parseYears', () => {
  it('accepts whole years from 1 to 50 only', () => {
    expect(['1', '10', ' 50 ', '0', '51', '', '2.5', '-3', 'ten', '100'].map(parseYears)).toEqual([1, 10, 50, null, null, null, null, null, null, null])
  })
})
