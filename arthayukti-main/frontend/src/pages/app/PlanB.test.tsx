import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

// A small plan: one essential, one flexible expense, one goal.
const PLAN = {
  ...family.plan,
  income_streams: [{ id: 's1', label: 'Salary', monthly_net: '100000.00', frequency: 'monthly' }],
  expenses: [
    { id: 'e1', label: 'Living essentials', monthly: '30000.00', essential: true },
    { id: 'e2', label: 'Flexible spending', monthly: '10000.00', essential: false },
  ],
  commitments: [],
  goals: [{ ...family.plan.goals[0], label: 'Home', current_savings: '0.00' }],
  unassigned_savings: '300000.00',
}

const month = (m: string, liquid: string, met = true) => ({
  month: m, income: '60000.00', mandatory_outflow: '30000.00', flexible_outflow: '5000.00', goal_transfers: '0.00',
  cash_change: '-20000.00', liquid_end: liquid, mandatory_shortfall: '0.00', floor_met: met, net_worth_change: '25000.00', items: [],
})
const evaluation = (extra = {}) => ({
  feasible: true, months: [month('2026-11', '280000.00')], violations: [], first_violation_month: null,
  minimum_liquid: '180000.00', final_liquid: '180000.00', balances_end: {}, protected_balances_withdrawn: '0.00',
  income_end_unknown: false, assumptions: ['No borrowing is modelled.'], restorations: [], review: null, ...extra,
})

function searchResult(body: { input: { items: { id: string; label: string }[] } }, status = 'found') {
  const flex = body.input.items.find((i) => i.label === 'Flexible spending')!
  const adjustment = { item_id: flex.id, action: 'reduce_to', from_month: '2026-11', to_month: '2027-04', monthly: '5000.00' }
  const metrics = {
    minimum_liquid: '180000.00', final_liquid: '180000.00', floor_headroom: '0.00', flexible_reduction_total: '30000.00',
    goal_contributions_deferred: '0.00', goal_contributions_made: '0.00', paused_months: 0, reduced_months: 6,
    balances_end: {}, restoration_complete_month: null, goal_delay: 'Not calculated: see the rupees deferred.',
  }
  return {
    search: { status, complete: status !== 'incomplete', space_size: 6, evaluated: 6, duplicates_skipped: 0, errors: 0, feasible_found: status === 'found' ? 1 : 0, best_not_proven: false, rejected_by_kind: {}, ignored_permissions: [], notes: [] },
    options: status === 'found' ? [{ id: 'plan-1', label: 'Smallest total sacrifice', rank: 1, adjustments: [{ adjustment, text: 'Reduce Flexible spending from Rs 10,000.00 to Rs 5,000.00 a month from 2026-11 to 2027-04 (6 months)' }], metrics, evaluation: evaluation(), why_it_works: ['Liquid cash never falls below Rs 180,000.00.'], what_you_give_up: ['Flexible spending not spent: Rs 30,000.00 in total.'], key_assumptions: ['No borrowing is modelled.'], what_would_break_it: ['A longer reduction would break this plan.'] }] : [],
    ranking_policy: 'Plans are ordered by the total rupees they ask you to give up.',
    trade_off_note: null, rejected: [], infeasibility: null, frontier_size: 1,
  }
}

const AGREEMENT = {
  id: 'ag1', name: 'Job gap', version: 1, created_at: '2027-01-01T00:00:00+00:00', updated_at: '2027-01-01T00:00:00+00:00',
  draft: { input: { start_month: '2026-11', months: 12, liquid_cash: '300000.00', reserve_floor: '180000.00', income: [], items: [], protected_balances: [], permissions: [], adjustments: [], restorations: [], review_month: null }, selected_label: 'Smallest total sacrifice', rationale: '', disruption_note: '', fallback_note: '', source_plan_id: null, source_plan_name: null },
  evaluation: evaluation(), changes_from_previous: [], versions: [{ version: 1, created_at: '2027-01-01T00:00:00+00:00', change_note: 'First version.', selected_label: null }],
  limitations: ['This agreement records a plan you chose. It is not a guarantee.'],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/plan-b'
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
    'GET /plans/p1': () => json({ id: 'p1', plan: PLAN, created_at: 'x', updated_at: 'y' }),
    'GET /insurance/reminders': () => json([]),
    'POST /projections': () => json(projection),
    'POST /fixes': () => json({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null }),
    'GET /recovery/agreements': () => json([]),
    ...extra,
  })

