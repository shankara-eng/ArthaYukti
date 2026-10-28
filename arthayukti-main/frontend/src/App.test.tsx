import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import household from '../../contracts/samples/household.json'
import App from './App'
import { openExample } from './test/openExample'

function outcome(id: string, target: string, date: string) {
  return {
    goal_id: id,
    label: id,
    status: 'on_track',
    target_date: date,
    target_amount_today: target,
    inflated_target_at_deadline: target,
    balance_at_deadline: target,
    shortfall_at_deadline_nominal: '0.00',
    shortfall_at_deadline_today: '0.00',
    required_monthly_level_standalone: '40000.00',
    projected_completion: '2029-11',
    delay_months: 0,
    average_monthly_contribution: '40000.00',
    total_contributed: '0.00',
    total_withdrawn: '0.00',
    crowded_out_by: [],
  }
}

const projection = {
  as_of: '2027-01',
  horizon_months: 12,
  summary: {
    goals_total: 2,
    on_track: 2,
    delayed: 0,
    not_achievable: 0,
    plan_feasible: true,
    uncovered_deficit_months: [],
    overcommitment_ratio: '0.8280',
    total_shortfall_today: '0.00',
  },
  goals: [
    outcome('home', '2400000.00', '2030-12'),
    outcome('education', '1800000.00', '2032-12'),
  ],
  monthly: [
    {
      month: '2027-01',
      income: '190000.00',
      expenses: '99000.00',
      commitments: '0.00',
      one_offs: '0.00',
      surplus: '91000.00',
      free_cash: '0.00',
      uncovered_deficit: '0.00',
      goals: [
        { goal_id: 'home', contribution: '55651.00', withdrawal: '0.00', growth: '0.00', balance: '0.00', required: '0.00', inflated_target: '0.00', realised: false },
        { goal_id: 'education', contribution: '20833.00', withdrawal: '0.00', growth: '0.00', balance: '0.00', required: '0.00', inflated_target: '0.00', realised: false },
      ],
    },
  ],
  warnings: [],
}

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function serve() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/samples/household')) return reply(household)
      if (url.endsWith('/projections')) return reply(projection)
      if (url.endsWith('/fixes')) {
        return reply({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null })
      }
      return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('opens with no household and starts from the person’s own empty numbers', async () => {
    const fetchMock = serve()
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: 'Every goal. One smarter plan.' }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/Arjun/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Start with my numbers/ }))
    expect(await screen.findByRole('heading', { name: 'What comes in each month?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly income')).toHaveValue('₹0')
    expect(screen.getByText('Not saved • this visit only')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for a goal before working anything out, then adds one', async () => {
    const fetchMock = serve()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Start with my numbers/ }))
    window.location.hash = '/plan'
    expect(await screen.findByRole('heading', { name: 'Add a goal first.' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Add a goal/ }))
    await screen.findByRole('heading', { name: 'Which dreams come first?' })
    fireEvent.click(screen.getByRole('button', { name: /Add this goal/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter how much money this goal needs.')

    fireEvent.change(screen.getByLabelText(/Money needed, in today’s rupees/), { target: { value: '₹2,00,000' } })
    fireEvent.click(screen.getByRole('button', { name: /Add this goal/ }))
    expect(await screen.findByRole('button', { name: /^Remove Emergency money/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Remove Emergency money/ }))
    expect(screen.getByText('No goals yet. Add the first one below.')).toBeInTheDocument()
  })

  it('shows no verdict for an own-plan expense until an amount is typed', async () => {
    serve()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Start with my numbers/ }))
    window.location.hash = '/dreams'
    await screen.findByRole('heading', { name: 'Which dreams come first?' })
    fireEvent.change(screen.getByLabelText(/Money needed, in today’s rupees/), { target: { value: '₹2,00,000' } })
    fireEvent.click(screen.getByRole('button', { name: /Add this goal/ }))
    await screen.findByRole('button', { name: /^Remove Emergency money/ })

    window.location.hash = '/what-if'
    fireEvent.click(await screen.findByRole('button', { name: 'Sudden big expense' }))
    expect(await screen.findByLabelText('How much is the expense?')).toBeInTheDocument()
    expect(screen.queryByText('Still on time.')).toBeNull()

    // Zero, negative and empty amounts never apply an expense or show a reassuring status.
    const field = screen.getByLabelText('How much is the expense?')
    for (const typed of ['0', '-5000', '']) {
      fireEvent.change(field, { target: { value: typed } })
      expect(screen.queryByText('Still on time.')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
    }

    // Other screens must not call the plan "Sudden big expense" while none is applied.
    window.location.hash = '/fixes'
    await screen.findByRole('heading', { level: 1 })
    expect(document.body).not.toHaveTextContent(/Sudden big expense/)
  })

  it('hides earlier results and shows an error when a recalculation fails', async () => {
    const fetchMock = serve()
    await openExample('plan')
    expect(await screen.findByText('You’re on time.')).toBeInTheDocument()

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/projections')) {
        return new Response(JSON.stringify({ error: { code: 'boom', message: 'boom' } }), { status: 500 })
      }
      return new Response('{}', { status: 404 })
    })
    window.location.hash = '/money-in'
    fireEvent.change(await screen.findByLabelText('Arjun’s income'), { target: { value: '₹1,30,000' } })
    window.location.hash = '/plan'
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the calculator')
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(screen.queryByText('You’re on time.')).toBeNull()
  })

  it('does not show the example’s results against a plan started afterwards', async () => {
    const fetchMock = serve()
    await openExample('plan')
    expect(await screen.findByText('You’re on time.')).toBeInTheDocument()

    window.location.hash = '/'
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    fireEvent.click(await screen.findByRole('button', { name: /Start with my numbers/ }))

    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    window.location.hash = '/dreams'
    fireEvent.change(await screen.findByLabelText(/Money needed, in today’s rupees/), { target: { value: '₹2,00,000' } })
    fireEvent.click(screen.getByRole('button', { name: /Add this goal/ }))
    await screen.findByRole('button', { name: /^Remove Emergency money/ })
    window.location.hash = '/plan'

    expect(await screen.findByRole('status')).toHaveTextContent('Working it out')
    expect(screen.queryByText('You’re on time.')).toBeNull()
  })

  it('keeps the example household separate and labelled', async () => {
    serve()
    await openExample('money-in')
    await waitFor(() => expect(screen.getByText('Example household')).toBeInTheDocument())
    expect(screen.queryByText('Not saved • this visit only')).toBeNull()
  })

  it('adds up the household income as amounts change', async () => {
    serve()
    await openExample('money-in')
    const arjun = await screen.findByLabelText('Arjun’s income')
    fireEvent.change(arjun, { target: { value: '₹1,30,000' } })
    expect(screen.getByText('₹2,00,000')).toBeInTheDocument()
  })

  it('switches to Hindi and remembers the choice', async () => {
    serve()
    render(<App />)
    await screen.findByRole('heading', { name: 'Every goal. One smarter plan.' })
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }))
    expect(await screen.findByRole('heading', { name: 'हर लक्ष्य। एक समझदार योजना।' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('hi')
    expect(window.localStorage.getItem('arthayukti.language')).toBe('hi')
  })

  it('shows what the engine says on the plan screen', async () => {
    serve()
    await openExample('plan')
    expect(await screen.findByText('You’re on time.')).toBeInTheDocument()
    expect(await screen.findAllByRole('img', { name: /On time/ })).toHaveLength(2)
    expect(screen.getByText('₹91,000')).toBeInTheDocument()
  })

  it('says so when the example cannot be loaded, without showing made-up numbers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /example household/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the example')
    expect(window.location.hash).not.toBe('#/plan')
  })
})
