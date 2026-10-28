import { useState } from 'react'
import { api } from '../../api/client'
import type { InvestmentCreateRequest, LiabilityCreateRequest, PolicyCreateRequest } from '../../api/types'
import { AmountField, CheckField, DateField, FormError, SelectField, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { percentToRate } from '../../lib/onboarding'
import { useAction } from '../../state/useAction'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { useRemote } from '../../state/useRemote'
import { CoverGrowth, PolicyDetail } from './Cover'
import { QuoteLookup } from './Market'

const options = <T extends string>(labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value: value as T, label }))
const submitClass = 'min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60'

function Form({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

// ---- assets and balances -------------------------------------------------------------------

export function AssetsPage() {
  const m = useModulesCopy()
  const a = m.assets
  const symbolLabel = useRestructureCopy().holdings.symbolLabel
  const symbolHint = useRestructureCopy().holdings.symbolHint
  const holdings = useRemote('holdings', (signal) => api.investments(signal))
  const balances = useRemote('balances', (signal) => api.accounts(signal))

  const [name, setName] = useState('')
  const [kind, setKind] = useState<InvestmentCreateRequest['asset_type']>('mutual_fund')
  const [value, setValue] = useState('')
  const [cost, setCost] = useState('')
  const [date, setDate] = useState('')
  const [symbol, setSymbol] = useState('')
  const [quick, setQuick] = useState(true)
  const [tried, setTried] = useState(false)
  const save = useAction()

  const [bName, setBName] = useState('')
  const [bKind, setBKind] = useState<'savings' | 'checking' | 'fixed_deposit' | 'wallet' | 'other'>('savings')
  const [bAmount, setBAmount] = useState('')
  const [bQuick, setBQuick] = useState(true)
  const [bTried, setBTried] = useState(false)
  const saveBalance = useAction()

  async function addAsset() {
    setTried(true)
    if (name.trim() === '' || value === '') return
    const ok = await save.run(() =>
      api.createInvestment({ asset_name: name.trim(), asset_type: kind, quantity: '1.0000', purchase_price: cost || value, current_value: value, is_liquid: quick, last_valuation_date: date || null, ...(symbol.trim() ? { symbol: symbol.trim().toUpperCase() } : {}) }),
    )
    if (ok) {
      setName('')
      setValue('')
      setCost('')
      setDate('')
      setSymbol('')
      setTried(false)
      holdings.reload()
    }
  }

  async function addBalance() {
    setBTried(true)
    if (bName.trim() === '' || bAmount === '') return
    const ok = await saveBalance.run(() => api.createAccount({ account_name: bName.trim(), account_type: bKind, balance: bAmount, currency: 'INR', is_liquid: bQuick }))
    if (ok) {
      setBName('')
      setBAmount('')
      setBTried(false)
      balances.reload()
    }
  }

  return (
    <>
      <Panel title={a.investments}>
        <Loaded remote={holdings}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">{m.common.none}</p>
            ) : (
              <Table
                caption={a.investments}
                head={[m.common.name, m.common.kind, a.current, a.asOf, m.common.liquid]}
                rows={list.map((h) => [h.asset_name, a.kinds[h.asset_type] ?? h.asset_type, formatMoney(h.current_value), h.last_valuation_date ?? '–', h.is_liquid ? m.common.yes : m.common.no])}
              />
            )
          }
        </Loaded>
        <h3 className="font-semibold">{a.addInvestment}</h3>
        <Form onSubmit={() => void addAsset()}>
          <TextField label={m.common.name} value={name} onChange={setName} maxLength={80} error={tried && name.trim() === '' ? m.common.enterName : null} />
          <SelectField label={m.common.kind} value={kind} onChange={setKind} options={options<InvestmentCreateRequest['asset_type']>(a.kinds)} />
          <AmountField label={a.current} value={value} onChange={setValue} error={tried && value === '' ? m.common.enterAmount : null} />
          <AmountField label={a.invested} value={cost} onChange={setCost} />
          <TextField label={symbolLabel} hint={symbolHint} value={symbol} onChange={setSymbol} maxLength={20} />
          <DateField label={a.asOf} value={date} onChange={setDate} />
          <div className="flex items-end">
            <CheckField label={a.quick} checked={quick} onChange={setQuick} />
          </div>
          {save.failure ? <div className="sm:col-span-2"><FormError>{m.common.saveFailed}</FormError></div> : null}
          <button type="submit" disabled={save.busy} className={submitClass}>
            {save.busy ? m.common.adding : m.common.add}
          </button>
        </Form>
        <Notice>{a.note}</Notice>
      </Panel>

      <Panel title={a.balances}>
        <Loaded remote={balances}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">{m.common.none}</p>
            ) : (
              <Table
                caption={a.balances}
                head={[m.common.name, m.common.kind, m.common.value, m.common.liquid]}
                rows={list.map((acc) => [acc.account_name, a.accountKinds[acc.account_type] ?? acc.account_type, formatMoney(acc.balance), acc.is_liquid ? m.common.yes : m.common.no])}
              />
            )
          }
        </Loaded>
        <h3 className="font-semibold">{a.addBalance}</h3>
        <Form onSubmit={() => void addBalance()}>
          <TextField label={m.common.name} value={bName} onChange={setBName} maxLength={80} error={bTried && bName.trim() === '' ? m.common.enterName : null} />
          <SelectField label={m.common.kind} value={bKind} onChange={setBKind} options={options<'savings' | 'checking' | 'fixed_deposit' | 'wallet' | 'other'>(a.accountKinds)} />
          <AmountField label={m.common.value} value={bAmount} onChange={setBAmount} error={bTried && bAmount === '' ? m.common.enterAmount : null} />
          <div className="flex items-end">
            <CheckField label={m.common.liquid} checked={bQuick} onChange={setBQuick} />
          </div>
          {saveBalance.failure ? <div className="sm:col-span-2"><FormError>{m.common.saveFailed}</FormError></div> : null}
          <button type="submit" disabled={saveBalance.busy} className={submitClass}>
            {saveBalance.busy ? m.common.adding : m.common.add}
          </button>
        </Form>
      </Panel>
      <QuoteLookup />
    </>
  )
}

