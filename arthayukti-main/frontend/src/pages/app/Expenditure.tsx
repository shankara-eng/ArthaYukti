import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import type { Expense } from '../../api/types'
import { AmountField, CheckField, FormError, MonthField, SelectField, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Table } from '../../components/panel'
import { growthToPercent, issuesFor, percentToGrowth, sameLines, SPEND_FREQUENCIES, toLine, toRow, type SpendFrequency, type SpendRow } from '../../lib/expenditure'
import { rateToPercent } from '../../lib/inflation'
import { fromPaise, formatMoney, toPaise } from '../../lib/money'
import { useAction } from '../../state/useAction'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { useStore } from '../../state/useStore'

const HORIZONS = [12, 36, 60, 120] as const
let counter = 0
const uid = () => `spend_${Date.now().toString(36)}${(counter += 1)}`
const submit = 'min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60'

/** Whether a line is being paid in the plan's first month. */
function runningNow(line: Expense, asOf: string): boolean {
  if (!line.start_month) return true
  return line.start_month <= asOf && (!line.end_month || line.end_month >= asOf)
}

/**
 * Planned spending, line by line. A line can repeat monthly, quarterly or yearly, run for a set time or carry on, and
 * grow at its own rate. The year-by-year figures come from the same engine as the surplus, goals and scenarios.
 */
