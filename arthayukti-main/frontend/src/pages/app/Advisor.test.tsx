import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const assessment = (extra: Record<string, unknown> = {}) => ({
  target_date: '2031-12',
  target_amount_today: '2500000.00',
  target_at_date: '3000000.00',
  available_funding: '2500000.00',
  funding_gap: '500000.00',
  required_monthly: '40000.00',
  projected_completion: '2032-05',
  delay_months: 5,
  status: 'at_risk',
  reasons: ['Funded 5 month(s) after the date, within the 24 month(s) you said you can wait.'],
  effects_on_others: [],
  ...extra,
})

const metrics = (extra: Record<string, unknown> = {}) => ({
  monthly_surplus: '60000.00',
  minimum_cash: '15000.00',
  minimum_cash_month: '2027-06',
  uncovered_cash_months: 0,
  horizon_net_worth: '4000000.00',
  horizon_net_worth_real: '3100000.00',
  goals_achievable: 1,
  goals_total: 2,
  total_funding_gap: '500000.00',
  goals: [
    { goal_id: 'emergency', label: 'Emergency fund', status: 'achievable', target_date: '2027-12', projected_completion: '2027-12', funding_gap: '0.00' },
    { goal_id: 'home', label: 'Home', status: 'at_risk', target_date: '2031-12', projected_completion: '2032-05', funding_gap: '500000.00' },
  ],
  debt_free: [],
  ...extra,
})

const deltas = (extra: Record<string, unknown> = {}) => ({
  monthly_surplus: '0.00',
  minimum_cash: '0.00',
  horizon_net_worth: '12000.00',
  horizon_net_worth_real: '9000.00',
  total_funding_gap: '-12000.00',
  goals_achievable: 0,
  uncovered_cash_months: 0,
  goal_changes: [],
  ...extra,
})

const scenario = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  analysis_id: 'a1',
  snapshot_id: 'snap_abc',
  model_version: 'advisor-1.0',
  tool: 'simulate_expense_change',
  title: 'Spend ₹1,000 a month less on optional items',
  inputs: { percent: '10' },
  assumptions: ['Optional spending lines total 10000.00 a month today.'],
  feasible: true,
  violations: [],
  goal_effects_modelled: true,
  metrics: metrics({ total_funding_gap: '488000.00', horizon_net_worth: '4012000.00' }),
  baseline_metrics: metrics(),
  deltas: deltas(),
  details: { monthly_saving: '1000.00' },
  proposed_changes: [{ record: 'expense', id: 'e1', label: 'Dining out', field: 'monthly', before: '10000.00', after: '9000.00' }],
  ...extra,
})

const rejected = scenario({ id: 's2', tool: 'simulate_investment_change', title: 'Invest ₹5,00,000 monthly', feasible: false, violations: ['It would take your cash below zero.'], proposed_changes: [] })

const rec = (extra: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  title: 'Spend ₹1,000 a month less on optional items',
  category: 'spending',
  priority: 'high',
  action: 'Spend a little less on optional items.',
  rationale: 'Goals achievable: 1 of 2 today.',
  steps: ['Choose which optional lines to trim.'],
  risks: ['A cut that is hard to keep does not deliver these figures.'],
  confidence: 'medium',
  scenario_id: 's1',
  calculated: true,
  source: 'engine',
  status: 'proposed',
  has_source_changes: true,
  ...extra,
})

