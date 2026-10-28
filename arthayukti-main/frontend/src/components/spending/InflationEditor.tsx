import { useState } from 'react'
import { api } from '../../api/client'
import type { SpendingSettings } from '../../api/types'
import { monthOptions, percentToRate, ratePercentText, yearOptions } from '../../lib/spending'
import { useAction } from '../../state/useAction'
import { FormError, SelectField, TextField } from '../forms'
import { failureText } from './failure'

type Mode = 'recalculate_all' | 'from_date'

/** Change the global rate: recalculate the whole projection, or keep the earlier rate before a chosen month. */
export function InflationEditor({ settings, onChanged }: { settings: SpendingSettings; onChanged: () => void }) {
  const [now] = useState(() => new Date())
  const save = useAction()
  const [percent, setPercent] = useState(ratePercentText(settings.current_inflation).replace('%', ''))
  const [mode, setMode] = useState<Mode>('recalculate_all')
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const rate = percentToRate(percent)

  const apply = () =>
    void save.run(async () => {
      if (rate === null) return
      await api.spendingSetInflation(mode === 'recalculate_all' ? { rate, mode } : { rate, mode, effective_year: Number(year), effective_month: Number(month) })
      onChanged()
    })

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-sand/50 p-4">
      <div className="max-w-48">
        <TextField label="Annual inflation (%)" value={percent} onChange={setPercent} inputMode="decimal" error={rate === null ? 'Enter 0 to 30, up to four decimals.' : null} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">How should the new rate apply?</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="rate-mode" checked={mode === 'recalculate_all'} onChange={() => setMode('recalculate_all')} className="mt-1" />
          <span>Recalculate the whole projection with the new rate. Earlier scheduled rate changes are cleared.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="rate-mode" checked={mode === 'from_date'} onChange={() => setMode('from_date')} className="mt-1" />
          <span>Keep the rate in force before a month, and use the new rate from that month on.</span>
        </label>
      </fieldset>
      {mode === 'from_date' ? (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <SelectField label="From year" value={year} onChange={setYear} options={yearOptions(now.getFullYear(), 31)} />
          <SelectField label="From month" value={month} onChange={setMonth} options={monthOptions()} />
        </div>
      ) : null}
      {settings.rate_changes.length > 0 ? (
        <ul className="text-[14px]">
          {settings.rate_changes.map((change) => (
            <li key={change.id} className="flex items-center justify-between gap-3 py-1">
              <span>
                {ratePercentText(change.rate)} from {monthOptions()[change.effective_month - 1].label} {change.effective_year}
              </span>
              <button type="button" className="text-late underline" onClick={() => void save.run(async () => { await api.spendingRemoveRateChange(change.id); onChanged() })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {save.failure ? <FormError>{failureText(save.failure)}</FormError> : null}
      <button type="button" disabled={rate === null || save.busy} onClick={apply} className="min-h-11 self-start rounded-xl bg-ink px-5 font-semibold text-white disabled:opacity-50">
        {save.busy ? 'Saving…' : 'Save rate'}
      </button>
    </div>
  )
}
