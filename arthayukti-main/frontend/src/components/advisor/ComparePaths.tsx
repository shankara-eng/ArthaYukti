import { useState } from 'react'
import { api } from '../../api/client'
import type { AdvisorAnalysis, AdvisorMetrics, AdvisorScenario } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { buildChange, emptyBuilder, money, signedMoney, type BuilderForm, type BuilderKind } from '../../lib/advisor'
import { monthLabel, type Language } from '../../lib/months'
import { useAction } from '../../state/useAction'
import { FormError, SelectField, TextField } from '../forms'
import { Notice, Panel } from '../panel'

const KINDS: BuilderKind[] = ['simulate_expense_change', 'simulate_investment_change', 'simulate_goal_change', 'simulate_assumption_change']

function payoff(metrics: AdvisorMetrics, language: Language): string {
  if (metrics.debt_free.length === 0) return '–'
  return metrics.debt_free.map((d) => `${d.name}: ${d.month ? monthLabel(d.month, language) : '–'}`).join('; ')
}

interface Props {
  analysis: AdvisorAnalysis
  t: AdvisorCopy
  language: Language
  onScenario: (scenario: AdvisorScenario) => void
}

/** The baseline and the paths the engine (or the person) tried, side by side on one snapshot. */
export function ComparePaths({ analysis, t, language, onScenario }: Props) {
  const c = t.compare
  const base = analysis.baseline_metrics
  const [picked, setPicked] = useState<string[]>(() => analysis.scenarios.slice(0, 4).map((s) => s.id))
  const [form, setForm] = useState<BuilderForm>(() => emptyBuilder(analysis.goal_date_comparison[0]?.goal_id ?? ''))
  const [invalid, setInvalid] = useState(false)
  const run = useAction()
  const shown = analysis.scenarios.filter((s) => picked.includes(s.id))
  const set = (patch: Partial<BuilderForm>) => setForm((current) => ({ ...current, ...patch }))

  async function submit() {
    const change = buildChange(form)
    setInvalid(change === null)
    if (change === null) return
    await run.run(async () => {
      const result = await api.advisorScenario(analysis.id, change)
      onScenario(result)
      setPicked((current) => [...current.slice(-3), result.id])
    })
  }

  const metricRows: { label: string; base: string; of: (m: AdvisorMetrics, s: AdvisorScenario) => string }[] = [
    { label: c.surplus, base: money(base.monthly_surplus), of: (m) => money(m.monthly_surplus) },
    { label: c.minCash, base: money(base.minimum_cash), of: (m) => money(m.minimum_cash) },
    { label: c.goals, base: `${base.goals_achievable} / ${base.goals_total}`, of: (m) => `${m.goals_achievable} / ${m.goals_total}` },
    { label: c.gap, base: money(base.total_funding_gap), of: (m) => money(m.total_funding_gap) },
    { label: c.netWorth, base: money(base.horizon_net_worth), of: (m) => money(m.horizon_net_worth) },
    { label: c.netWorthReal, base: money(base.horizon_net_worth_real), of: (m) => money(m.horizon_net_worth_real) },
    { label: c.payoff, base: payoff(base, language), of: (m, s) => (s.tool === 'simulate_debt_strategy' ? `${String(s.details.payoff_before ?? '–')} → ${String(s.details.payoff_after ?? '–')}` : payoff(m, language)) },
  ]

  return (
    <>
      <Panel id="advisor-compare" title={c.title}>
        <p className="text-muted">{c.lead}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[15px] font-semibold">{c.pick}</legend>
          {analysis.scenarios.map((s) => (
            <label key={s.id} className="flex items-start gap-3 text-[15px]">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-[var(--color-ink)]"
                checked={picked.includes(s.id)}
                onChange={(event) => setPicked((current) => (event.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id)))}
              />
              <span>{s.title}</span>
            </label>
          ))}
        </fieldset>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[15px]">
            <caption className="sr-only">{c.title}</caption>
            <thead className="text-[13px] text-muted">
              <tr>
                <th scope="col" className="border-b border-line py-2 pr-4 font-normal">
                  {c.metric}
                </th>
                <th scope="col" className="border-b border-line py-2 pr-4 font-normal">
                  {c.baseline}
                </th>
                {shown.map((s) => (
                  <th key={s.id} scope="col" className="border-b border-line py-2 pr-4 font-normal">
                    {s.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricRows.map((row) => (
                <tr key={row.label} className="border-b border-line/60">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="font-figures py-2 pr-4">{row.base}</td>
                  {shown.map((s) => (
                    <td key={s.id} className="font-figures py-2 pr-4">
                      {row.of(s.metrics, s)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-line/60">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {c.feasible}
                </th>
                <td className="py-2 pr-4">{c.yes}</td>
                {shown.map((s) => (
                  <td key={s.id} className={`py-2 pr-4 font-semibold ${s.feasible ? 'text-ontime' : 'text-late'}`}>
                    {s.feasible ? c.yes : c.no}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {shown.some((s) => !s.goal_effects_modelled) ? <p className="text-[13px] text-muted">{c.notModelled}</p> : null}
        {shown.map((s) =>
          s.violations.length > 0 ? (
            <Notice key={s.id} tone="warn">
              {s.title}: {s.violations.join(' ')}
            </Notice>
          ) : null,
        )}
      </Panel>

      <Panel id="advisor-builder" title={c.builder}>
        <p className="text-muted">{c.builderLead}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={c.tool} value={form.kind} onChange={(kind) => set({ kind })} options={KINDS.map((k) => ({ value: k, label: c.tools[k] }))} />
          {form.kind === 'simulate_expense_change' ? <TextField label={c.percent} value={form.percent} onChange={(percent) => set({ percent })} inputMode="decimal" /> : null}
          {form.kind === 'simulate_investment_change' ? <TextField label={c.amount} value={form.amount} onChange={(amount) => set({ amount })} inputMode="decimal" /> : null}
          {form.kind === 'simulate_goal_change' ? (
            <>
              <SelectField label={c.goal} value={form.goalId} onChange={(goalId) => set({ goalId })} options={analysis.goal_date_comparison.map((g) => ({ value: g.goal_id, label: g.label }))} />
              <TextField label={c.newDate} value={form.newDate} onChange={(newDate) => set({ newDate })} placeholder="2031-06" />
              <TextField label={c.newAmount} value={form.newAmount} onChange={(newAmount) => set({ newAmount })} inputMode="decimal" />
            </>
          ) : null}
          {form.kind === 'simulate_assumption_change' ? <TextField label={c.returnRate} value={form.returnRate} onChange={(returnRate) => set({ returnRate })} inputMode="decimal" /> : null}
        </div>
        {invalid ? <FormError>{c.invalid}</FormError> : null}
        {run.failure ? <FormError>{c.runFailed}</FormError> : null}
        <button type="button" disabled={run.busy || analysis.stale} onClick={() => void submit()} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
          {run.busy ? c.running : c.run}
        </button>
        {analysis.stale ? <Notice tone="warn">{t.ask.staleBlock}</Notice> : null}
        {picked.length > 0 && shown.length > 0 ? (
          <p className="sr-only" role="status">
            {shown.map((s) => `${s.title}: ${signedMoney(s.deltas.horizon_net_worth)}`).join('; ')}
          </p>
        ) : null}
      </Panel>
    </>
  )
}
