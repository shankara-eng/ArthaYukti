import { useState } from 'react'
import { api } from '../../api/client'
import type { MarketQuoteResponse } from '../../api/types'
import { FormError, TextField } from '../../components/forms'
import { Notice, Panel, Stat } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { useAction } from '../../state/useAction'
import { useExtrasCopy } from '../../state/useExtrasCopy'

const SYMBOL = /^[A-Za-z0-9._&-]{1,30}$/

/** A stored price and how old it is, exactly as the server reports it: recent, out of date, or none. */
export function QuoteLookup() {
  const t = useExtrasCopy().market
  const [symbol, setSymbol] = useState('')
  const [tried, setTried] = useState(false)
  const [quote, setQuote] = useState<MarketQuoteResponse | null>(null)
  const look = useAction()
  const bad = tried && !SYMBOL.test(symbol.trim())

  async function find() {
    setTried(true)
    const clean = symbol.trim()
    if (!SYMBOL.test(clean)) return
    setQuote(null)
    await look.run(async () => setQuote(await api.marketQuote(clean)))
  }

  const label = quote ? t[quote.status] : ''

  return (
    <Panel title={t.title}>
      <p className="text-muted">{t.body}</p>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void find()
        }}
      >
        <div className="min-w-[220px] flex-1">
          <TextField label={t.symbol} hint={t.hint} value={symbol} onChange={setSymbol} maxLength={30} error={bad ? t.badSymbol : null} />
        </div>
        <button type="submit" disabled={look.busy} className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
          {look.busy ? t.looking : t.look}
        </button>
      </form>
      {look.failure ? <FormError>{t.failed}</FormError> : null}
      {quote ? (
        <div role="status" className="flex flex-col gap-3 rounded-2xl bg-surface/60 p-4">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="font-figures">{quote.symbol}</span>
            <span className={`rounded-xl px-3 py-1 text-[13px] ${quote.status === 'fresh' ? 'bg-sage text-ontime' : quote.status === 'stale' ? 'bg-sand' : 'bg-blush text-late'}`}>{label}</span>
          </p>
          {quote.price ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t.price} value={formatMoney(quote.price, { paise: true })} note={quote.currency ?? undefined} />
              <Stat label={t.source} value={quote.source ?? '–'} />
              <Stat label={t.asOf} value={quote.fetched_at ? quote.fetched_at.slice(0, 10) : '–'} />
            </div>
          ) : null}
          {quote.message ? <p>{quote.message}</p> : null}
          <Notice>{t.notePrice}</Notice>
        </div>
      ) : null}
    </Panel>
  )
}
