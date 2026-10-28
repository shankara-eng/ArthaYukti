import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import type { PortfolioResponse } from '../../api/types'
import { FormError } from '../../components/forms'
import { AddHolding } from '../../components/portfolio/AddHolding'
import { HistoryChart } from '../../components/portfolio/HistoryChart'
import { HoldingsList } from '../../components/portfolio/HoldingsList'
import { Notice, Panel, Stat } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { AUTO_REFRESH_AFTER_MINUTES, minutesSince, signedPercent, whenText, type Range } from '../../lib/portfolio'
import { useAction } from '../../state/useAction'
import { usePortfolioCopy } from '../../state/usePortfolioCopy'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'

const money = (amount: string) => formatMoney(amount, { paise: true })

/**
 * The stock portfolio: holdings the person entered, valued at the latest price the server could fetch. A price that
 * could not be fetched is shown as unavailable (never zero), with the age of the last good one.
 */
export function StockPortfolioPage() {
  const t = usePortfolioCopy()
  const { language } = useStore()
  const [version, setVersion] = useState(0)
  const [override, setOverride] = useState<PortfolioResponse | null>(null)
  const [range, setRange] = useState<Range>('all')
  const [readings, setReadings] = useState(0)
  const refresh = useAction()
  const auto = useRef(false)
  const remote = useRemote(`portfolio-${version}`, (signal) => api.portfolio(signal))
  const history = useRemote(`portfolio-history-${range}-${version}-${readings}`, (signal) => api.portfolioHistory(range, signal))
  const shown = override ?? remote.data

  const changed = () => {
    setOverride(null)
    setVersion((current) => current + 1)
  }

  async function refreshPrices() {
    await refresh.run(async () => {
      const result = await api.portfolioRefresh()
      setOverride(result)
      setReadings((current) => current + 1)
    })
  }

  // Once, when the page opens: if there are open holdings and no recent price, ask for fresh ones. A failure is shown, not retried.
  useEffect(() => {
    if (auto.current || !remote.data) return
    const open = remote.data.totals.open_positions
    const age = minutesSince(remote.data.latest_price_at)
    if (open > 0 && (age === null || age > AUTO_REFRESH_AFTER_MINUTES)) {
      auto.current = true
      void refreshPrices()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.data])

  const totals = shown?.totals
  const holdings = shown?.holdings ?? []
  const open = holdings.filter((h) => !h.closed)
  const stale = open.filter((h) => h.price_status === 'stale').length
  const latest = shown?.latest_price_at ? whenText(shown.latest_price_at, language) : ''
  const info = override?.refresh ?? null
  const priced = open.filter((h) => h.market_value !== null && h.weight_pct !== null)

  const addPanel = <AddHolding copy={t} onAdded={changed} />

  return (
    <>
      <Panel
        id="portfolio-header"
        title={t.title}
        aside={
          <button type="button" onClick={() => void refreshPrices()} disabled={refresh.busy} aria-busy={refresh.busy} className="flex min-h-10 items-center gap-2 rounded-xl border border-ink px-4 font-semibold disabled:opacity-60">
            <RefreshCw size={16} aria-hidden="true" className={refresh.busy ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refresh.busy ? t.refreshing : t.refresh}
          </button>
        }
      >
        <p className="text-muted">{t.lead}</p>
        <Notice tone="warn">{t.disclaimer}</Notice>
        <p className="text-[13px] text-muted">{t.excludes}</p>
        <p role="status" className="text-[14px]">
          {latest ? t.updated(latest) : shown ? t.neverUpdated : ''}
        </p>
        {refresh.failure ? <FormError>{t.refreshFailed(t.reasons.unavailable, latest)}</FormError> : null}
        {info?.status === 'failed' ? <FormError>{t.refreshFailed(t.reasons[info.error_code ?? 'unavailable'] ?? info.message ?? '', latest)}</FormError> : null}
        {info?.status === 'partial' ? <Notice tone="warn">{t.refreshPartial}</Notice> : null}
        {info?.status === 'ok' && info.requested > 0 ? <p className="text-[14px] text-ontime">{t.refreshOk}</p> : null}
      </Panel>

      {remote.error && !shown ? (
        <div className="flex flex-col items-start gap-2">
          <FormError>{t.loadFailed}</FormError>
          <button type="button" onClick={remote.reload} className="min-h-11 rounded-xl border border-ink px-4 font-semibold">
            {t.retry}
          </button>
        </div>
      ) : null}
      {!shown && !remote.error ? (
        <p role="status" className="text-muted">
          {t.refreshing}
        </p>
      ) : null}

      {shown && holdings.length === 0 ? (
        <>
          <Panel id="portfolio-empty" title={t.holdings.title}>
            <p className="text-muted">{t.holdings.empty}</p>
            <Excluded shown={shown} t={t} />
          </Panel>
        </>
      ) : null}

      {shown && holdings.length > 0 && totals ? (
        <>
          <Panel id="portfolio-summary" title={t.summary.value}>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label={t.summary.invested} value={money(totals.invested_priced)} />
              <Stat label={t.summary.value} value={totals.priced_positions > 0 ? money(totals.value) : '–'} />
              <Stat
                label={t.summary.unrealised}
                value={totals.priced_positions > 0 ? `${money(totals.unrealised)} (${signedPercent(totals.unrealised_pct)})` : '–'}
                tone={totals.priced_positions === 0 ? undefined : totals.unrealised.startsWith('-') ? 'late' : 'good'}
              />
              <Stat label={t.summary.realised} value={money(totals.realised)} />
              <Stat label={t.summary.total} value={totals.total_return_pct !== null ? `${money(totals.total_profit)} (${signedPercent(totals.total_return_pct)})` : '–'} />
            </div>
            {totals.unpriced_positions > 0 ? <Notice tone="warn">{t.summary.coverage(totals.priced_positions, totals.open_positions)}</Notice> : null}
            {Number(totals.invested_unpriced) > 0 ? <p className="text-[13px] text-muted">{t.summary.unpriced(money(totals.invested_unpriced))}</p> : null}
            {stale > 0 ? <Notice tone="warn">{t.summary.stale(stale)}</Notice> : null}
            <p className="text-[13px] text-muted">{t.summary.definitions}</p>
          </Panel>

          <Panel id="portfolio-holdings" title={t.holdings.title}>
            <HoldingsList holdings={holdings} copy={t} language={language} onChanged={changed} />
            <Excluded shown={shown} t={t} />
          </Panel>

          {priced.length > 0 ? (
            <Panel id="portfolio-allocation" title={t.allocation.title}>
              <p className="text-[13px] text-muted">{t.allocation.note}</p>
              <ul className="flex flex-col gap-3">
                {priced.map((h) => (
                  <li key={h.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                      <span>
                        {h.company_name} <span className="font-figures text-[13px] text-muted">{h.symbol}</span>
                      </span>
                      <span className="font-figures">
                        {money(h.market_value as string)} · {h.weight_pct}%
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-sand">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, Number(h.weight_pct))}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel id="portfolio-history" title={t.history.title}>
            {history.data ? <HistoryChart history={history.data} range={range} onRange={setRange} copy={t} /> : history.error ? <FormError>{t.loadFailed}</FormError> : <p role="status" className="text-muted">{t.refreshing}</p>}
          </Panel>
        </>
      ) : null}

      {/* One place in the tree whether or not anything is held yet, so the form keeps its state (and its success message). */}
      {shown ? addPanel : null}
    </>
  )
}

function Excluded({ shown, t }: { shown: PortfolioResponse; t: ReturnType<typeof usePortfolioCopy> }) {
  if (shown.excluded.length === 0) return null
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sand/50 p-3">
      <h3 className="font-semibold">{t.holdings.excludedTitle}</h3>
      <ul className="flex flex-col gap-1 text-[14px]">
        {shown.excluded.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>: {item.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