const analysis = (extra: Record<string, unknown> = {}) => ({
  id: 'a1',
  analysis_id: 'a1',
  snapshot_id: 'snap_abc',
  snapshot_hash: 'h'.repeat(64),
  plan_id: 'p1',
  plan_name: 'Plan',
  model_version: 'advisor-1.0',
  prompt_version: 'advisor-prompt-1.0',
  created_at: '2027-01-02T00:00:00+00:00',
  as_of: '2027-01',
  currency: 'INR',
  horizon_months: 120,
  stale: false,
  stale_reason: null,
  ai_used: false,
  ai_status: 'not_requested',
  ai_message: null,
  data_quality: { missing_fields: ['User Profile: household age'], stale_values: [], assumptions: ['Return on spendable cash: None (Rule: cash earns nothing here)'], conflicts: [], completeness: 'partial' },
  baseline_metrics: metrics(),
  trajectory_years: [
    { year: 2027, closing_cash: '20000.00', closing_assets: '900000.00', closing_liabilities: '100000.00', closing_net_worth: '800000.00', closing_net_worth_real: '780000.00' },
    { year: 2028, closing_cash: '25000.00', closing_assets: '1500000.00', closing_liabilities: '90000.00', closing_net_worth: '1410000.00', closing_net_worth_real: '1300000.00' },
  ],
  goal_date_comparison: [
    {
      goal_id: 'emergency',
      label: 'Emergency fund',
      type: 'emergency_fund',
      priority: 1,
      saved_target_date: '2027-12',
      target_definition: 'nominal',
      original: assessment({ target_date: '2027-12', status: 'achievable', funding_gap: '0.00', reasons: [], delay_months: 0, projected_completion: '2027-12' }),
      plus_3_years: assessment({ target_date: '2030-12', status: 'achievable', funding_gap: '0.00', reasons: [], delay_months: 0 }),
      time_sensitive: true,
      caveats: ['Delaying an emergency fund leaves you without that cushion for three more years.'],
    },
    {
      goal_id: 'home',
      label: 'Home',
      type: 'home',
      priority: 2,
      saved_target_date: '2031-12',
      target_definition: 'today_money',
      original: assessment(),
      plus_3_years: assessment({ target_date: '2034-12', status: 'achievable', funding_gap: '0.00', delay_months: 0, reasons: [], effects_on_others: [{ goal_id: 'emergency', label: 'Emergency fund', status_before: 'achievable', status_after: 'at_risk' }] }),
      time_sensitive: false,
      caveats: [],
    },
  ],
  report: {
    overall_summary: '1 of 2 goals are achievable by their saved dates on your current plan.',
    key_findings: [{ id: 'f-home', text: "'Home' is at risk at 2031-12: funding gap ₹5,00,000.", severity: 'warning', metric_ref: 'goal:home' }],
    recommendations: [rec()],
    tradeoffs: [{ recommendation_id: 'rec-1', improves: ['Net worth at the end of the projection: +₹12,000'], worsens: [], affected: 'You' }],
    assumptions: [],
    data_gaps: [],
    follow_up_questions: [],
    action_plan: [{ step: 'Choose which optional lines to trim.', timing: null, requires_confirmation: true }],
    uncertainty: 'Nothing here is guaranteed.',
  },
  scenarios: [scenario(), rejected],
  validation_notes: [],
  disclaimer: 'x',
  ...extra,
})

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/advisor'
  setAccessToken(null)
  Element.prototype.scrollIntoView = vi.fn()
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
    'GET /advisor/analyses/latest': () => json(analysis()),
    ...extra,
  })

async function open() {
  render(<App />)
  await screen.findByRole('heading', { name: 'AI Financial Advisor' })
}

const tab = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))
const only = (all: { method: string; path: string; body: unknown }[], method: string, path: string) => all.filter((c) => c.method === method && c.path === path)

