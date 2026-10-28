import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client'
import App from '../../App'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

const PROFILE = { id: 'u1', email: 'asha@example.test', full_name: 'Asha', is_active: true, created_at: '2027-01-01T00:00:00' }
const summary = { goals_total: 1, on_track: 1, delayed: 0, not_achievable: 0, plan_feasible: true, uncovered_deficit_months: [], overcommitment_ratio: '0.5000', total_shortfall_today: '0.00' }
const projection = { as_of: '2027-01', horizon_months: 12, summary, goals: [], monthly: [], warnings: [] }

const recent = () => new Date().toISOString()
const old = () => new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()

const position = (extra: Record<string, unknown> = {}) => ({
  id: 'h1',
  ticker: 'RELIANCE.NS',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  company_name: 'Reliance Industries',
  closed: false,
  quantity: '10.000000',
  purchase_date: '2026-01-05',
  purchase_date_entered: true,
  average_cost: '1000.0000',
  invested: '10000.00',
  price: '1200.0000',
  price_status: 'fresh',
  price_fetched_at: recent(),
  price_source: 'Indian-Stock-Market-API (Yahoo Finance)',
  market_value: '12000.00',
  unrealised: '2000.00',
  unrealised_pct: '20.00',
  realised: '0.00',
  dividends: '0.00',
  weight_pct: '100.00',
  editable: true,
  ...extra,
})

const totals = (extra: Record<string, unknown> = {}) => ({
  open_positions: 1,
  priced_positions: 1,
  unpriced_positions: 0,
  invested_priced: '10000.00',
  invested_unpriced: '0.00',
  value: '12000.00',
  unrealised: '2000.00',
  unrealised_pct: '20.00',
  realised: '0.00',
  dividends: '0.00',
  total_profit: '2000.00',
  total_return_pct: '20.00',
  complete: true,
  ...extra,
})

const portfolio = (extra: Record<string, unknown> = {}) => ({
  holdings: [position()],
  totals: totals(),
  excluded: [],
  latest_price_at: recent(),
  refresh: null,
  disclaimer: 'x',
  ...extra,
})

const EMPTY = portfolio({ holdings: [], totals: totals({ open_positions: 0, priced_positions: 0, invested_priced: '0.00', value: '0.00', unrealised: '0.00', unrealised_pct: null, total_profit: '0.00', total_return_pct: null, complete: false }), latest_price_at: null })
const HISTORY = { range: 'all', since: null, snapshots: [], invested_timeline: [{ date: '2026-01-05', invested: '10000.00' }], note: 'n' }

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  window.location.hash = '/equities'
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
    'GET /calculators/scenarios': () => json([]),
    'GET /financials/investments': () => json([]),
    'GET /financials/accounts': () => json([]),
    'GET /portfolio': () => json(portfolio()),
    'GET /portfolio/history': () => json(HISTORY),
    ...extra,
  })

async function openPortfolio() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stock portfolio' }))
  await screen.findByRole('heading', { name: 'Stock portfolio' })
}

/** The holding's card. The company name also appears in the allocation list, so look only in the holdings panel. */
async function findCard(name = 'Reliance Industries') {
  await waitFor(() => expect(document.getElementById('portfolio-holdings')).not.toBeNull())
  const inside = within(document.getElementById('portfolio-holdings') as HTMLElement)
  return (await inside.findByText(name)).closest('li') as HTMLElement
}

const only = (all: { method: string; path: string; body: unknown }[], method: string, path: string) => all.filter((c) => c.method === method && c.path === path)