export function ExpenditureSection() {
  const t = useRestructureCopy().spending
  const { plan, planId, dirty, setExpenseLines, setExpenseGrowth, inflation } = useStore()
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60)
  const [rows, setRows] = useState<SpendRow[]>(() => (plan ? (plan.expenses ?? []).map(toRow) : []))
  const [growthText, setGrowthText] = useState<string | null>(null)
  const exporter = useAction()
  const pushed = useRef<Expense[] | null>(null)
  const planStart = plan?.as_of ?? ''

  const checks = useMemo(() => rows.map(issuesFor), [rows])
  const hasIssues = checks.some((issues) => issues.length > 0)
  const planGrowth = plan ? growthToPercent(plan.assumptions.expense_growth_annual) : ''
  const shownGrowth = growthText ?? planGrowth
  const growthBad = percentToGrowth(shownGrowth) === null

  // Valid edits go to the plan; while a line is invalid the plan keeps its last valid lines.
  useEffect(() => {
    if (!plan || hasIssues) return
    const next = rows.map((row) => toLine(row, planStart))
    if (sameLines(next, plan.expenses ?? []) || (pushed.current && sameLines(next, pushed.current))) return
    pushed.current = next
    setExpenseLines(next)
  }, [rows, hasIssues, plan, planStart, setExpenseLines])

  const useSaved = planId !== null && !dirty
  const source = plan ? (useSaved && planId ? { planId } : { plan }) : null
  const canProject = Boolean(plan && plan.goals.length > 0 && !hasIssues)
  const projection = useRemote(
    canProject && plan
      ? JSON.stringify(['spending', horizon, useSaved ? planId : [plan.expenses, plan.assumptions.expense_growth_annual], plan.as_of])
      : null,
    (signal) => (source ? api.expenditureProjection(source, horizon, signal) : Promise.reject(new Error('No plan'))),
  )

  if (!plan) return null

  const update = (id: string, change: Partial<SpendRow>) => setRows((list) => list.map((row) => (row.id === id ? { ...row, ...change } : row)))
  const add = () => setRows((list) => [...list, { id: uid(), name: '', category: '', amount: '', frequency: 'monthly', essential: true, start: '', end: '', growth: '' }])
  const remove = (id: string) => setRows((list) => list.filter((row) => row.id !== id))
  const monthlyNow = (plan.expenses ?? []).filter((line) => runningNow(line, plan.as_of)).reduce((sum, line) => sum + toPaise(line.monthly), 0n)
  const maxAnnual = projection.data ? Math.max(1, ...projection.data.years.map((y) => Number(toPaise(y.annual_expenditure)))) : 1

  async function download() {
    if (!source) return
    await exporter.run(async () => {
      const blob = await api.expenditureProjectionCsv(source, horizon)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'arthayukti_expenditure_projection.csv'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  const frequencyOptions = SPEND_FREQUENCIES.map((value) => ({ value, label: t.frequencies[value] }))

  return (
    <>
      <Panel id="spending" title={t.title}>
        <p className="text-muted">{t.lead}</p>

        <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <h3 className="font-semibold">{t.growthTitle}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t.growthLabel}
              hint={`${t.growthHint} ${t.growthSaved} ${planGrowth}% ${t.perYear}.`}
              value={shownGrowth}
              onChange={(value) => {
                setGrowthText(value)
                const rate = percentToGrowth(value)
                if (rate !== null) setExpenseGrowth(rate)
              }}
              inputMode="decimal"
              error={growthBad ? t.badGrowth : null}
            />
            {inflation ? (
              <div className="flex flex-col justify-end gap-1">
                <p className="text-[14px] text-muted">
                  {t.useDefaultNote} {rateToPercent(inflation.rate)}%.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGrowthText(rateToPercent(inflation.rate))
                    setExpenseGrowth(inflation.rate)
                  }}
                  className="min-h-11 self-start rounded-xl border border-line px-4 font-semibold"
                >
                  {t.useDefault}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? <p className="text-muted">{t.empty}</p> : null}
        <ul className="flex flex-col gap-4">
          {rows.map((row, index) => {
            const issues = checks[index]
            return (
              <li key={row.id} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label={t.name} value={row.name} onChange={(value) => update(row.id, { name: value })} maxLength={80} error={issues.includes('name') ? t.badName : null} />
                  <TextField label={t.category} value={row.category} onChange={(value) => update(row.id, { category: value })} maxLength={80} />
                  <AmountField label={t.amount} value={row.amount} onChange={(value) => update(row.id, { amount: value })} error={issues.includes('amount') ? t.badAmount : null} />
                  <SelectField<SpendFrequency> label={t.frequency} value={row.frequency} onChange={(value) => update(row.id, { frequency: value })} options={frequencyOptions} />
                  <MonthField label={t.starts} hint={t.startsHint} value={row.start} onChange={(value) => update(row.id, { start: value })} />
                  <MonthField label={t.ends} hint={t.endsHint} value={row.end} onChange={(value) => update(row.id, { end: value })} error={issues.includes('end') ? t.badEnd : null} />
                  <TextField label={t.own} hint={t.ownHint} value={row.growth} onChange={(value) => update(row.id, { growth: value })} inputMode="decimal" error={issues.includes('growth') ? t.badGrowth : null} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CheckField label={t.essential} checked={row.essential} onChange={(value) => update(row.id, { essential: value })} />
                  <button type="button" onClick={() => remove(row.id)} aria-label={t.removeLabel(row.name || t.name)} className="flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold text-late">
                    <Trash2 size={18} aria-hidden="true" />
                    {t.remove}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={add} className={`${submit} flex items-center gap-2`} disabled={rows.length >= 60}>
          <Plus size={18} aria-hidden="true" />
          {t.add}
        </button>
        <p className="text-[13px] text-muted">{dirty ? t.unsavedNote : ''}</p>
        <p className="text-[14px] text-muted">
          {t.monthlyNow}: <strong className="font-figures">{formatMoney(fromPaise(monthlyNow))}</strong>
        </p>
        <Notice>{t.note}</Notice>
      </Panel>

      <Panel
        id="spending-projection"
        title={t.chartTitle}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t.horizon} className="flex gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
              {HORIZONS.map((value) => (
                <button key={value} type="button" aria-pressed={horizon === value} onClick={() => setHorizon(value)} className={`min-h-9 rounded-lg px-3 ${horizon === value ? 'bg-ink font-semibold text-white' : 'text-muted hover:text-ink'}`}>
                  {t.years(value / 12)}
                </button>
              ))}
            </div>
            <button type="button" disabled={exporter.busy || !canProject} onClick={() => void download()} className="flex min-h-9 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold disabled:opacity-50">
              <Download size={16} aria-hidden="true" />
              {exporter.busy ? t.downloading : t.download}
            </button>
          </div>
        }
      >
        {exporter.failure ? <FormError>{t.downloadFailed}</FormError> : null}
        {hasIssues ? <FormError>{t.fixFirst}</FormError> : null}
        {!hasIssues && plan.goals.length === 0 ? <Notice>{t.needGoalFirst}</Notice> : null}
        {canProject ? (
          <Loaded remote={projection}>
            {(result) =>
              result.years.length === 0 ? (
                <p className="text-muted">{t.empty}</p>
              ) : (
                <>
                  <p className="text-[14px] text-muted">
                    {t.projectedTotal}: <strong className="font-figures">{formatMoney(result.total_projected_expenditure)}</strong> · {t.projectedNote(result.horizon_months, result.first_month)}
                  </p>
                  <figure className="m-0">
                    <div role="img" aria-label={t.chartSummary} className="flex h-56 items-end gap-2 pt-8">
                      {result.years.map((row) => (
                        <div key={row.year} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                          <span className="font-figures text-[11px] font-semibold sm:text-[12px]">{formatMoney(row.annual_expenditure)}</span>
                          <div tabIndex={0} aria-label={`${row.year}: ${formatMoney(row.annual_expenditure)}`} className="income-bar w-full rounded-md" style={{ height: `${Math.max(3, (Number(toPaise(row.annual_expenditure)) / maxAnnual) * 78)}%` }} />
                          <span className="font-figures text-[12px] text-muted">{row.year}</span>
                        </div>
                      ))}
                    </div>
                  </figure>
                  <Table
                    caption={t.tableTitle}
                    head={[t.year, t.months, t.annual, t.cumulative, t.essentialCol, t.discretionaryCol]}
                    rows={result.years.map((row) => [String(row.year), String(row.months_included), formatMoney(row.annual_expenditure), formatMoney(row.cumulative_expenditure), formatMoney(row.essential), formatMoney(row.discretionary)])}
                  />
                  {result.years.some((row) => row.months_included < 12) ? <p className="text-[13px] text-muted">{t.partial}</p> : null}
                </>
              )
            }
          </Loaded>
        ) : null}
      </Panel>
    </>
  )
}
