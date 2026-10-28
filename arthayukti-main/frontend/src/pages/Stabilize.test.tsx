import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../api/client'
import App from '../App'
import family from '../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 3, on_track: 2, delayed: 1, not_achievable: 0, plan_feasible: false, uncovered_deficit_months: [], overcommitment_ratio: '1.1000', total_shortfall_today: '40000.00' }
const goal = (id: string, status: string, delay: number | null) => ({
  goal_id: id, label: id, status, target_date: '2029-01', target_amount_today: '1.00', inflated_target_at_deadline: '1.00', balance_at_deadline: '1.00',
  shortfall_at_deadline_nominal: '0.00', shortfall_at_deadline_today: '0.00', required_monthly_level_standalone: '1.00', projected_completion: '2030-01', delay_months: delay,
  average_monthly_contribution: '1.00', total_contributed: '1.00', total_withdrawn: '0.00', crowded_out_by: [],
})
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [goal('goal_1', 'on_track', 0), goal('goal_2', 'delayed', 93)], monthly: [], warnings: [] }
const NO_FIX_NEEDED = { needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/compare'
  setAccessToken(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const handlers = (fixes: () => Response) => ({
  'GET /auth/me': () => json(PROFILE),
  'GET /plans': () => json([{ id: 'p1', name: 'Plan', updated_at: 'x' }]),
  'GET /plans/p1': () => json({ id: 'p1', plan: family.plan, created_at: 'x', updated_at: 'y' }),
  'GET /insurance/reminders': () => json([]),
  'GET /insurance/dashboard': () => json({ effective_health_sum_insured: '0.00', health_ncb_total: '0.00', maximum_possible_cover: null, next_increase_amount: null, next_increase_date: null, total_base_cover: '0.00', total_cover_growth: '0.00', total_effective_cover: '0.00', upcoming_alerts_count: 0 }),
  'GET /financials/net-worth': () => json({ total_assets: '0.00', liquid_assets: '0.00', illiquid_assets: '0.00', total_liabilities: '0.00', net_worth: '0.00' }),
  'GET /financials/investments': () => json([]),
  'GET /financials/liabilities': () => json([]),
  'POST /projections': () => json(projection),
  'POST /fixes': fixes,
})

describe('the comparison page when no change is offered', () => {
  it('does not say every goal is on time while one is late and no single fix exists', async () => {
    mockApi(handlers(() => json({ needs_fix: true, options: [], recommended_option_id: null, no_single_fix_reason: 'No single change fixes every goal.' })))
    render(<App />)
    expect(await screen.findByText('No single change fixes every dream within the limits you set.', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText('Every dream is on time as it is.')).toBeNull()
  })

  it('still says everything is on time when nothing needs fixing', async () => {
    mockApi(handlers(() => json(NO_FIX_NEEDED)))
    render(<App />)
    expect(await screen.findByText('Every dream is on time as it is.')).toBeInTheDocument()
  })

  it('does not claim success when the check itself fails', async () => {
    mockApi(handlers(() => json({ error: { code: 'http_error', message: 'boom' } }, 500)))
    render(<App />)
    await screen.findByRole('heading', { name: /compare|difference/i })
    expect(screen.queryByText('Every dream is on time as it is.')).toBeNull()
  })
})

describe('the dashboard on a narrow screen', () => {
  it('lets its grid columns shrink so wide tables scroll inside their own panel', async () => {
    window.location.hash = '/dashboard'
    mockApi(handlers(() => json(NO_FIX_NEEDED)))
    render(<App />)
    await screen.findByRole('heading', { name: 'Where you stand' })
    // A grid item defaults to min-width:auto, so a 420px table would stretch the whole page without min-w-0.
    const columns = [...document.querySelectorAll('[class*="lg:col-span-"]')]
    expect(columns.length).toBeGreaterThanOrEqual(4)
    for (const column of columns) expect(column.className).toContain('min-w-0')
  })
})
