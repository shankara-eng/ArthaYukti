import { useRef, useState } from 'react'
import { api, ApiFailure } from '../../api/client'
import type { PortfolioSearch } from '../../api/types'
import type { PortfolioCopy } from '../../i18n/portfolio'
import { blankForm, formIssues, toCreateBody, type Exchange, type HoldingForm } from '../../lib/portfolio'
import { useAction } from '../../state/useAction'
import { FormError, SelectField, TextField } from '../forms'
import { Notice, Panel } from '../panel'

interface Props {
  copy: PortfolioCopy
  onAdded: () => void
}

type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'done'; results: PortfolioSearch['results'] }

/** Find a stock, then enter what you hold and what you paid. The browser never sends a price to be trusted. */
export function AddHolding({ copy, onAdded }: Props) {
  const t = copy.add
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [form, setForm] = useState<HoldingForm>(blankForm)
  const [attempted, setAttempted] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const action = useAction()
  const searchId = useRef(0)
  const issues = formIssues(form)
  const set = (patch: Partial<HoldingForm>) => setForm((current) => ({ ...current, ...patch }))
  const show = (issue: (typeof issues)[number]) => (attempted && issues.includes(issue) ? t.issues[issue] : null)

  async function runSearch() {
    const text = query.trim()
    if (text.length < 2) return
    const mine = ++searchId.current
    setSearch({ status: 'loading' })
    try {
      const found = await api.portfolioSearch(text)
      if (mine === searchId.current) setSearch({ status: 'done', results: found.results })
    } catch (error) {
      if (mine === searchId.current && !(error instanceof DOMException)) setSearch({ status: 'error' })
    }
  }

  async function submit() {
    setAttempted(true)
    setNotice(null)
    if (issues.length > 0) return
    let message = ''
    const ok = await action.run(async () => {
      const saved = await api.portfolioAdd(toCreateBody(form))
      message = `${saved.merged ? t.merged(saved.ticker) : t.added(saved.ticker)}${saved.message ? ` ${saved.message}` : ''}`
    })
    if (ok) {
      setNotice(message)
      setForm((current) => ({ ...blankForm(), exchange: current.exchange }))
      setAttempted(false)
      setSearch({ status: 'idle' })
      setQuery('')
      onAdded()
    }
  }

  return (
    <Panel id="portfolio-add" title={t.title}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <TextField label={t.search} hint={t.searchHint} value={query} onChange={setQuery} maxLength={40} />
          <button type="submit" disabled={search.status === 'loading' || query.trim().length < 2} className="min-h-12 rounded-xl border border-ink px-5 font-semibold disabled:opacity-60 sm:mb-7">
            {search.status === 'loading' ? t.searching : t.searchButton}
          </button>
        </div>
        {search.status === 'error' ? <FormError>{t.searchFailed}</FormError> : null}
        {search.status === 'done' && search.results.length === 0 ? <p className="text-muted">{t.noResults}</p> : null}
        {search.status === 'done' && search.results.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label={t.search}>
            {search.results.map((hit) => (
              <li key={hit.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                <span className="min-w-0">
                  <span className="font-semibold">{hit.company_name}</span> <span className="font-figures text-[13px] text-muted">{hit.symbol}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {hit.tickers.map((ticker) => (
                    <button
                      key={ticker.ticker}
                      type="button"
                      onClick={() => set({ symbol: hit.symbol, exchange: ticker.exchange as Exchange, company: hit.company_name })}
                      className="min-h-10 rounded-lg border border-ink px-3 text-[14px] font-semibold"
                    >
                      {t.pick(hit.symbol, ticker.exchange)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      <form
        noValidate
        aria-label={t.title}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t.symbol} hint={t.symbolHint} value={form.symbol} onChange={(symbol) => set({ symbol })} maxLength={20} error={show('symbol')} />
          <SelectField
            label={t.exchange}
            value={form.exchange}
            onChange={(exchange: Exchange) => set({ exchange })}
            options={(['NSE', 'BSE'] as const).map((value) => ({ value, label: t.exchanges[value] }))}
          />
          <TextField label={t.company} value={form.company} onChange={(company) => set({ company })} maxLength={80} />
          <TextField label={t.quantity} value={form.quantity} onChange={(quantity) => set({ quantity })} inputMode="numeric" maxLength={10} error={show('quantity')} />
          <TextField label={t.price} value={form.price} onChange={(price) => set({ price })} inputMode="decimal" maxLength={13} error={show('price')} />
          <TextField label={t.date} hint={t.dateHint} value={form.date} onChange={(date) => set({ date })} maxLength={10} placeholder="YYYY-MM-DD" error={show('date')} />
        </div>
        {action.failure ? <FormError>{action.failure instanceof ApiFailure && action.failure.status === 409 ? action.failure.message : t.failed}</FormError> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <button type="submit" disabled={action.busy} aria-busy={action.busy} className="min-h-12 self-start rounded-xl bg-ink px-6 font-semibold text-white disabled:opacity-60">
          {action.busy ? t.adding : t.submit}
        </button>
      </form>
    </Panel>
  )
}