describe('the advisor page', () => {
  it('starts empty when there is no analysis, and runs one on request', async () => {
    const { calls } = backend({
      'GET /advisor/analyses/latest': () => json({ error: { code: 'not_found', message: 'No analysis yet.' } }, 404),
      'POST /advisor/analyze': () => json(analysis()),
    })
    await open()
    expect(await screen.findByText(/No analysis yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Analyse my finances' }))
    expect(await screen.findByText('1 of 2 goals are achievable by their saved dates on your current plan.')).toBeInTheDocument()
    expect(only(calls, 'POST', '/advisor/analyze')[0].body).toMatchObject({ language: 'en', use_ai: true })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('₹15,000')).toBeInTheDocument() // lowest cash balance, exactly as calculated
  })

  it('shows the findings with a word for their severity, the baseline table and the data gaps', async () => {
    backend()
    await open()
    expect(await screen.findByText(/Warning:/)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Baseline trajectory (no change)'.replace('no change', 'no changes') })
    expect(within(table).getByText('₹14,10,000')).toBeInTheDocument()
    expect(screen.getByText('User Profile: household age')).toBeInTheDocument()
    expect(screen.getByText(/never filled in with zero/)).toBeInTheDocument()
  })

  it('shows every goal at its saved date and three years later, and says the saved date is unchanged', async () => {
    backend()
    await open()
    await tab('Goal review')
    expect(await screen.findByText('Saved date: December 2031 (unchanged)')).toBeInTheDocument()
    for (const name of ['Emergency fund', 'Home']) {
      const card = screen.getByRole('heading', { name }).closest('li') as HTMLElement
      const original = within(card).getByRole('region', { name: `${name}: At the saved date` })
      const later = within(card).getByRole('region', { name: `${name}: Three years later` })
      expect(original).toBeInTheDocument()
      expect(later).toBeInTheDocument()
    }
    const home = screen.getByRole('heading', { name: 'Home' }).closest('li') as HTMLElement
    expect(within(home).getByText('December 2034')).toBeInTheDocument()
    expect(within(home).getByText('At risk')).toBeInTheDocument() // status is a word, not only a colour
    expect(within(home).getByText('Achievable')).toBeInTheDocument()
    expect(within(home).getByText('Emergency fund: At risk'.replace('Emergency fund: At risk', 'Emergency fund: Achievable to At risk'))).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'Emergency fund' }).closest('li') as HTMLElement).getByText('A three-year delay may be impractical')).toBeInTheDocument()
  })

  it('never shows an unknown figure as zero', async () => {
    const unknown = assessment({ target_at_date: null, available_funding: null, funding_gap: null, required_monthly: null, projected_completion: null, status: 'cannot_assess', reasons: ['Not enough is recorded.'] })
    backend({ 'GET /advisor/analyses/latest': () => json(analysis({ goal_date_comparison: [{ ...analysis().goal_date_comparison[1], original: unknown, plus_3_years: unknown }] })) })
    await open()
    await tab('Goal review')
    const card = (await screen.findByRole('heading', { name: 'Home' })).closest('li') as HTMLElement
    expect(within(card).getAllByText('Cannot assess')).toHaveLength(2)
    expect(within(card).queryByText('₹0')).not.toBeInTheDocument()
    expect(within(card).getAllByText('–').length).toBeGreaterThan(4)
  })

  it('shows recommendation cards with their reason, steps, risks and trade-offs', async () => {
    backend()
    await open()
    await tab('Recommendations')
    const card = (await screen.findByRole('heading', { name: 'Spend ₹1,000 a month less on optional items' })).closest('li') as HTMLElement
    expect(within(card).getByText('High priority')).toBeInTheDocument()
    expect(within(card).getByText('Found by the calculation engine')).toBeInTheDocument()
    expect(within(card).getByText('Choose which optional lines to trim.')).toBeInTheDocument()
    expect(within(card).getByText(/hard to keep/)).toBeInTheDocument()
    expect(within(card).getByText(/\+₹12,000/)).toBeInTheDocument()
    expect(within(card).getByText('Nothing gets worse in the calculation.')).toBeInTheDocument()
  })

  it('accepting shows the exact edits and changes nothing until they are confirmed with the token', async () => {
    const token = 't'.repeat(64)
    const { calls } = backend({
      'POST /advisor/recommendations/rec-1/decision': (init) => {
        const body = JSON.parse(String(init?.body))
        if (body.apply_changes) return json({ recommendation_id: 'rec-1', status: 'accepted', proposed_changes: [], confirm_token: null, needs_confirmation: false, applied: true, stale_after: true })
        return json({
          recommendation_id: 'rec-1',
          status: body.status,
          proposed_changes: body.status === 'accepted' ? scenario().proposed_changes : [],
          confirm_token: body.status === 'accepted' ? token : null,
          needs_confirmation: body.status === 'accepted',
          applied: false,
          stale_after: false,
        })
      },
    })
    await open()
    await tab('Recommendations')
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    const confirm = await screen.findByRole('group', { name: 'Confirm these exact edits' })
    expect(within(confirm).getByText('Dining out: monthly from 10000.00 to 9000.00')).toBeInTheDocument()
    const decisions = () => only(calls, 'POST', '/advisor/recommendations/rec-1/decision')
    expect(decisions()).toHaveLength(1)
    expect(decisions()[0].body).toEqual({ status: 'accepted', apply_changes: false })

    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm and edit my plan' }))
    expect(await screen.findByText(/Your plan was edited/)).toBeInTheDocument()
    expect(decisions()[1].body).toEqual({ status: 'accepted', apply_changes: true, confirm_token: token })
    // the plan on screen is read again, so the rest of the app shows what the server now holds
    await waitFor(() => expect(only(calls, 'GET', '/plans/p1').length).toBeGreaterThan(1))
  })

  it('saving or dismissing never asks to edit anything', async () => {
    const { calls } = backend({
      'POST /advisor/recommendations/rec-1/decision': () => json({ recommendation_id: 'rec-1', status: 'dismissed', proposed_changes: [], confirm_token: null, needs_confirmation: false, applied: false, stale_after: false }),
    })
    await open()
    await tab('Recommendations')
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAttribute('aria-pressed', 'true'))
    expect(only(calls, 'POST', '/advisor/recommendations/rec-1/decision')[0].body).toEqual({ status: 'dismissed', apply_changes: false })
  })

  it('an out-of-date analysis says so, blocks decisions and offers a re-run', async () => {
    const { calls } = backend({
      'GET /advisor/analyses/latest': () => json(analysis({ stale: true, stale_reason: 'Your records changed.' })),
      'POST /advisor/analyze': () => json(analysis()),
    })
    await open()
    expect(await screen.findByText(/This analysis is out of date/)).toBeInTheDocument()
    await tab('Recommendations')
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByText('Run the analysis again before deciding.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Run it again' })[0])
    await waitFor(() => expect(only(calls, 'POST', '/advisor/analyze')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/This analysis is out of date/)).not.toBeInTheDocument())
  })

  it('compares the baseline with each path and says plainly when a path was rejected', async () => {
    backend()
    await open()
    await tab('Compare paths')
    const table = await screen.findByRole('table', { name: 'Compare paths' })
    expect(within(table).getByText('Baseline (no change)')).toBeInTheDocument()
    expect(within(table).getByText('Spend ₹1,000 a month less on optional items')).toBeInTheDocument()
    expect(within(table).getByText('No: rejected')).toBeInTheDocument()
    expect(within(table).getAllByText('₹4,88,000').length).toBeGreaterThan(0)
    expect(screen.getByText(/It would take your cash below zero/)).toBeInTheDocument()
  })

  it('runs a scenario of the person’s own and adds it to the comparison', async () => {
    const { calls } = backend({ 'POST /advisor/scenarios': () => json(scenario({ id: 's3', title: 'Spend ₹500 a month less on optional items' })) })
    await open()
    await tab('Compare paths')
    fireEvent.change(await screen.findByLabelText('Percent of optional spending'), { target: { value: '7.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run this scenario' }))
    expect(await screen.findByText('Spend ₹500 a month less on optional items', { selector: 'th' })).toBeInTheDocument()
    expect(only(calls, 'POST', '/advisor/scenarios')[0].body).toEqual({ analysis_id: 'a1', change: { tool: 'simulate_expense_change', percent: '7.5' } })
  })

  it('refuses an invalid scenario before asking the server', async () => {
    const { calls } = backend()
    await open()
    await tab('Compare paths')
    fireEvent.change(await screen.findByLabelText('Percent of optional spending'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run this scenario' }))
    expect(await screen.findByText(/Check the values/)).toBeInTheDocument()
    expect(only(calls, 'POST', '/advisor/scenarios')).toHaveLength(0)
  })

  it('answers the two canonical follow-up questions through the server', async () => {
    const { calls } = backend({
      'POST /advisor/chat': () => json({ answer: 'Spend ₹1,000 a month less on optional items. Goals achievable: 1 of 2 today, 1 of 2 on this path.', scenario_ids: ['s1'], scenarios: [scenario()], ai_used: false, notice: 'x' }),
    })
    await open()
    await tab('Ask a question')
    fireEvent.click(await screen.findByRole('button', { name: 'What if I reduce discretionary spending by 5%?' }))
    expect(await screen.findByText(/Goals achievable: 1 of 2 today/)).toBeInTheDocument()
    expect(screen.getByText('Calculated by the engine')).toBeInTheDocument()
    expect(only(calls, 'POST', '/advisor/chat')[0].body).toEqual({ analysis_id: 'a1', message: 'What if I reduce discretionary spending by 5%?', language: 'en' })
  })

  it('says what AI did or did not do, and lists anything the checks removed', async () => {
    backend({
      'GET /advisor/analyses/latest': () =>
        json(analysis({ ai_status: 'invalid_output', ai_message: 'The AI answer had no usable recommendation after checking.', validation_notes: [{ code: 'invented_scenario', message: "'Ghost' pointed at a calculation that was never run and was removed." }] })),
    })
    await open()
    expect(await screen.findByText(/failed the checks/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Removed by the checks'))
    expect(screen.getByText(/never run and was removed/)).toBeInTheDocument()
  })

  it('shows a failure to analyse, and no invented result', async () => {
    backend({
      'GET /advisor/analyses/latest': () => json({ error: { code: 'not_found', message: 'x' } }, 404),
      'POST /advisor/analyze': () => json({ error: { code: 'no_goals', message: 'Add at least one goal.' } }, 422),
    })
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Analyse my finances' }))
    expect(await screen.findByText(/could not be completed/)).toBeInTheDocument()
    expect(screen.queryByText(/goals are achievable/)).not.toBeInTheDocument()
  })

  it('offers to try again when the latest analysis cannot be loaded', async () => {
    let fail = true
    backend({ 'GET /advisor/analyses/latest': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : json(analysis())) })
    await open()
    expect(await screen.findByText('The advisor could not be reached. Try again.')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('1 of 2 goals are achievable by their saved dates on your current plan.')).toBeInTheDocument()
  })

  it('sends the chosen language and the no-AI choice', async () => {
    const { calls } = backend({ 'POST /advisor/analyze': () => json(analysis()) })
    await open()
    fireEvent.click(screen.getByLabelText('Use AI to propose paths and word the result'))
    fireEvent.click(screen.getByRole('button', { name: 'Run the analysis again' }))
    await waitFor(() => expect(only(calls, 'POST', '/advisor/analyze')).toHaveLength(1))
    expect(only(calls, 'POST', '/advisor/analyze')[0].body).toMatchObject({ plan_id: 'p1', use_ai: false })
  })
})
