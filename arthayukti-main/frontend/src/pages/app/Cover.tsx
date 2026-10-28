import { useState } from 'react'
import { api } from '../../api/client'
import type { EscalationCreateRequest, EscalationHistoryResponse, EscalationResponse, PolicyResponse } from '../../api/types'
import { AmountField, DateField, FormError, SelectField, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { percentToRate } from '../../lib/onboarding'
import { useAction } from '../../state/useAction'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRemote } from '../../state/useRemote'

const options = <T extends string>(labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value: value as T, label }))
const submitClass = 'min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60'

/** One policy read back from the server, so what is shown is what is stored. */
export function PolicyDetail({ policies }: { policies: PolicyResponse[] }) {
  const x = useExtrasCopy().cover
  const m = useModulesCopy()
  const [id, setId] = useState('')
  const detail = useRemote(id ? `policy-${id}` : null, (signal) => api.policy(id, signal))
  if (policies.length === 0) return null
  return (
    <Panel title={x.detailTitle}>
      <SelectField label={x.pick} value={id} onChange={setId} options={[{ value: '', label: '–' }, ...policies.map((p) => ({ value: p.id, label: `${p.insurer_name} · ${p.policy_number}` }))]} />
      {id ? (
        <Loaded remote={detail}>
          {(p) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label={x.base} value={formatMoney(p.base_sum_assured)} />
              <Stat label={x.now} value={formatMoney(p.current_effective_sum_assured)} />
              <Stat label={m.insurance.premium} value={formatMoney(p.premium_amount)} note={p.premium_frequency} />
              <Stat label={x.renewal} value={p.renewal_date ?? m.insurance.noRenewal} />
              <Stat label={x.status} value={p.status} />
              <Stat label={m.insurance.start} value={p.start_date} />
            </div>
          )}
        </Loaded>
      ) : null}
    </Panel>
  )
}

/** Record how a policy's cover grows and apply each step. Rules made here are the only ones this page can show. */
export function CoverGrowth({ policies, onChanged }: { policies: PolicyResponse[]; onChanged: () => void }) {
  const x = useExtrasCopy().cover
  const m = useModulesCopy()
  const [policy, setPolicy] = useState('')
  const [kind, setKind] = useState<EscalationCreateRequest['escalation_type']>('fixed_percentage')
  const [frequency, setFrequency] = useState<NonNullable<EscalationCreateRequest['escalation_frequency']>>('annual')
  const [rate, setRate] = useState('')
  const [amount, setAmount] = useState('')
  const [first, setFirst] = useState('')
  const [tried, setTried] = useState(false)
  const [rules, setRules] = useState<EscalationResponse[]>([])
  const [history, setHistory] = useState<Record<string, EscalationHistoryResponse[]>>({})
  const [saved, setSaved] = useState(false)
  const create = useAction()
  const apply = useAction()

  if (policies.length === 0) return null
  const needsRate = kind === 'fixed_percentage' || kind === 'step_up'
  const needsAmount = kind === 'fixed_amount'
  const rateValue = needsRate ? percentToRate(rate) : null
  const rateBad = tried && needsRate && rateValue === null
  const amountBad = tried && needsAmount && amount === ''
  const chosen = policy || policies[0].id

  async function save() {
    setTried(true)
    setSaved(false)
    if ((needsRate && rateValue === null) || (needsAmount && amount === '')) return
    let made: EscalationResponse | null = null
    const ok = await create.run(async () => {
      made = await api.createEscalation({
        policy_id: chosen,
        escalation_type: kind,
        escalation_frequency: frequency,
        escalation_rate: needsRate ? rateValue : null,
        fixed_escalation_amount: needsAmount ? amount : null,
        first_escalation_date: first || null,
        medical_underwriting_required: false,
        premium_increases_with_cover: false,
      })
    })
    if (ok && made) {
      setRules((list) => [made as EscalationResponse, ...list])
      setSaved(true)
      setTried(false)
      onChanged()
    }
  }

  async function step(rule: EscalationResponse) {
    const ok = await apply.run(async () => {
      const row = await api.processEscalation(rule.id, { event_type: 'scheduled' })
      setHistory((all) => ({ ...all, [rule.id]: [row, ...(all[rule.id] ?? [])] }))
      const fresh = await api.escalation(rule.id)
      setRules((list) => list.map((item) => (item.id === fresh.id ? fresh : item)))
    })
    if (ok) onChanged()
  }

  return (
    <Panel title={x.growthTitle}>
      <p className="text-muted">{x.growthBody}</p>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <SelectField label={m.insurance.insurer} value={chosen} onChange={setPolicy} options={policies.map((p) => ({ value: p.id, label: `${p.insurer_name} · ${p.policy_number}` }))} />
        <SelectField label={x.type} value={kind} onChange={setKind} options={options<EscalationCreateRequest['escalation_type']>(x.types)} />
        <SelectField label={x.frequency} value={frequency} onChange={setFrequency} options={options<NonNullable<EscalationCreateRequest['escalation_frequency']>>(Object.fromEntries(Object.entries(x.frequencies).filter(([key]) => key !== 'custom')))} />
        <DateField label={x.first} value={first} onChange={setFirst} />
        {needsRate ? <TextField label={x.rate} value={rate} onChange={setRate} maxLength={6} error={rateBad ? x.needRate : null} /> : null}
        {needsAmount ? <AmountField label={x.amount} value={amount} onChange={setAmount} error={amountBad ? x.needAmount : null} /> : null}
        {create.failure ? (
          <div className="sm:col-span-2">
            <FormError>{x.failed}</FormError>
          </div>
        ) : null}
        {saved ? (
          <p role="status" className="font-semibold text-ontime sm:col-span-2">
            {x.saved}
          </p>
        ) : null}
        <button type="submit" disabled={create.busy} className={submitClass}>
          {create.busy ? x.saving : x.save}
        </button>
      </form>

      {rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-3 rounded-2xl bg-surface/60 p-4">
          <p className="font-semibold">
            {x.openRule}: {x.types[rule.escalation_type as keyof typeof x.types] ?? rule.escalation_type}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={x.base} value={formatMoney(rule.base_sum_assured)} />
            <Stat label={x.now} value={formatMoney(rule.current_effective_sum_assured)} />
            <Stat label={x.first} value={rule.next_escalation_date ?? '–'} />
          </div>
          <button type="button" disabled={apply.busy} onClick={() => void step(rule)} className="min-h-11 self-start rounded-xl border border-brand px-5 font-semibold text-brand disabled:opacity-60">
            {apply.busy ? x.applying : x.apply}
          </button>
          {apply.failure ? <FormError>{x.failed}</FormError> : null}
          <h3 className="font-semibold">{x.history}</h3>
          {(history[rule.id] ?? []).length === 0 ? (
            <p className="text-muted">{x.noHistory}</p>
          ) : (
            <Table
              caption={x.history}
              head={[x.effective, x.prior, x.increase, x.after]}
              rows={(history[rule.id] ?? []).map((row) => [row.effective_date, formatMoney(row.prior_cover), formatMoney(row.increase_amount), formatMoney(row.resulting_cover)])}
            />
          )}
        </div>
      ))}
      <Notice>{m.insurance.note}</Notice>
    </Panel>
  )
}