describe('the portfolio page', () => {
  it('is a tab of Equities and shows the holding, what was invested, the value and the profit', async () => {
    backend()
    await openPortfolio()
    const card = await findCard()
    expect(within(card).getByText('RELIANCE · NSE')).toBeInTheDocument()
    expect(within(card).getByText('₹10,000.00')).toBeInTheDocument() // invested
    expect(within(card).getByText('₹12,000.00')).toBeInTheDocument() // value
    expect(within(card).getByText('₹2,000.00 (+20.00%)')).toBeInTheDocument()
    expect(within(card).getByText('Fresh')).toBeInTheDocument()
    const summaryPanel = document.getElementById('portfolio-summary') as HTMLElement
    expect(within(summaryPanel).getAllByText('₹2,000.00 (+20.00%)')).toHaveLength(2) // unrealised and total return, which are equal here
    expect(screen.getByText(/may be delayed, may be missing outside market hours/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is read from your broker/)).toBeInTheDocument()
  })

  it('shows an empty state with the add form when nothing is held', async () => {
    backend({ 'GET /portfolio': () => json(EMPTY) })
    await openPortfolio()
    expect(await screen.findByText(/No holdings yet/)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Add a holding' })).toBeInTheDocument()
    expect(screen.queryByText('Current value')).not.toBeInTheDocument()
  })

  it('shows a load failure with a way to try again, and no invented figures', async () => {
    let fail = true
    backend({ 'GET /portfolio': () => (fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : json(portfolio())) })
    await openPortfolio()
    expect(await screen.findByText('Your portfolio could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByText('Reliance Industries')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await findCard()).toBeInTheDocument()
  })

  it('never shows a missing price as zero: it is unavailable, not valued, and not counted', async () => {
    const unpriced = portfolio({
      holdings: [position({ price: null, price_status: 'unavailable', price_fetched_at: null, market_value: null, unrealised: null, unrealised_pct: null, weight_pct: null })],
      totals: totals({ priced_positions: 0, unpriced_positions: 1, invested_priced: '0.00', invested_unpriced: '10000.00', value: '0.00', unrealised: '0.00', unrealised_pct: null, total_profit: '0.00', total_return_pct: null, complete: false }),
      latest_price_at: null,
    })
    backend({ 'GET /portfolio': () => json(unpriced), 'POST /portfolio/refresh': () => json({ ...unpriced, refresh: { status: 'failed', requested: 1, updated: 0, error_code: 'unavailable', message: 'x' } }) })
    await openPortfolio()
    const card = await findCard()
    expect(within(card).getByText('Price unavailable')).toBeInTheDocument()
    expect(within(card).getByText(/No price: this holding is not valued and is not counted as zero/)).toBeInTheDocument()
    expect(within(card).queryByText('₹0.00')).not.toBeInTheDocument()
    const summaryPanel = document.getElementById('portfolio-summary') as HTMLElement
    expect(within(summaryPanel).getByText(/cover the 0 of 1 holdings that have a price/)).toBeInTheDocument()
    expect(within(summaryPanel).getByText(/₹10,000.00 is invested in holdings without a price/)).toBeInTheDocument()
  })

  it('marks a price older than a day as stale, with when it was fetched, and says so in the summary', async () => {
    backend({ 'GET /portfolio': () => json(portfolio({ holdings: [position({ price_status: 'stale', price_fetched_at: old() })], latest_price_at: old() })), 'POST /portfolio/refresh': () => json(portfolio({ holdings: [position({ price_status: 'stale', price_fetched_at: old() })], latest_price_at: old(), refresh: { status: 'failed', requested: 1, updated: 0, error_code: 'timeout', message: 'x' } })) })
    await openPortfolio()
    const card = await findCard()
    expect(within(card).getByText('Stale')).toBeInTheDocument()
    expect(within(card).getByText(/Stale: fetched/)).toBeInTheDocument()
    expect(within(card).getByText('₹12,000.00')).toBeInTheDocument() // the last good price is still used
    expect(screen.getByText(/1 price is more than a day old/)).toBeInTheDocument()
  })
})

describe('refreshing prices', () => {
  it('asks for fresh prices once when the page opens with no recent price, and shows the outcome', async () => {
    const stale = portfolio({ latest_price_at: old() })
    const fresh = portfolio({ refresh: { status: 'ok', requested: 1, updated: 1, error_code: null, message: null }, holdings: [position({ price: '1500.0000', market_value: '15000.00', unrealised: '5000.00', unrealised_pct: '50.00' })], totals: totals({ value: '15000.00', unrealised: '5000.00', unrealised_pct: '50.00' }) })
    const { calls } = backend({ 'GET /portfolio': () => json(stale), 'POST /portfolio/refresh': () => json(fresh) })
    await openPortfolio()
    expect(await screen.findByText('Prices updated.')).toBeInTheDocument()
    expect(screen.getAllByText('₹5,000.00 (+50.00%)').length).toBeGreaterThan(0)
    expect(only(calls, 'POST', '/portfolio/refresh')).toHaveLength(1)
  })

  it('does not refresh by itself when the price is recent, but the button does', async () => {
    const { calls } = backend({ 'POST /portfolio/refresh': () => json(portfolio({ refresh: { status: 'ok', requested: 1, updated: 1, error_code: null, message: null } })) })
    await openPortfolio()
    await findCard()
    expect(only(calls, 'POST', '/portfolio/refresh')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
    expect(await screen.findByText('Prices updated.')).toBeInTheDocument()
    expect(only(calls, 'POST', '/portfolio/refresh')).toHaveLength(1)
  })

  it('says why a refresh failed and keeps showing the last prices with their time', async () => {
    const failed = portfolio({ refresh: { status: 'failed', requested: 1, updated: 0, error_code: 'unavailable', message: 'The price service could not be reached.' } })
    backend({ 'POST /portfolio/refresh': () => json(failed) })
    await openPortfolio()
    await findCard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
    expect(await screen.findByText(/Prices could not be updated: the price service could not be reached\. Showing the last prices, fetched/)).toBeInTheDocument()
    expect(screen.getAllByText('₹12,000.00').length).toBeGreaterThan(0) // not zero
  })

  it('says which symbols had no price when only some did', async () => {
    backend({ 'POST /portfolio/refresh': () => json(portfolio({ refresh: { status: 'partial', requested: 2, updated: 1, error_code: 'no_price', message: 'x' } })) })
    await openPortfolio()
    await findCard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
    expect(await screen.findByText(/had no price for some symbols/)).toBeInTheDocument()
  })

  it('shows the button as busy and ignores a second click while fetching', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls } = backend({ 'POST /portfolio/refresh': async () => (await gate, json(portfolio({ refresh: { status: 'ok', requested: 1, updated: 1, error_code: null, message: null } }))) })
    await openPortfolio()
    await findCard()
    const button = screen.getByRole('button', { name: 'Refresh prices' })
    fireEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Fetching prices…' })).toBeDisabled()
    release()
    await screen.findByText('Prices updated.')
    expect(only(calls, 'POST', '/portfolio/refresh')).toHaveLength(1)
  })
})

describe('adding a holding', () => {
  it('searches, picks an exchange and sends only quantity, price paid and date, never a price from the browser', async () => {
    let held = false
    const { calls } = backend({
      'GET /portfolio': () => json(held ? portfolio() : EMPTY),
      'GET /portfolio/search': () => json({ query: 'reliance', results: [{ symbol: 'RELIANCE', company_name: 'Reliance Industries', tickers: [{ exchange: 'NSE', ticker: 'RELIANCE.NS' }, { exchange: 'BSE', ticker: 'RELIANCE.BO' }] }] }),
      'POST /portfolio/holdings': () => {
        held = true
        return json({ id: 'h1', ticker: 'RELIANCE.NS', merged: false, verified: true, message: null }, 201)
      },
    })
    await openPortfolio()
    const form = within(await screen.findByRole('form', { name: 'Add a holding' }))
    fireEvent.change(screen.getByLabelText('Find a stock'), { target: { value: 'reliance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use RELIANCE on NSE' }))
    expect(form.getByLabelText('Symbol')).toHaveValue('RELIANCE')
    fireEvent.change(form.getByLabelText('Number of shares'), { target: { value: '10' } })
    fireEvent.change(form.getByLabelText('Average purchase price per share (₹)'), { target: { value: '1000' } })
    fireEvent.change(form.getByLabelText('Purchase date (optional)'), { target: { value: '2026-01-05' } })
    fireEvent.click(form.getByRole('button', { name: 'Add holding' }))
    expect(await screen.findByText('Added RELIANCE.NS.')).toBeInTheDocument()
    expect(only(calls, 'POST', '/portfolio/holdings')[0].body).toEqual({ symbol: 'RELIANCE', exchange: 'NSE', company_name: 'Reliance Industries', quantity: '10', average_price: '1000', purchase_date: '2026-01-05' })
    expect(await findCard()).toBeInTheDocument() // the list reloaded
    expect(screen.getByText('Added RELIANCE.NS.')).toBeInTheDocument() // and the message survived the page changing from empty to populated
    expect(only(calls, 'GET', '/portfolio/search')).toHaveLength(1)
  })

  it('shows the problems beside the fields and sends nothing when the form is wrong', async () => {
    const { calls } = backend({ 'GET /portfolio': () => json(EMPTY) })
    await openPortfolio()
    const form = within(await screen.findByRole('form', { name: 'Add a holding' }))
    fireEvent.change(form.getByLabelText('Symbol'), { target: { value: 'RELIANCE.NS' } })
    fireEvent.change(form.getByLabelText('Number of shares'), { target: { value: '1.5' } })
    fireEvent.change(form.getByLabelText('Average purchase price per share (₹)'), { target: { value: '0' } })
    fireEvent.change(form.getByLabelText('Purchase date (optional)'), { target: { value: '2999-01-01' } })
    expect(form.queryByText(/Enter the symbol/)).not.toBeInTheDocument() // not shouted before the first try
    fireEvent.click(form.getByRole('button', { name: 'Add holding' }))
    expect(await form.findByText(/Enter the symbol: letters and digits/)).toBeInTheDocument()
    expect(form.getByText('Enter a whole number of shares, 1 or more.')).toBeInTheDocument()
    expect(form.getByText('Enter a price above zero, with up to four decimals.')).toBeInTheDocument()
    expect(form.getByText(/Enter a real date/)).toBeInTheDocument()
    expect(only(calls, 'POST', '/portfolio/holdings')).toHaveLength(0)
  })

  it('keeps what was typed when saving fails, and ignores a second click while saving', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let fail = true
    const { calls } = backend({
      'GET /portfolio': () => json(EMPTY),
      'POST /portfolio/holdings': async () => {
        await gate
        return fail ? json({ error: { code: 'http_error', message: 'x' } }, 500) : json({ id: 'h1', ticker: 'TCS.NS', merged: false, verified: true, message: null }, 201)
      },
    })
    await openPortfolio()
    const form = within(await screen.findByRole('form', { name: 'Add a holding' }))
    fireEvent.change(form.getByLabelText('Symbol'), { target: { value: 'tcs' } })
    fireEvent.change(form.getByLabelText('Number of shares'), { target: { value: '5' } })
    fireEvent.change(form.getByLabelText('Average purchase price per share (₹)'), { target: { value: '3000' } })
    const button = form.getByRole('button', { name: 'Add holding' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await form.findByRole('button', { name: 'Adding…' })).toBeDisabled()
    release()
    expect(await form.findByText('This could not be saved. What you entered is kept: try again.')).toBeInTheDocument()
    expect(form.getByLabelText('Symbol')).toHaveValue('tcs')
    expect(form.getByLabelText('Number of shares')).toHaveValue('5')
    expect(only(calls, 'POST', '/portfolio/holdings')).toHaveLength(1)
    fail = false
  })

  it('says when the symbol could not be checked, and when it was added as another purchase', async () => {
    let merged = false
    backend({
      'GET /portfolio': () => json(EMPTY),
      'POST /portfolio/holdings': () => json({ id: 'h1', ticker: 'TCS.NS', merged, verified: false, message: 'The price service could not be reached, so the symbol was not checked. It was saved.' }, 201),
    })
    await openPortfolio()
    const form = within(await screen.findByRole('form', { name: 'Add a holding' }))
    const fill = () => {
      fireEvent.change(form.getByLabelText('Symbol'), { target: { value: 'TCS' } })
      fireEvent.change(form.getByLabelText('Number of shares'), { target: { value: '5' } })
      fireEvent.change(form.getByLabelText('Average purchase price per share (₹)'), { target: { value: '3000' } })
      fireEvent.click(form.getByRole('button', { name: 'Add holding' }))
    }
    fill()
    expect(await screen.findByText(/Added TCS.NS\. The price service could not be reached, so the symbol was not checked/)).toBeInTheDocument()
    merged = true
    fill()
    expect(await screen.findByText(/Recorded as another purchase of TCS.NS/)).toBeInTheDocument()
  })

  it('reports a failed search as a failure, not as no results', async () => {
    backend({ 'GET /portfolio': () => json(EMPTY), 'GET /portfolio/search': () => json({ error: { code: 'market_unavailable', message: 'x' } }, 502) })
    await openPortfolio()
    await screen.findByRole('form', { name: 'Add a holding' })
    fireEvent.change(screen.getByLabelText('Find a stock'), { target: { value: 'tata' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('The stock search could not be completed.')).toBeInTheDocument()
    expect(screen.queryByText(/No stock found/)).not.toBeInTheDocument()
  })

  it('says so when a search finds nothing', async () => {
    backend({ 'GET /portfolio': () => json(EMPTY), 'GET /portfolio/search': () => json({ query: 'zzzz', results: [] }) })
    await openPortfolio()
    await screen.findByRole('form', { name: 'Add a holding' })
    fireEvent.change(screen.getByLabelText('Find a stock'), { target: { value: 'zzzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/No stock found/)).toBeInTheDocument()
  })
})

describe('editing and removing', () => {
  it('edits a single-purchase holding with a validated form and sends the changes', async () => {
    const { calls } = backend({ 'PUT /portfolio/holdings/h1': () => json({ id: 'h1', ticker: 'RELIANCE.NS', merged: false, verified: true, message: null }) })
    await openPortfolio()
    await findCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit RELIANCE' }))
    const form = within(screen.getByRole('form', { name: 'Edit RELIANCE' }))
    expect(form.getByLabelText('Number of shares (RELIANCE)')).toHaveValue('10')
    expect(form.getByLabelText('Average purchase price per share (₹) (RELIANCE)')).toHaveValue('1000')
    fireEvent.change(form.getByLabelText('Number of shares (RELIANCE)'), { target: { value: '0' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(await form.findByText('Enter a whole number of shares, 1 or more.')).toBeInTheDocument()
    expect(only(calls, 'PUT', '/portfolio/holdings/h1')).toHaveLength(0)
    fireEvent.change(form.getByLabelText('Number of shares (RELIANCE)'), { target: { value: '25' } })
    fireEvent.change(form.getByLabelText('Average purchase price per share (₹) (RELIANCE)'), { target: { value: '950.5' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(only(calls, 'PUT', '/portfolio/holdings/h1')).toHaveLength(1))
    expect(only(calls, 'PUT', '/portfolio/holdings/h1')[0].body).toEqual({ quantity: '25', average_price: '950.5', purchase_date: '2026-01-05' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit RELIANCE' })).not.toBeInTheDocument())
  })

  it('cancels an edit without saving', async () => {
    const { calls } = backend()
    await openPortfolio()
    await findCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit RELIANCE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Edit RELIANCE' })).not.toBeInTheDocument()
    expect(only(calls, 'PUT', '/portfolio/holdings/h1')).toHaveLength(0)
  })

  it('sends a holding with several transactions to the ledger instead of editing it here', async () => {
    backend({ 'GET /portfolio': () => json(portfolio({ holdings: [position({ editable: false })] })) })
    await openPortfolio()
    await findCard()
    expect(screen.queryByRole('button', { name: 'Edit RELIANCE' })).not.toBeInTheDocument()
    expect(screen.getByText(/more than one|several transactions/i)).toBeInTheDocument()
  })

  it('asks before removing, and removes only on yes', async () => {
    const { calls } = backend({ 'DELETE /portfolio/holdings/h1': () => new Response(null, { status: 204 }) })
    await openPortfolio()
    await findCard()
    fireEvent.click(screen.getByRole('button', { name: 'Remove RELIANCE' }))
    expect(screen.getByText('Remove this holding and its transactions?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(only(calls, 'DELETE', '/portfolio/holdings/h1')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove RELIANCE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(only(calls, 'DELETE', '/portfolio/holdings/h1')).toHaveLength(1))
  })
})

describe('closed, excluded and several holdings', () => {
  it('shows a fully sold holding with its realised profit and no unrealised figures', async () => {
    backend({ 'GET /portfolio': () => json(portfolio({ holdings: [position({ closed: true, quantity: '0.000000', average_cost: null, invested: '0.00', price: null, price_status: 'unavailable', market_value: '0.00', unrealised: '0.00', unrealised_pct: null, realised: '500.00', weight_pct: null })], totals: totals({ open_positions: 0, priced_positions: 0, invested_priced: '0.00', value: '0.00', unrealised: '0.00', unrealised_pct: null, realised: '500.00', total_profit: '500.00', total_return_pct: '50.00', complete: false }) })) })
    await openPortfolio()
    const card = await findCard()
    expect(within(card).getByText('Fully sold')).toBeInTheDocument()
    expect(within(card).getByText('₹500.00')).toBeInTheDocument()
    expect(within(card).queryByText('Latest price')).not.toBeInTheDocument()
  })

  it('lists stock holdings that cannot be priced, with the reason, instead of dropping them', async () => {
    backend({ 'GET /portfolio': () => json(portfolio({ excluded: [{ id: 'x', name: 'Old paper', reason: 'It has no NSE or BSE symbol (like RELIANCE.NS), so it cannot be priced here.' }] })) })
    await openPortfolio()
    expect(await screen.findByText('Not in the portfolio')).toBeInTheDocument()
    expect(screen.getByText(/Old paper/)).toBeInTheDocument()
    expect(screen.getByText(/It has no NSE or BSE symbol/)).toBeInTheDocument()
  })

  it('shows weighted totals over several holdings and the allocation by share of value', async () => {
    const two = portfolio({
      holdings: [
        position({ id: 'a', symbol: 'AAA', ticker: 'AAA.NS', company_name: 'Alpha Ltd', invested: '10000.00', market_value: '12000.00', unrealised: '2000.00', unrealised_pct: '20.00', weight_pct: '12.90' }),
        position({ id: 'b', symbol: 'BBB', ticker: 'BBB.NS', company_name: 'Beta Ltd', invested: '90000.00', market_value: '81000.00', unrealised: '-9000.00', unrealised_pct: '-10.00', weight_pct: '87.10' }),
      ],
      totals: totals({ open_positions: 2, priced_positions: 2, invested_priced: '100000.00', value: '93000.00', unrealised: '-7000.00', unrealised_pct: '-7.00', total_profit: '-7000.00', total_return_pct: '-7.00' }),
    })
    backend({ 'GET /portfolio': () => json(two) })
    await openPortfolio()
    await findCard('Alpha Ltd')
    const summaryPanel = within(document.getElementById('portfolio-summary') as HTMLElement)
    expect(summaryPanel.getAllByText('-₹7,000.00 (-7.00%)')).toHaveLength(2) // weighted: -7000 / 100000, not the +5% average of +20 and -10
    const allocation = within(document.getElementById('portfolio-allocation') as HTMLElement)
    expect(allocation.getByText(/12\.90%/)).toBeInTheDocument()
    expect(allocation.getByText(/87\.10%/)).toBeInTheDocument()
  })
})

describe('history', () => {
  it('shows what was invested from dated purchases and says plainly there is no value history yet', async () => {
    backend({ 'GET /portfolio/history': () => json({ ...HISTORY, invested_timeline: [{ date: '2026-01-05', invested: '10000.00' }, { date: '2026-02-10', invested: '25000.00' }] }) })
    await openPortfolio()
    expect(await screen.findByText(/No value history yet\. The price service does not provide past prices/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Amount invested: ₹10,000.00 on 2026-01-05, ₹25,000.00 on 2026-02-10/ })).toBeInTheDocument()
    expect(screen.queryByText('Value readings (dashed line)')).not.toBeInTheDocument() // no invented value line
  })

  it('draws a value line only from at least two complete readings, labelled with where it starts', async () => {
    const readings = {
      ...HISTORY,
      since: '2026-10-20',
      snapshots: [
        { date: '2026-10-20', market_value: '11000.00', invested: '10000.00', complete: true },
        { date: '2026-10-25', market_value: '12000.00', invested: '10000.00', complete: true },
      ],
    }
    backend({ 'GET /portfolio/history': () => json(readings) })
    await openPortfolio()
    expect(await screen.findByText('Value readings (dashed line)')).toBeInTheDocument()
    expect(screen.getByText(/Value readings since 2026-10-20: 2 so far\. Earlier values are not available and are not guessed\./)).toBeInTheDocument()
  })

  it('with one reading it draws no value line and says a line needs two', async () => {
    backend({ 'GET /portfolio/history': () => json({ ...HISTORY, since: '2026-10-25', snapshots: [{ date: '2026-10-25', market_value: '12000.00', invested: '10000.00', complete: true }] }) })
    await openPortfolio()
    expect(await screen.findByText(/There is one reading so far/)).toBeInTheDocument()
    expect(screen.queryByText('Value readings (dashed line)')).not.toBeInTheDocument()
  })

  it('asks for the chosen period', async () => {
    const { calls } = backend()
    await openPortfolio()
    fireEvent.click(await screen.findByRole('button', { name: '3 months' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/portfolio/history' && c.method === 'GET')).toBe(true))
    expect(screen.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('language', () => {
  it('shows the Hindi title when the language is Hindi', async () => {
    window.localStorage.setItem('arthayukti.language', 'hi')
    backend()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'शेयर पोर्टफ़ोलियो' }))
    expect(await screen.findByRole('heading', { name: 'शेयर पोर्टफ़ोलियो' })).toBeInTheDocument()
  })
})