// ---- debts ---------------------------------------------------------------------------------

export function DebtsPage() {
  const m = useModulesCopy()
  const t = m.debts
  const loans = useRemote('loans', (signal) => api.liabilities(signal))
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LiabilityCreateRequest['liability_type']>('personal_loan')
  const [balance, setBalance] = useState('')
  const [rate, setRate] = useState('')
  const [payment, setPayment] = useState('')
  const [months, setMonths] = useState('')
  const [tried, setTried] = useState(false)
  const save = useAction()

  const rateBad = rate.trim() !== '' && percentToRate(rate) === null
  const monthsBad = months !== '' && !/^[1-9]\d{0,3}$/.test(months)

  async function add() {
    setTried(true)
    if (name.trim() === '' || balance === '' || payment === '' || rateBad || monthsBad) return
    const ok = await save.run(() =>
      api.createLiability({
        liability_name: name.trim(),
        liability_type: kind,
        principal_amount: balance,
        current_balance: balance,
        interest_rate: percentToRate(rate) ?? '0.000000',
        monthly_emi: payment,
        remaining_months: months === '' ? 0 : Number(months),
      }),
    )
    if (ok) {
      setName('')
      setBalance('')
      setRate('')
      setPayment('')
      setMonths('')
      setTried(false)
      loans.reload()
    }
  }

  return (
    <Panel title={t.title}>
      <Loaded remote={loans}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-muted">{m.common.none}</p>
          ) : (
            <Table
              caption={t.title}
              head={[m.common.name, m.common.kind, t.balance, t.payment, t.months]}
              rows={list.map((l) => [l.liability_name, t.kinds[l.liability_type] ?? l.liability_type, formatMoney(l.current_balance), formatMoney(l.monthly_emi), l.remaining_months ? String(l.remaining_months) : '–'])}
            />
          )
        }
      </Loaded>
      <h3 className="font-semibold">{t.add}</h3>
      <Form onSubmit={() => void add()}>
        <TextField label={m.common.name} value={name} onChange={setName} maxLength={80} error={tried && name.trim() === '' ? m.common.enterName : null} />
        <SelectField label={m.common.kind} value={kind} onChange={setKind} options={options<LiabilityCreateRequest['liability_type']>(t.kinds)} />
        <AmountField label={t.balance} value={balance} onChange={setBalance} error={tried && balance === '' ? m.common.enterAmount : null} />
        <AmountField label={t.payment} value={payment} onChange={setPayment} error={tried && payment === '' ? m.common.enterAmount : null} />
        <TextField label={t.rate} hint={t.rateHint} value={rate} onChange={setRate} error={tried && rateBad ? t.badRate : null} />
        <TextField label={t.months} value={months} onChange={setMonths} error={tried && monthsBad ? t.badMonths : null} />
        {save.failure ? <div className="sm:col-span-2"><FormError>{m.common.saveFailed}</FormError></div> : null}
        <button type="submit" disabled={save.busy} className={submitClass}>
          {save.busy ? m.common.adding : m.common.add}
        </button>
      </Form>
      <Notice>{t.note}</Notice>
    </Panel>
  )
}