/** Walk the form: step 1 to step 4, with a goal contribution that may pause and flexible spending that may reduce. */
async function fillAndOpenSearch() {
  await screen.findByText('Protect what matters. Change what is flexible. Know when to restart.')
  fireEvent.click(screen.getByRole('button', { name: 'Next' })) // step 1 -> 2
  fireEvent.change(await screen.findByLabelText('Keep cash at or above (₹)'), { target: { value: '180000' } })
  fireEvent.change(screen.getByLabelText('Monthly take-home income during the change (₹)'), { target: { value: '60000' } })
  fireEvent.change(screen.getByLabelText('Monthly take-home income afterwards (₹)'), { target: { value: '100000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' })) // 2 -> 3
  await screen.findByText('What must stay the same?')
  // The goal row is the last item. Give it an amount and let it change.
  const amounts = screen.getAllByLabelText('Each month (₹)')
  fireEvent.change(amounts[amounts.length - 1], { target: { value: '10000' } })
  fireEvent.click(screen.getByLabelText('Keep this contribution going no matter what'))
  fireEvent.click(screen.getByRole('button', { name: 'Next' })) // 3 -> 4
  await screen.findByText('What may change?')
  const reduce = screen.getAllByLabelText('May reduce')
  fireEvent.click(reduce[0])
  fireEvent.change(await screen.findByLabelText('but not below (₹ a month)'), { target: { value: '5000' } })
  fireEvent.click(screen.getAllByLabelText('May pause')[1])
}

