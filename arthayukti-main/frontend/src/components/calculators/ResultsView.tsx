import { useState } from 'react'
import type { CalculatorAggregate, CalculatorInvestmentResult, CalculatorResult } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { useCalculatorsCopy } from '../../state/useCalculatorsCopy'
import { Panel, Stat, Table } from '../panel'
import { GrowthChart } from './GrowthChart'

const money = (amount: string) => formatMoney(amount, { paise: true })
const tone = (amount: string) => (amount.startsWith('-') ? 'late' : undefined)

function AggregateStats({ aggregate, label }: { aggregate: CalculatorAggregate; label: string }) {
  const t = useCalculatorsCopy().results
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] font-semibold text-muted">
        {label} · {t.included(aggregate.included)}
      </p>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={t.principal} value={money(aggregate.principal)} />
        <Stat label={t.value} value={money(aggregate.value)} />
        <Stat label={t.gain} value={money(aggregate.gain)} tone={tone(aggregate.gain)} note={`${t.gainOnly} ${money(aggregate.total_gains)} · ${t.lossOnly} ${money(aggregate.total_losses)}`} />
        <Stat label={t.tax} value={money(aggregate.tax)} />
        <Stat label={t.postTax} value={money(aggregate.post_tax_value)} />
        {aggregate.inflation_adjusted_value !== null ? (
          <Stat label={t.real} value={money(aggregate.inflation_adjusted_value)} />
        ) : (
          <Stat label={t.real} value="—" note={t.realUnavailable} />
        )}
      </div>
    </div>
  )
}

function statusNote(result: CalculatorInvestmentResult, t: ReturnType<typeof useCalculatorsCopy>['results']): string {
  switch (result.status) {
    case 'not_started':
      return t.notStarted
    case 'before_maturity':
      return t.beforeMaturity
    case 'after_maturity':
      return t.afterMaturity
    default:
      return t.atMaturity
  }
}

function InvestmentResultCard({ result }: { result: CalculatorInvestmentResult }) {
  const t = useCalculatorsCopy().results
  const [open, setOpen] = useState(false)
  const phase = (value: string) => (value === 'contributing' ? t.contributing : value === 'growth_only' ? t.growthOnly : t.after)
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[18px] font-bold">{result.name}</h3>
        <p className="text-[13px] text-muted">
          {result.valuation_month ? t.valuedAt(result.valuation_month) : null}
          {result.status !== 'not_started' ? ` · ${t.instalments(result.contributions_made)}` : null}
        </p>
      </div>
      <p className="text-[14px] text-muted">{statusNote(result, t)}</p>
      {result.status !== 'not_started' ? (
        <>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label={t.principal} value={money(result.principal)} />
            <Stat label={t.value} value={money(result.value)} />
            <Stat label={t.gain} value={money(result.gain)} tone={tone(result.gain)} />
            <Stat label={t.tax} value={money(result.tax)} />
            <Stat label={t.postTax} value={money(result.post_tax_value)} />
            <Stat label={t.real} value={money(result.inflation_adjusted_value)} />
          </div>
          <GrowthChart points={result.annual.map((row) => ({ label: `${t.year} ${row.year}`, invested: row.cumulative_invested, closing: row.closing }))} />
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="min-h-10 self-start rounded-xl border border-line px-4 text-[14px] font-semibold">
            {open ? t.hideTable : t.showTable}
          </button>
          {open ? (
            <div className="flex flex-col gap-2">
              <Table
                caption={`${result.name}: ${t.annualTitle}`}
                head={[t.year, t.period, t.phase, t.instalment, t.opening, t.contributions, t.growth, t.closing, t.invested, t.gainSoFar, t.realClosing]}
                rows={result.annual.map((row) => [
                  row.year,
                  `${row.from_month} → ${row.to_month}`,
                  phase(row.phase),
                  money(row.instalment),
                  money(row.opening),
                  money(row.contributions),
                  money(row.growth),
                  money(row.closing),
                  money(row.cumulative_invested),
                  money(row.cumulative_gain),
                  money(row.inflation_adjusted_closing),
                ])}
              />
              <p className="text-[13px] text-muted">{t.taxNote}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  )
}

export function ResultsView({ result, onExport, exporting, exportFailed }: { result: CalculatorResult; onExport: () => void; exporting: boolean; exportFailed: boolean }) {
  const copy = useCalculatorsCopy()
  const t = copy.results
  const c = copy.compiled
  const compiled = result.compilation
  const chosen = result.investments.filter((item) => compiled.investment_ids.includes(item.id))
  return (
    <div className="flex flex-col gap-5">
      <Panel
        id="calc-results"
        title={t.title}
        aside={
          <button type="button" disabled={exporting} onClick={onExport} className="min-h-10 rounded-xl border border-line px-4 text-[14px] font-semibold disabled:opacity-60">
            {exporting ? t.exporting : t.export}
          </button>
        }
      >
        {exportFailed ? (
          <p role="alert" className="text-[14px] font-semibold text-late">
            {t.exportFailed}
          </p>
        ) : null}
        <AggregateStats aggregate={result.aggregate} label={t.total} />
        {result.aggregate.mixed_valuation_dates ? <p className="rounded-xl bg-blush px-4 py-3 text-[14px]">{copy.valuation.mixed}</p> : null}
        <div className="flex flex-col gap-4">
          {result.investments.map((item) => (
            <InvestmentResultCard key={item.id} result={item} />
          ))}
        </div>
      </Panel>

      <Panel id="calc-compiled" title={c.title}>
        <p className="text-muted">{c.body}</p>
        {chosen.length === 0 ? (
          <p className="text-[14px] font-semibold">{c.none}</p>
        ) : (
          <>
            <p className="text-[14px] font-semibold">{chosen.map((item) => item.name).join(', ')}</p>
            <AggregateStats aggregate={compiled.aggregate} label={c.title} />
            <GrowthChart points={compiled.years.map((row) => ({ label: String(row.year), invested: row.cumulative_invested, closing: row.closing_total }))} />
            <Table
              caption={c.title}
              head={[c.year, c.contributions, c.growing, c.held, c.total, c.invested, c.gain]}
              rows={compiled.years.map((row) => [
                row.year,
                money(row.contributions),
                money(row.closing_active),
                money(row.matured_held),
                money(row.closing_total),
                money(row.cumulative_invested),
                money(row.cumulative_gain),
              ])}
            />
          </>
        )}
      </Panel>
    </div>
  )
}
