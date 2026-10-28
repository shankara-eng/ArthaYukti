import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import stretched from '../../../contracts/samples/family_stretched.json'
import { openExample } from '../test/openExample'
import fixture from '../test/tradeoffs.fixture.json'

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function serve(tradeoffs: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/samples/household')) return reply(stretched)
    if (url.endsWith('/tradeoffs')) return tradeoffs()
    if (url.endsWith('/fixes')) {
      return reply({ needs_fix: false, options: [], recommended_option_id: null, no_single_fix_reason: null })
    }
    return reply({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastPriorities(fetchMock: ReturnType<typeof serve>, path: string) {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path))
  const init = calls.at(-1)?.[1]
  expect(init).toBeDefined()
  const body = JSON.parse(String(init?.body))
  return Object.fromEntries(
    body.plan.goals.map((goal: { id: string; priority: number }) => [goal.id, goal.priority]),
  )
}

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Goal collision lab', () => {
  it('opens on a goal that waits today and shows what changes for every goal', async () => {
    serve(() => reply(fixture))
    await openExample('tradeoffs')
    const home = await screen.findByRole('radio', { name: /Home/ })
    expect(screen.getByRole('heading', { name: /Which one gets protected first/ })).toBeInTheDocument()
    expect(home).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio')).toHaveLength(3)

    expect(screen.getAllByText(/Now: On time/).length).toBe(2)
    expect(screen.getByText(/If first: 29 months late/)).toBeInTheDocument()
    expect(screen.getAllByText(/Newly late/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Putting Home first: Home comes on time\./)).toBeInTheDocument()
    expect(screen.getByText(/Sample household • illustrative/)).toBeInTheDocument()
  })

  it('updates the comparison when another goal is chosen and resets it', async () => {
    serve(() => reply(fixture))
    await openExample('tradeoffs')
    await screen.findByRole('radio', { name: /Home/ })

    fireEvent.click(screen.getByRole('radio', { name: /Children’s education/ }))
    expect(screen.getByRole('radio', { name: /Children’s education/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Putting Children’s education first: No goal changes\./)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset comparison' }))
    expect(screen.getByText('Choose a goal to see what changes.')).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('does not change the plan until the order is confirmed, and can undo it', async () => {
    const fetchMock = serve(() => reply(fixture))
    await openExample('tradeoffs')
    await screen.findByRole('radio', { name: /Home/ })

    fireEvent.click(screen.getByRole('button', { name: 'Use this order' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Change your priorities to Home')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(window.location.hash).toBe('#/tradeoffs')
    expect(lastPriorities(fetchMock, '/tradeoffs')).toEqual({ emergency: 1, education: 2, home: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Use this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use this order' }))
    expect(window.location.hash).toBe('#/plan')
    await waitFor(() => expect(lastPriorities(fetchMock, '/projections')).toEqual({ home: 1, emergency: 2, education: 3 }))

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lastPriorities(fetchMock, '/projections')).toEqual({ emergency: 1, education: 2, home: 3 }))
  })

  it('says the calculator is not ready when the endpoint is not built yet', async () => {
    serve(() => reply({ error: { code: 'not_implemented', message: 'not available yet' } }, 501))
    await openExample('tradeoffs')
    expect(await screen.findByRole('alert')).toHaveTextContent('not available yet')
  })

  it('shows an error with a retry when the service cannot be reached', async () => {
    serve(() => reply({ error: { code: 'boom', message: 'boom' } }, 500))
    await openExample('tradeoffs')
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the calculator')
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('reads in Hindi, including the household name', async () => {
    serve(() => reply(fixture))
    await openExample('tradeoffs')
    await screen.findByRole('radio', { name: /Home/ })
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }))
    expect(await screen.findByRole('heading', { name: /पहले किसे बचाएँ/ })).toBeInTheDocument()
    expect(screen.getAllByText('रवि और सुनीता').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: /घर/ })).toBeInTheDocument()
  })
})