describe('Plan B', () => {
  it('is reachable from the Rescue page and says it is a separate workflow', async () => {
    window.location.hash = '/rescue'
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Plan B' }))
    expect(await screen.findByText('Protect what matters. Change what is flexible. Know when to restart.')).toBeInTheDocument()
  })

  it('is featured on the Financial goals page with its own button', async () => {
    window.location.hash = '/goals'
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Plan B' }))
    expect(await screen.findByText('Protect what matters. Change what is flexible. Know when to restart.')).toBeInTheDocument()
  })

  it('stops a step that has a problem and names the field', async () => {
    backend()
    render(<App />)
    await screen.findByText('Protect what matters. Change what is flexible. Know when to restart.')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect((await screen.findAllByText('Enter a rupee amount (whole rupees).')).length).toBeGreaterThan(0)
    expect(screen.queryByText('What must stay the same?')).toBeNull()
  })

  it('sends the situation to the service and shows the plans it returns, never computing them itself', async () => {
    const { calls } = backend({ 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))) })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    expect(await screen.findByText('1 plan meets every rule you set.')).toBeInTheDocument()
    const sent = calls.find((c) => c.path === '/recovery/search')?.body as { input: { items: { label: string; kind: string; protected: boolean }[]; permissions: { action: string }[]; liquid_cash: string; reserve_floor: string; adjustments: unknown[] }; adjust_months: number }
    expect(sent.input.liquid_cash).toBe('300000.00')
    expect(sent.input.reserve_floor).toBe('180000.00')
    expect(sent.input.adjustments).toEqual([])
    expect(sent.input.permissions.map((p) => p.action).sort()).toEqual(['pause', 'reduce_to'])
    expect(sent.input.items.find((i) => i.kind === 'goal_contribution')?.protected).toBe(false)
    expect(sent.adjust_months).toBe(6)
    expect(await screen.findByRole('heading', { name: '1. Smallest total sacrifice' })).toBeInTheDocument()
    expect(screen.getAllByText('Reduce Flexible spending from Rs 10,000.00 to Rs 5,000.00 a month from 2026-11 to 2027-04 (6 months)').length).toBeGreaterThan(0)
    expect(screen.getByText('Not calculated: see the rupees deferred.')).toBeInTheDocument()
  })

  it('lets the person refuse a sacrifice and searches again without that item', async () => {
    let searches = 0
    const { calls } = backend({
      'POST /recovery/search': (init) => {
        searches += 1
        return json(searchResult(JSON.parse(String(init?.body)), searches === 1 ? 'found' : 'infeasible'))
      },
    })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    fireEvent.click(await screen.findByRole('button', { name: "I can't change Flexible spending" }))
    await waitFor(() => expect(searches).toBe(2))
    const second = calls.filter((c) => c.path === '/recovery/search')[1].body as { excluded_item_ids: string[]; input: { items: { id: string; label: string }[] } }
    const flexId = second.input.items.find((i) => i.label === 'Flexible spending')!.id
    expect(second.excluded_item_ids).toEqual([flexId])
    expect(await screen.findByText('No plan works with the changes you allow. Every combination was checked.')).toBeInTheDocument()
  })

  it('says a search that was cut short is not a proof that nothing works', async () => {
    backend({ 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)), 'incomplete')) })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    expect(await screen.findByText(/cut short by its limit and found no plan/)).toBeInTheDocument()
    expect(screen.queryByText(/Every combination was checked/)).toBeNull()
  })

  it('saves the chosen plan and confirms only after the service has saved it', async () => {
    let saved: { name: string; draft: { input: { adjustments: { item_id: string }[] }; selected_label: string }; client_token: string } | null = null
    backend({
      'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))),
      'POST /recovery/agreements': (init) => {
        saved = JSON.parse(String(init?.body))
        return json(AGREEMENT, 201)
      },
      'GET /recovery/agreements/ag1': () => json(AGREEMENT),
    })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    expect(screen.queryByRole('button', { name: 'Save agreement' })).toBeNull() // nothing to save before a plan is chosen
    fireEvent.click(await screen.findByRole('button', { name: 'Choose this plan' }))
    fireEvent.change(screen.getByLabelText('Agreement name'), { target: { value: 'Job gap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.name).toBe('Job gap')
    expect(saved!.draft.selected_label).toBe('Smallest total sacrifice')
    expect(saved!.draft.input.adjustments).toHaveLength(1)
    expect(saved!.client_token.length).toBeGreaterThanOrEqual(8)
    expect(await screen.findByRole('heading', { name: 'Job gap' })).toBeInTheDocument()
    expect(screen.getByText('This agreement records a plan you chose. It is not a guarantee.')).toBeInTheDocument()
  })

  it('shows the problem and no success message when the save is refused', async () => {
    backend({
      'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))),
      'POST /recovery/agreements': () => json({ error: { code: 'name_taken', message: 'x' } }, 409),
    })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose this plan' }))
    fireEvent.change(screen.getByLabelText('Agreement name'), { target: { value: 'Job gap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(await screen.findByText('You already have an agreement with that name.')).toBeInTheDocument()
    expect(screen.queryByText(/Saved\. This is a record/)).toBeNull()
  })

  it('marks results stale when the inputs change, and blocks choosing or saving until the search is run again', async () => {
    backend({ 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))) })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    const choose = await screen.findByRole('button', { name: 'Choose this plan' })
    expect(choose).not.toBeDisabled()
    // Change an input after the search: the old results no longer match the form.
    fireEvent.change(screen.getByLabelText('Review month'), { target: { value: '2027-06' } })
    expect(await screen.findByText(/You changed your inputs after this search/, { selector: 'p[role="alert"]' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose this plan' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save agreement' })).toBeNull()
    expect(screen.queryByLabelText('Agreement name')).toBeNull()
  })

  it('reports a search failure instead of an empty result', async () => {
    backend({ 'POST /recovery/search': () => json({ error: { code: 'search_failed', message: 'x' } }, 422) })
    render(<App />)
    await fillAndOpenSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
    expect((await screen.findAllByRole('alert')).some((a) => /could not be done/.test(a.textContent ?? ''))).toBe(true)
    expect(screen.queryByText('Your options')).toBeNull()
  })

  it('lists saved agreements and opens one with its recomputed figures', async () => {
    backend({
      'GET /recovery/agreements': () => json([{ id: 'ag1', name: 'Job gap', version: 2, updated_at: 'x', feasible: true, review_month: '2027-05' }]),
      'GET /recovery/agreements/ag1': () => json({ ...AGREEMENT, version: 2 }),
    })
    render(<App />)
    expect(await screen.findByText('Job gap')).toBeInTheDocument()
    expect(screen.getByText(/Version 2 · Fits your rules · Review 2027-05/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { name: 'Job gap' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review against today' })).toBeInTheDocument()
  })

  it('tells the person when their edit is based on an old version', async () => {
    backend({
      'GET /recovery/agreements': () => json([{ id: 'ag1', name: 'Job gap', version: 1, updated_at: 'x', feasible: true, review_month: null }]),
      'GET /recovery/agreements/ag1': () => json(AGREEMENT),
      'PUT /recovery/agreements/ag1': () => json({ error: { code: 'version_conflict', message: 'x' } }, 409),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new version' }))
    expect(await screen.findByText('This agreement changed elsewhere. Reload it, then try again.')).toBeInTheDocument()
  })

  it('recalculates an edited agreement without crashing the page', async () => {
    // Regression: the edit panel used to update state while rendering the recalculated figures ("Too many re-renders").
    backend({
      'GET /recovery/agreements': () => json([{ id: 'ag1', name: 'Job gap', version: 1, updated_at: 'x', feasible: true, review_month: null }]),
      'GET /recovery/agreements/ag1': () => json(AGREEMENT),
      'POST /recovery/evaluate': () => json(evaluation()),
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    fireEvent.change(await screen.findByLabelText('Keep cash at or above (₹)'), { target: { value: '170000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recalculate' })).not.toBeDisabled())
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save as new version' })).toBeInTheDocument()
  })

  describe('AI help', () => {
    const DRAFT = {
      disruption: 'income_reduction', start_month: '2026-11', duration_months: 6, income_before: '100000.00', income_during: '60000.00',
      new_monthly_cost: null, cash_available: null, cannot_change: ['loan EMI'], clarifications: ['What is the new monthly cost?'],
      notice: 'Suggested by AI from your words. Check every value before you use it; nothing has been calculated yet.', generated: true,
    }
    const on = { 'GET /ai/status': () => json({ available: true }) }

    it('says AI help is off and offers no dead control when the server has no key', async () => {
      backend({ 'GET /ai/status': () => json({ available: false }) })
      render(<App />)
      expect(await screen.findByText('AI help is not set up on this server. You can still fill in the form yourself.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Read my description' })).toBeNull()
    })

    it('treats an unreachable status check as off rather than showing broken controls', async () => {
      backend({})
      render(<App />)
      expect(await screen.findByText('AI help is not set up on this server. You can still fill in the form yourself.')).toBeInTheDocument()
    })

    it('reads a description into the form, shows what it filled and what is still missing, and keeps the person in charge', async () => {
      const { calls } = backend({ ...on, 'POST /ai/situation-draft': () => json(DRAFT) })
      render(<App />)
      const box = await screen.findByLabelText('What happened?')
      expect(screen.getByRole('button', { name: 'Read my description' })).toBeDisabled()
      fireEvent.change(box, { target: { value: 'My income falls to 60k for six months from next month. I cannot pause my loan EMI.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Read my description' }))
      expect(await screen.findByText(/Suggested by AI from your words/)).toBeInTheDocument()
      expect(screen.getByText('What is the new monthly cost?')).toBeInTheDocument()
      expect(screen.getByText('loan EMI')).toBeInTheDocument()
      const sent = calls.find((c) => c.path === '/ai/situation-draft')?.body as { text: string; current_month: string }
      expect(sent.text).toContain('loan EMI')
      expect(sent.current_month).toMatch(/^\d{4}-\d{2}$/)
      // The values landed in the editable form; nothing was searched or calculated.
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(await screen.findByLabelText('Monthly take-home income before (₹)')).toHaveValue('100000')
      expect(screen.getByLabelText('Monthly take-home income during the change (₹)')).toHaveValue('60000')
      expect(calls.some((c) => c.path === '/recovery/search')).toBe(false)
    })

    it('shows a clear message when the AI service is busy and leaves the form untouched', async () => {
      backend({ ...on, 'POST /ai/situation-draft': () => json({ error: { code: 'ai_rate_limited', message: 'busy' } }, 429) })
      render(<App />)
      fireEvent.change(await screen.findByLabelText('What happened?'), { target: { value: 'My income fell.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Read my description' }))
      expect(await screen.findByText('AI help is busy. Try again in a minute.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Read my description' })).not.toBeDisabled()
    })

    it('explains a plan in words, labelled as generated, from the plan the server evaluates', async () => {
      const explanation = { summary: 'Your cash ends at 180000.00.', kept_as_is: ['Loan EMI is paid as usual.'], changed: ['Flexible spending is reduced.'], returns_to_plan: 'Nothing comes back by itself.', caution: 'This covers your own numbers only.', notice: 'Written by AI from the figures above. The figures are calculated by ArthaYukti; this wording is not a calculation and is not advice.', generated: true }
      const { calls } = backend({ ...on, 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))), 'POST /ai/explain-recovery': () => json(explanation) })
      render(<App />)
      await fillAndOpenSearch()
      fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Explain this plan in words' }))
      expect(await screen.findByText('Your cash ends at 180000.00.')).toBeInTheDocument()
      expect(screen.getByText(/this wording is not a calculation/)).toBeInTheDocument()
      const sent = calls.find((c) => c.path === '/ai/explain-recovery')?.body as { language: string; input: { adjustments: { item_id: string }[] } }
      expect(sent.language).toBe('en')
      expect(sent.input.adjustments.length).toBeGreaterThan(0)
    })

    it('shows no explanation and keeps the calculated figures when the wording is refused', async () => {
      backend({ ...on, 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))), 'POST /ai/explain-recovery': () => json({ error: { code: 'ai_unverified', message: 'x' } }, 502) })
      render(<App />)
      await fillAndOpenSearch()
      fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Explain this plan in words' }))
      expect(await screen.findByText(/used a figure that was not calculated/)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '1. Smallest total sacrifice' })).toBeInTheDocument()
    })

    it('offers no explain button when AI help is off', async () => {
      backend({ 'GET /ai/status': () => json({ available: false }), 'POST /recovery/search': (init) => json(searchResult(JSON.parse(String(init?.body)))) })
      render(<App />)
      await fillAndOpenSearch()
      fireEvent.click(screen.getByRole('button', { name: 'Find recovery options' }))
      await screen.findByRole('heading', { name: '1. Smallest total sacrifice' })
      expect(screen.queryByRole('button', { name: 'Explain this plan in words' })).toBeNull()
    })
  })
})
