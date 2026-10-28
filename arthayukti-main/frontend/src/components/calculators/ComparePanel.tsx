import { useState } from 'react'
import { ApiFailure, api } from '../../api/client'
import type { CalculatorCompareEntry, CalculatorCompareResponse, CalculatorConfig, CalculatorScenarioSummary } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { useCalculatorsCopy } from '../../state/useCalculatorsCopy'
import { TextField } from '../forms'
import { Panel, Table } from '../panel'

const CURRENT = '__current__'
const money = (amount: string) => formatMoney(amount, { paise: true })

/** Pick two to four calculators (saved ones, or this one as it is now) and see their totals side by side. */
export function ComparePanel({ scenarios, current }: { scenarios: CalculatorScenarioSummary[]; current: CalculatorConfig | null }) {
  const t = useCalculatorsCopy().compare
  const [picked, setPicked] = useState<string[]>([])
  const [commonDate, setCommonDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CalculatorCompareResponse | null>(null)

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= 4 ? list : [...list, id]))

  async function run() {
    setError(null)
    if (picked.length < 2) {
      setError(t.needTwo)
      return
    }
    const entries: CalculatorCompareEntry[] = picked.map((id) =>
      id === CURRENT ? { config: current as CalculatorConfig, label: t.current } : { scenario_id: id },
    )
    setBusy(true)
    try {
      setResult(await api.calcCompare(entries, /^\d{4}-(0[1-9]|1[0-2])$/.test(commonDate) ? commonDate : null))
    } catch (failure) {
      setResult(null)
      setError(failure instanceof ApiFailure && failure.code === 'maturity_decision_required' ? t.needDecision : failure instanceof ApiFailure ? failure.message : t.failed)
    } finally {
      setBusy(false)
    }
  }

  const options = [...(current ? [{ id: CURRENT, name: t.current }] : []), ...scenarios.map((item) => ({ id: item.id, name: item.name }))]

  return (
    <Panel id="calc-compare" title={t.title}>
      <p className="text-muted">{t.body}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[15px] font-semibold">{t.pick}</legend>
        {options.map((option) => (
          <label key={option.id} className="flex min-h-10 items-center gap-2 text-[15px]">
            <input type="checkbox" checked={picked.includes(option.id)} onChange={() => toggle(option.id)} className="size-4 accent-[var(--color-brand)]" />
            {option.name}
          </label>
        ))}
      </fieldset>
      <div className="max-w-xs">
        <TextField label={t.commonDate} type="month" value={commonDate} onChange={setCommonDate} hint={t.commonHint} />
      </div>
      <button type="button" disabled={busy} onClick={() => void run()} className="min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">
        {busy ? t.running : t.run}
      </button>
      {error ? (
        <p role="alert" className="text-[14px] font-semibold text-late">
          {error}
        </p>
      ) : null}
      {result ? (
        <Table
          caption={t.title}
          head={[t.label, t.put, t.value, t.postTax, t.delta]}
          rows={result.rows.map((row) => [
            <span key="l">
              {row.label}
              {row.aggregate.mixed_valuation_dates ? <span className="block text-[12px] text-muted">{t.mixed}</span> : null}
            </span>,
            money(row.aggregate.principal),
            money(row.aggregate.value),
            money(row.aggregate.post_tax_value),
            money(row.delta_post_tax_vs_first),
          ])}
        />
      ) : null}
    </Panel>
  )
}
