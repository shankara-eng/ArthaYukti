import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi } from '../../test/mockApi'
import { SpendingDashboard } from './SpendingDashboard'

const storeState = vi.hoisted(() => ({ plan: null as unknown, replacePlan: undefined as unknown as (plan: unknown) => void }))
vi.mock('../../state/useStore', () => ({ useStore: () => storeState }))

const settings = (extra: Record<string, unknown> = {}) => ({
  base_inflation: '0.060000',
  current_inflation: '0.060000',
  rate_changes: [],
  horizon_years: 5,
  horizon_presets: [1, 5, 10, 20, 30],
  ...extra,
})
const trajectory = {
  starts: '2026-10',
  horizon_years: 5,
  horizon_months: 60,
  plans_included: 1,
  current_inflation: '0.060000',
  total_with_inflation: '62700.00',
  total_without_inflation: '60000.00',
  years: [
    { year: 2026, months_included: 3, annual_with_inflation: '15000.00', cumulative_with_inflation: '15000.00', cumulative_without_inflation: '15000.00' },
    { year: 2027, months_included: 9, annual_with_inflation: '47700.00', cumulative_with_inflation: '62700.00', cumulative_without_inflation: '60000.00' },
  ],
}
const categories = [
  { id: 'sys:housing', name: 'Housing and rent', kind: 'system', hidden: false, archived: false, plan_count: 1 },
  { id: 'sys:other', name: 'Other', kind: 'system', hidden: false, archived: false, plan_count: 0 },
]
const plan = {
  id: 'p1', category: 'sys:housing', category_name: 'Housing and rent', category_hidden: false, category_archived: false, name: 'Rent',
  amount: '5000.00', frequency: 'monthly', monthly_equivalent: '5000.00', duration: 'today_forever', start_year: 2026, start_month: 10,
  end_year: null, end_month: null, inflation_override: null, inflation_now: '0.060000', status: 'active', changes: [],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  storeState.plan = null
})

function serve(extra: Record<string, () => Response> = {}, shown = trajectory) {
  return mockApi({
    'GET /expenditure/trajectory': () => json(shown),
    'GET /expenditure/settings': () => json(settings()),
    'GET /expenditure/plans': () => json(shown.plans_included ? [plan] : []),
    'GET /expenditure/categories': () => json(categories),
    ...extra,
  })
}

describe('SpendingDashboard', () => {
  it('shows the cumulative figure first, then the bars and the table, all from the server', async () => {
    serve()
    render(<SpendingDashboard />)
    expect(await screen.findByText('Cumulative spending with inflation')).toBeInTheDocument()
    expect(screen.getAllByText('₹62,700.00').length).toBeGreaterThan(0)
    const table = screen.getByRole('table')
    expect(within(table).getByText('₹47,700.00')).toBeInTheDocument()
    expect(within(table).getByText('3 months')).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4)
  })

  it('explains the empty state instead of inventing totals', async () => {
    serve({}, { ...trajectory, plans_included: 0, years: [], total_with_inflation: '0.00', total_without_inflation: '0.00' })
    render(<SpendingDashboard />)
    expect(await screen.findByText('No spending plans yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('changes the horizon through the server and then asks again', async () => {
    const { calls } = serve({ 'PUT /expenditure/settings': () => json(settings({ horizon_years: 10 })) })
    render(<SpendingDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: '10 years' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/expenditure/settings')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ horizon_years: 10 })
    await waitFor(() => expect(calls.filter((c) => c.path === '/expenditure/trajectory').length).toBeGreaterThan(1))
  })

  it('offers the two ways to apply a new global inflation rate', async () => {
    const { calls } = serve({ 'POST /expenditure/settings/inflation': () => json(settings({ current_inflation: '0.080000' })) })
    render(<SpendingDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: /Global inflation/ }))
    expect(screen.getByLabelText(/Recalculate the whole projection/)).toBeChecked()
    fireEvent.click(screen.getByLabelText(/Keep the rate in force before a month/))
    expect(screen.getByText('From year')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Recalculate the whole projection/))
    fireEvent.change(screen.getByLabelText('Annual inflation (%)'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/expenditure/settings/inflation')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ rate: '0.080000', mode: 'recalculate_all' })
  })

  it('downloads the trajectory the server calculated', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', { createObjectURL: created, revokeObjectURL: vi.fn() })
    const { calls } = serve({ 'GET /expenditure/trajectory.csv': () => new Response('Year\r\n', { headers: { 'Content-Type': 'text/csv' } }) })
    render(<SpendingDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(created).toHaveBeenCalled())
    expect(calls.some((c) => c.path === '/expenditure/trajectory.csv')).toBe(true)
  })

  it('says what is missing and sends nothing until the plan is complete', async () => {
    const { calls } = serve({}, { ...trajectory, plans_included: 0, years: [] })
    render(<SpendingDashboard />)
    await screen.findByText('Add an expenditure', { selector: 'h3' })
    fireEvent.click(screen.getByRole('button', { name: 'Add expenditure' }))
    expect(await screen.findByText('Choose a category.')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount above zero.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('offers to use the plans for goals only when a plan is open, and puts the returned plan back in the store', async () => {
    const applied = { name: 'Mine', spending_schedule: [{ month: '2026-10', amount: '6000.00' }] }
    storeState.replacePlan = vi.fn()
    const { calls } = serve({ 'POST /expenditure/apply-to-plan': () => json(applied) })
    render(<SpendingDashboard />)
    await screen.findByText('Cumulative spending with inflation')
    expect(screen.queryByText('Use these plans for your goals')).not.toBeInTheDocument() // no plan open: nothing to apply to
    cleanup()
    storeState.plan = { name: 'Mine', spending_schedule: [] }
    render(<SpendingDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use these plans' }))
    await waitFor(() => expect(storeState.replacePlan).toHaveBeenCalledWith(applied))
    expect(calls.find((c) => c.path === '/expenditure/apply-to-plan')?.body).toEqual({ plan: { name: 'Mine', spending_schedule: [] }, months: 240 })
  })

  it('says when the goals already read these plans, and can go back to the own expense lines', async () => {
    storeState.replacePlan = vi.fn()
    storeState.plan = { name: 'Mine', spending_schedule: [{ month: '2026-10', amount: '6000.00' }] }
    serve()
    render(<SpendingDashboard />)
    expect(await screen.findByText(/now read the spending from these plans for 1 months, starting 2026-10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Go back to my plan/ }))
    expect(storeState.replacePlan).toHaveBeenCalledWith({ name: 'Mine', spending_schedule: [] })
  })
})
