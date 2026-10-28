import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../api/client'
import type { IncomeProjectionResponse, Plan } from '../../api/types'
import { FormError, TextField } from '../../components/forms'
import { Notice, Panel, Table } from '../../components/panel'
import { parseYears } from '../../lib/incomeForm'
import { formatMoney, toPaise } from '../../lib/money'
import { useAction } from '../../state/useAction'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { useStore } from '../../state/useStore'

type Source = { planId: string } | { plan: Plan }

interface Calculated {
  result: IncomeProjectionResponse
  source: Source
  months: number
  /** What the figures were worked out from, to tell when they no longer match the incomes or the period. */
  signature: string
}

/**
 * Income Trajectory: the confirmed incomes projected year by year for a chosen number of years. Nothing is worked
 * out until the person asks, and a result is marked out of date when the incomes or the period change after it.
 */
export function IncomeTrajectorySection() {
  const t = useExtrasCopy().income
  const { plan, planId, dirty } = useStore()
  const [yearsText, setYearsText] = useState('10')
  const [calculated, setCalculated] = useState<Calculated | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const running = useRef(false)
  const exporter = useAction()

  if (!plan) return null
  const years = parseYears(yearsText)
  const real = plan.income_streams.some((stream) => stream.start_year != null || toPaise(stream.monthly_net) > 0n)
  const useSaved = planId !== null && !dirty
  const source: Source = useSaved && planId ? { planId } : { plan }
  const signatureNow = JSON.stringify([plan.income_streams, plan.as_of, plan.assumptions.income_growth_annual, years])
  const stale = calculated !== null && calculated.signature !== signatureNow

  async function calculate() {
    setAttempted(true)
    if (years === null || running.current) return
    running.current = true
    setBusy(true)
    setFailed(false)
    try {
      const months = years * 12
      const result = await api.incomeProjection(source, months)
      setCalculated({ result, source, months, signature: signatureNow })
    } catch {
      setFailed(true) // the last result, if any, stays on screen
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  async function download() {
    if (!calculated) return
    await exporter.run(async () => {
      const blob = await api.incomeProjectionCsv(calculated.source, calculated.months)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'arthayukti_income_projection.csv'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <Panel id="income-trajectory" title={t.trajectoryTitle}>
      <p className="text-muted">{t.trajectoryLead}</p>
      {!real ? (
        <Notice>{t.trajectoryEmpty}</Notice>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void calculate()
          }}
          className="grid items-end gap-3 sm:grid-cols-[minmax(0,260px)_auto]"
        >
          <TextField
            label={t.period}
            hint={t.periodHint}
            value={yearsText}
            onChange={setYearsText}
            inputMode="numeric"
            maxLength={2}
            error={attempted && years === null ? t.badPeriod : null}
          />
          <button type="submit" disabled={busy} aria-busy={busy} className="min-h-12 rounded-xl bg-ink px-5 font-semibold text-white disabled:opacity-60 sm:mb-0">
            {busy ? t.calculating : t.calculate}
          </button>
        </form>
      )}
      {failed ? <FormError>{t.loadFailed}</FormError> : null}
      {real && !calculated && !failed ? <p className="text-muted">{t.notYet}</p> : null}
      {stale ? <Notice tone="warn">{t.stale}</Notice> : null}

      {calculated ? (
        <div className={stale ? 'flex flex-col gap-4 opacity-70' : 'flex flex-col gap-4'}>
          <Results data={calculated.result} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={exporter.busy}
              onClick={() => void download()}
              className="flex min-h-10 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold disabled:opacity-50"
            >
              <Download size={16} aria-hidden="true" />
              {exporter.busy ? t.exporting : t.export}
            </button>
            {exporter.failure ? <FormError>{t.exportFailed}</FormError> : null}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function Results({ data }: { data: IncomeProjectionResponse }) {
  const t = useExtrasCopy().income
  const max = Math.max(1, ...data.years.map((row) => Number(toPaise(row.annual_income))))
  const crowded = data.years.length > 12 // too many bars for a figure above each one
  const step = Math.ceil(data.years.length / 8)
  const planGrowth = Number(data.plan_growth_annual) * 100
  return (
    <>
      <div>
        <p className="text-[14px] text-muted">{t.total}</p>
        <p className="font-figures text-[30px] font-semibold" aria-live="polite">
          {formatMoney(data.total_projected_income)}
        </p>
        <p className="text-[13px] text-muted">{t.totalNote(data.horizon_months, data.first_month)}</p>
      </div>

      <figure className="m-0">
        <div role="img" aria-label={t.chartSummary} className="flex h-56 items-end gap-1 pt-8 sm:gap-2">
          {data.years.map((row, index) => (
            <div key={row.year} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {crowded ? null : <span className="font-figures text-[11px] font-semibold sm:text-[12px]">{formatMoney(row.annual_income)}</span>}
              <div
                tabIndex={0}
                title={`${row.year}: ${formatMoney(row.annual_income)}`}
                aria-label={`${row.year}: ${formatMoney(row.annual_income)}`}
                className="income-bar w-full rounded-md"
                style={{ height: `${Math.max(3, (Number(toPaise(row.annual_income)) / max) * 78)}%` }}
              />
              <span className="h-4 font-figures text-[11px] text-muted sm:text-[12px]">{!crowded || index % step === 0 || index === data.years.length - 1 ? row.year : ''}</span>
            </div>
          ))}
        </div>
      </figure>

      <Table
        caption={t.tableTitle}
        head={[t.year, t.annual, t.cumulative]}
        rows={data.years.map((row) => [
          row.months_included < 12 ? `${row.year} (${t.partial(row.months_included)})` : String(row.year),
          formatMoney(row.annual_income),
          formatMoney(row.cumulative_income),
        ])}
      />
      {data.years.some((row) => row.months_included < 12) ? <p className="text-[13px] text-muted">{t.partialNote}</p> : null}

      <div className="flex flex-col gap-2 rounded-2xl bg-sand/50 p-4">
        <h3 className="font-semibold">{t.assumptions}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted">
          {data.sources.map((source) => (
            <li key={source.id}>
              <span className="font-semibold text-ink">{source.label}</span>: {t.sourceLine(formatMoney(source.entered_amount), source.frequency, formatMoney(source.monthly_equivalent))}
              {source.kind === 'scheduled'
                ? ` ${Number(source.effective_growth_annual) > 0 ? t.raiseSummary(String(Number(source.effective_growth_annual) * 100), source.growth_start_year ?? source.start_year! + 1) : t.noRaise}`
                : ` ${planGrowth > 0 ? t.legacyGrowth(String(planGrowth)) : t.noRaise}`}
            </li>
          ))}
        </ul>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted">
          {data.conventions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </>
  )
}