// ---- insurance -----------------------------------------------------------------------------

export function InsurancePage() {
  const m = useModulesCopy()
  const t = m.insurance
  const policies = useRemote('policies', (signal) => api.policies(signal))
  const summary = useRemote('cover-summary', (signal) => api.insuranceDashboard(signal))
  const [kind, setKind] = useState<PolicyCreateRequest['policy_type']>('health')
  const [insurer, setInsurer] = useState('')
  const [cover, setCover] = useState('')
  const [premium, setPremium] = useState('')
  const [start, setStart] = useState('')
  const [reference, setReference] = useState('')
  const [tried, setTried] = useState(false)
  const save = useAction()

  async function add() {
    setTried(true)
    if (insurer.trim() === '' || cover === '' || premium === '' || start === '') return
    const code = reference.replace(/[^A-Za-z0-9._/\- ]/g, '-').trim().slice(0, 40) || `POLICY-${Date.now().toString(36).toUpperCase()}`
    const ok = await save.run(() =>
      api.createPolicy({ policy_number: code, policy_type: kind, insurer_name: insurer.trim(), plan_name: insurer.trim(), start_date: start, base_sum_assured: cover, premium_amount: premium, premium_frequency: 'annual', status: 'active' }),
    )
    if (ok) {
      setInsurer('')
      setCover('')
      setPremium('')
      setStart('')
      setReference('')
      setTried(false)
      policies.reload()
      summary.reload()
    }
  }

  return (
    <>
      <Panel title={t.summary}>
        <Loaded remote={summary}>
          {(s) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label={t.summary} value={formatMoney(s.total_effective_cover)} />
              <Stat label={t.base} value={formatMoney(s.total_base_cover)} />
              <Stat label={t.growth} value={formatMoney(s.total_cover_growth)} />
            </div>
          )}
        </Loaded>
      </Panel>
      <Panel title={m.insurance.summary}>
        <Loaded remote={policies}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">{m.common.none}</p>
            ) : (
              <Table
                caption={t.summary}
                head={[t.insurer, m.common.kind, t.cover, t.premium, t.renewal]}
                rows={list.map((p) => [p.insurer_name, t.kinds[p.policy_type] ?? p.policy_type, formatMoney(p.current_effective_sum_assured), formatMoney(p.premium_amount), p.renewal_date ?? t.noRenewal])}
              />
            )
          }
        </Loaded>
        <h3 className="font-semibold">{t.add}</h3>
        <Form onSubmit={() => void add()}>
          <SelectField label={m.common.kind} value={kind} onChange={setKind} options={options<PolicyCreateRequest['policy_type']>(t.kinds)} />
          <TextField label={t.insurer} value={insurer} onChange={setInsurer} maxLength={80} error={tried && insurer.trim() === '' ? m.common.enterName : null} />
          <AmountField label={t.cover} value={cover} onChange={setCover} error={tried && cover === '' ? m.common.enterAmount : null} />
          <AmountField label={t.premium} value={premium} onChange={setPremium} error={tried && premium === '' ? m.common.enterAmount : null} />
          <DateField label={t.start} value={start} onChange={setStart} error={tried && start === '' ? m.common.enterName : null} />
          <TextField label={t.reference} hint={t.referenceHint} value={reference} onChange={setReference} maxLength={40} />
          {save.failure ? <div className="sm:col-span-2"><FormError>{m.common.saveFailed}</FormError></div> : null}
          <button type="submit" disabled={save.busy} className={submitClass}>
            {save.busy ? m.common.adding : m.common.add}
          </button>
        </Form>
        <Notice>{t.note}</Notice>
      </Panel>
      <PolicyDetail policies={policies.data ?? []} />
      <CoverGrowth policies={policies.data ?? []} onChanged={() => summary.reload()} />
    </>
  )
}
