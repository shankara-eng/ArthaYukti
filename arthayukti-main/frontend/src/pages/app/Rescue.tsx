import { useState } from 'react'
import { api } from '../../api/client'
import type { RescueAlternativeItem, RescueResponse } from '../../api/types'
import { AmountField, CheckField, FormError, TextField } from '../../components/forms'
import { Notice, Panel, Stat } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import type { Route } from '../../lib/route'
import { useAction } from '../../state/useAction'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { useModulesCopy } from '../../state/useModulesCopy'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { useStore } from '../../state/useStore'

const submitClass = 'min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60'

/** A whole percentage from 0 to 100 as the engine's two-decimal fraction, or null. */
function wholePercentToFraction(text: string): string | null {
  if (!/^\d{1,3}$/.test(text)) return null
  const n = Number(text)
  if (n > 100) return null
  return n === 100 ? '1.00' : `0.${String(n).padStart(2, '0')}`
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">{title}</p>
      <ul className="list-disc pl-5 text-[15px]">
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

function Option({ item, recommended }: { item: RescueAlternativeItem; recommended: boolean }) {
  const t = useExtrasCopy().rescue
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border p-4 ${recommended ? 'border-brand bg-sage/60' : 'border-line bg-surface/60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[18px] font-bold">{item.title}</h3>
        {recommended ? <span className="rounded-xl bg-brand px-3 py-1 text-[13px] font-semibold text-white">{t.recommended}</span> : null}
        <span className={`rounded-xl px-3 py-1 text-[13px] font-semibold ${item.is_feasible ? 'bg-sage text-ontime' : 'bg-blush text-late'}`}>{item.is_feasible ? t.feasible : t.notFeasible}</span>
      </div>
      <p>{item.description}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t.monthly} value={formatMoney(item.monthly_savings_change)} />
        <Stat label={t.shortfall} value={formatMoney(item.total_shortfall_today)} tone={item.is_feasible ? 'good' : 'late'} />
        <p className="self-end text-[15px] font-semibold">{t.counts(item.result_summary.on_track, item.result_summary.delayed, item.result_summary.not_achievable)}</p>
      </div>
      <List title={t.kept} items={item.constraints_satisfied} />
      <List title={t.broken} items={item.constraints_violated} />
      <List title={t.tradeoffs} items={item.tradeoffs} />
      <List title={t.assumptions} items={item.assumptions} />
    </li>
  )
}

/** Constraint-aware rescue: the server tries ways to fit the goals inside limits the person sets. */
export function RescuePage({ navigate }: { navigate?: (route: Route) => void } = {}) {
  const planB = usePlanBCopy().entry
  const t = useExtrasCopy().rescue
  const m = useModulesCopy()
  const { plan, scenario } = useStore()
  const [avoidDebt, setAvoidDebt] = useState(true)
  const [reserve, setReserve] = useState('')
  const [delay, setDelay] = useState('24')
  const [cut, setCut] = useState('20')
  const [sell, setSell] = useState(false)
  const [sellAmount, setSellAmount] = useState('')
  const [extra, setExtra] = useState('')
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<RescueResponse | null>(null)
  const run = useAction()

  if (!plan) return <Notice>{t.needsPlan}</Notice>
  const fraction = wholePercentToFraction(cut)
  const delayOk = /^\d{1,3}$/.test(delay) && Number(delay) <= 120

  async function analyse() {
    setTried(true)
    if (!plan || fraction === null || !delayOk) return
    await run.run(async () => {
      setResult(
        await api.rescue({
          plan,
          scenario,
          avoid_new_debt: avoidDebt,
          min_emergency_reserve: reserve || '0.00',
          max_delay_months: Number(delay),
          allow_discretionary_cut_pct: fraction,
          allow_asset_sale: sell,
          asset_sale_amount: sell ? sellAmount || '0.00' : '0.00',
          extra_monthly_budget: extra || '0.00',
        }),
      )
    })
  }

  return (
    <>
      {navigate ? (
        <Panel id="plan-b-entry" title={planB.title}>
          <p className="text-muted">{planB.body}</p>
          <button type="button" onClick={() => navigate('plan-b')} className={submitClass}>
            {planB.open}
          </button>
        </Panel>
      ) : null}
      <Panel title={t.title}>
        <p className="text-muted">{t.body}</p>
        <h3 className="font-semibold">{t.limits}</h3>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void analyse()
          }}
        >
          <div className="sm:col-span-2">
            <CheckField label={t.avoidDebt} checked={avoidDebt} onChange={setAvoidDebt} />
          </div>
          <AmountField label={t.reserve} value={reserve} onChange={setReserve} />
          <TextField label={t.maxDelay} value={delay} onChange={setDelay} maxLength={3} error={tried && !delayOk ? t.badDelay : null} />
          <TextField label={t.cut} value={cut} onChange={setCut} maxLength={3} error={tried && fraction === null ? t.badCut : null} />
          <AmountField label={t.extra} value={extra} onChange={setExtra} />
          <div className="sm:col-span-2">
            <CheckField label={t.sell} checked={sell} onChange={setSell} />
          </div>
          {sell ? <AmountField label={t.sellAmount} value={sellAmount} onChange={setSellAmount} /> : null}
          {run.failure ? (
            <div className="sm:col-span-2">
              <FormError>{t.failed}</FormError>
            </div>
          ) : null}
          <button type="submit" disabled={run.busy} className={submitClass}>
            {run.busy ? t.running : t.run}
          </button>
        </form>
      </Panel>

      {result ? (
        <Panel title={t.title} aside={<span className="text-[13px] text-muted">{m.common.fromEngine}</span>}>
          <Notice tone={result.is_baseline_feasible ? undefined : 'warn'}>{result.is_baseline_feasible ? t.baselineOk : t.baselineNot}</Notice>
          <p className="font-semibold">{t.counts(result.baseline_summary.on_track, result.baseline_summary.delayed, result.baseline_summary.not_achievable)}</p>
          {result.unresolved_gap ? <Stat label={t.gap} value={formatMoney(result.unresolved_gap)} tone="late" /> : null}
          {result.binding_constraint ? <p><span className="text-muted">{t.binding}:</span> <strong>{result.binding_constraint.replace(/_/g, ' ')}</strong></p> : null}
          {result.alternatives.length === 0 ? (
            <p className="text-muted">{t.noOptions}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {result.alternatives.map((item) => (
                <Option key={item.alternative_id} item={item} recommended={item.alternative_id === result.recommended_alternative_id} />
              ))}
            </ul>
          )}
          <p className="text-[14px] text-muted">
            <strong>{t.ranking}:</strong> {result.ranking_criteria}
          </p>
          <List title={t.missing} items={result.missing_information} />
          <List title={t.assumptions} items={result.assumptions} />
          <Notice>{t.noApply}</Notice>
          <p className="font-figures text-[12px] text-muted">
            {t.run_id}: {result.run_id}
          </p>
        </Panel>
      ) : null}
    </>
  )
}
