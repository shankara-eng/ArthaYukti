import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { AmountField, CheckField, DateField, MonthField, Repeater, SelectField, TextField } from '../../components/forms'
import type { OnboardingCopy } from '../../i18n/onboarding'
import { FREQUENCIES, type Frequency } from '../../lib/frequency'
import { formatMoney, isNegative } from '../../lib/money'
import { addMonths } from '../../lib/months'
import {
  INCOME_FREQUENCIES,
  LIMITS,
  expenseIssues,
  goalIssues,
  incomeIssues,
  percentToRate,
  preview,
  uid,
  type AccountDraft,
  type Draft,
  type ExpenseDraft,
  type GoalDraft,
  type GoalKind,
  type IncomeDraft,
  type InvestmentDraft,
  type LiabilityDraft,
  type PolicyDraft,
  type RowIssue,
  type Tier,
} from '../../lib/onboarding'

export interface StepProps {
  draft: Draft
  setDraft: (change: (current: Draft) => Draft) => void
  /** True once the person has tried to continue, so errors may be shown. */
  tried: boolean
  c: OnboardingCopy
}

function patch<T extends { id: string }>(list: T[], id: string, change: Partial<T>): T[] {
  return list.map((row) => (row.id === id ? { ...row, ...change } : row))
}

function Section({ title, why, children }: { title: string; why: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[28px] leading-tight font-bold tracking-tight">{title}</h2>
        <p className="text-muted">{why}</p>
      </div>
      {children}
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-sand px-4 py-3 text-[14px]">{children}</p>
}

const problem = (c: OnboardingCopy, issues: RowIssue[], key: RowIssue): string | null =>
  issues.includes(key) ? (key === 'order' ? c.errors.amount : c.errors[key === 'past' ? 'past' : key]) : null

const frequencyOptions = (c: OnboardingCopy) => FREQUENCIES.map((value) => ({ value, label: c.frequency[value] }))
const options = <T extends string>(labels: Record<string, string>): { value: T; label: string }[] =>
  Object.entries(labels).map(([value, label]) => ({ value: value as T, label }))

export function WelcomeStep({ c }: { c: OnboardingCopy }) {
  return (
    <Section title={c.welcome.title} why={c.welcome.body}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {c.welcome.willAsk.map((item, index) => (
          <li key={item} className="flex items-center gap-3 rounded-xl glass px-4 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-semibold text-white">{index + 1}</span>
            {item}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{c.welcome.whyTitle}</h3>
        <p className="text-muted">{c.welcome.whyBody}</p>
      </div>
      <Note>
        <strong>{c.welcome.notYetTitle}. </strong>
        {c.welcome.notYetBody}
      </Note>
    </Section>
  )
}

export function IncomeStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.income
  const add = () =>
    setDraft((d) => ({
      ...d,
      income: [...d.income, { id: uid('inc'), label: '', amount: '', frequency: 'monthly', endYear: '', growthPercent: '', include: true } satisfies IncomeDraft],
    }))
  return (
    <Section title={t.title} why={t.why}>
      <Repeater
        items={draft.income}
        addLabel={t.add}
        empty={t.empty}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={add}
        onRemove={(id) => setDraft((d) => ({ ...d, income: d.income.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          const issues = tried ? incomeIssues(row, draft.asOf) : []
          const set = (change: Partial<IncomeDraft>) => setDraft((d) => ({ ...d, income: patch(d.income, row.id, change) }))
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t.source} placeholder={t.sourcePlaceholder} value={row.label} onChange={(label) => set({ label })} maxLength={80} error={problem(c, issues, 'label')} />
              <AmountField label={t.amount} value={row.amount} onChange={(amount) => set({ amount })} error={problem(c, issues, 'amount')} />
              <SelectField label={t.frequency} value={row.frequency} onChange={(frequency: Frequency) => set({ frequency })} options={INCOME_FREQUENCIES.map((value) => ({ value, label: c.frequency[value] }))} />
              <TextField label={t.ends} hint={t.endsHint} value={row.endYear} onChange={(endYear) => set({ endYear })} maxLength={4} placeholder={draft.asOf.slice(0, 4)} error={issues.includes('past') ? c.errors.endPast : null} />
              <TextField label={t.growth} hint={t.growthHint} value={row.growthPercent} onChange={(growthPercent) => set({ growthPercent })} maxLength={5} error={issues.includes('range') ? c.errors.growth : null} />
              <div className="sm:col-span-2">
                <CheckField label={t.include} checked={row.include} onChange={(include) => set({ include })} />
              </div>
            </div>
          )
        }}
      />
      <TotalLine label={t.total} value={preview(draft).income} />
      <Note>{t.constant}</Note>
      {draft.income.length === 0 ? <Note>{t.none}</Note> : null}
    </Section>
  )
}

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3 rounded-xl bg-brand px-4 py-3 text-white">
      <span>{label}</span>
      <span className="font-figures text-[24px] font-semibold">{formatMoney(value)}</span>
    </p>
  )
}

export function ExpensesStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.expenses
  const totals = preview(draft)
  const deficit = isNegative(totals.surplus)
  const add = (label = '', essential = true) =>
    setDraft((d) => ({
      ...d,
      expenses: [...d.expenses, { id: uid('exp'), label, amount: '', frequency: 'monthly', essential, include: true } satisfies ExpenseDraft],
    }))
  return (
    <Section title={t.title} why={t.why}>
      {draft.expenses.length === 0 ? (
        <button
          type="button"
          onClick={() => t.presets.forEach((preset) => add(preset.label, preset.essential))}
          className="min-h-12 rounded-xl border border-line bg-paper px-4 text-left font-semibold"
        >
          {t.usePresets}
        </button>
      ) : null}
      <Repeater
        items={draft.expenses}
        max={LIMITS.expenses}
        addLabel={t.add}
        empty={t.empty}
        limitNote={t.limit}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() => add()}
        onRemove={(id) => setDraft((d) => ({ ...d, expenses: d.expenses.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          // A category added from the list with no amount yet is simply not counted, so errors wait for the attempt to continue.
          // A category added from the list with no amount yet is simply not counted, so it is only flagged once something is typed.
          const issues = tried && row.amount !== '' ? expenseIssues(row) : []
          const set = (change: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, expenses: patch(d.expenses, row.id, change) }))
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t.name} placeholder={t.namePlaceholder} value={row.label} onChange={(label) => set({ label })} maxLength={80} error={problem(c, issues, 'label')} />
              <AmountField label={t.amount} value={row.amount} onChange={(amount) => set({ amount })} error={problem(c, issues, 'amount')} />
              <SelectField label={t.frequency} value={row.frequency} onChange={(frequency: Frequency) => set({ frequency })} options={frequencyOptions(c)} />
              <div className="flex flex-col justify-end gap-2">
                <CheckField label={`${t.essential}. ${t.essentialHint}`} checked={row.essential} onChange={(essential) => set({ essential })} />
                <CheckField label={t.include} checked={row.include} onChange={(include) => set({ include })} />
              </div>
            </div>
          )
        }}
      />
      <Note>{t.note}</Note>
      <dl className="grid gap-2 rounded-2xl glass p-4 sm:grid-cols-2" aria-live="polite">
        {(
          [
            [t.totals.income, totals.income],
            [t.totals.essential, totals.essential],
            [t.totals.discretionary, totals.discretionary],
            [t.totals.loans, totals.loanPayments],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-[14px] text-muted">{label}</dt>
            <dd className="font-figures text-[20px] font-semibold">{formatMoney(value)}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className={`text-[14px] font-semibold ${deficit ? 'text-late' : 'text-ontime'}`}>{deficit ? t.totals.deficit : t.totals.surplus}</dt>
          <dd className="font-figures text-[26px] font-semibold">{formatMoney(deficit ? totals.surplus.replace('-', '') : totals.surplus)}</dd>
          <p className="text-[13px] text-muted">{t.totals.note}</p>
        </div>
      </dl>
    </Section>
  )
}

export function CashStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.cash
  const totals = preview(draft)
  const monthsOk = /^\d{1,2}$/.test(draft.emergencyMonths) && Number(draft.emergencyMonths) > 0
  const hasBasis = totals.essential !== '0.00' || totals.loanPayments !== '0.00'
  return (
    <Section title={t.title} why={t.why}>
      <Repeater
        items={draft.accounts}
        addLabel={t.add}
        empty={t.empty}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() => setDraft((d) => ({ ...d, accounts: [...d.accounts, { id: uid('acc'), name: '', kind: 'savings', balance: '', liquid: true, reserve: true } satisfies AccountDraft] }))}
        onRemove={(id) => setDraft((d) => ({ ...d, accounts: d.accounts.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          const set = (change: Partial<AccountDraft>) => setDraft((d) => ({ ...d, accounts: patch(d.accounts, row.id, change) }))
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t.accountName} value={row.name} onChange={(name) => set({ name })} maxLength={80} error={tried && row.name.trim() === '' ? c.errors.label : null} />
              <SelectField label={t.kind} value={row.kind} onChange={(kind) => set({ kind })} options={options<AccountDraft['kind']>(t.kinds)} />
              <AmountField label={t.balance} value={row.balance} onChange={(balance) => set({ balance })} error={tried && row.balance === '' ? c.errors.amount : null} />
              <div className="flex flex-col justify-end gap-1">
                <CheckField label={t.liquid} checked={row.liquid} onChange={(liquid) => set({ liquid })} />
                <p className="text-[13px] text-muted">{t.liquidHint}</p>
                <CheckField label={t.reserve} checked={row.reserve} onChange={(reserve) => set({ reserve })} />
                <p className="text-[13px] text-muted">{t.reserveHint}</p>
              </div>
            </div>
          )
        }}
      />
      <div className="flex flex-col gap-3 rounded-2xl glass p-4">
        <h3 className="font-semibold">{t.emergencyTitle}</h3>
        <TextField
          label={t.months}
          hint={t.monthsHint}
          value={draft.emergencyMonths}
          onChange={(emergencyMonths) => setDraft((d) => ({ ...d, emergencyMonths }))}
          error={tried && !monthsOk ? c.errors.amount : null}
        />
        {hasBasis && monthsOk ? (
          <p className="flex items-baseline justify-between gap-3">
            <span>{t.target}</span>
            <span className="font-figures text-[22px] font-semibold">{formatMoney(totals.emergencyTarget)}</span>
          </p>
        ) : (
          <Note>{t.needsExpenses}</Note>
        )}
        <p className="text-[13px] text-muted">{t.targetNote}</p>
      </div>
      <div>
        <h3 className="mb-1 font-semibold">{t.accessTitle}</h3>
        <ul className="list-disc pl-5 text-[14px] text-muted">
          {t.access.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

export function AssetsStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.assets
  return (
    <Section title={t.title} why={t.why}>
      <Repeater
        items={draft.investments}
        addLabel={t.add}
        empty={t.empty}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() =>
          setDraft((d) => ({
            ...d,
            investments: [...d.investments, { id: uid('inv'), name: '', kind: 'mutual_fund', currentValue: '', costBasis: '', valuationDate: '', liquid: true } satisfies InvestmentDraft],
          }))
        }
        onRemove={(id) => setDraft((d) => ({ ...d, investments: d.investments.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          const set = (change: Partial<InvestmentDraft>) => setDraft((d) => ({ ...d, investments: patch(d.investments, row.id, change) }))
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t.name} value={row.name} onChange={(name) => set({ name })} maxLength={80} error={tried && row.name.trim() === '' ? c.errors.label : null} />
              <SelectField label={t.kind} value={row.kind} onChange={(kind) => set({ kind, liquid: kind !== 'real_estate' && kind !== 'epf' && kind !== 'ppf' })} options={options<InvestmentDraft['kind']>(t.kinds)} />
              <AmountField label={t.value} value={row.currentValue} onChange={(currentValue) => set({ currentValue })} error={tried && row.currentValue === '' ? c.errors.amount : null} />
              <div className="flex flex-col justify-end gap-1">
                <CheckField label={t.liquid} checked={row.liquid} onChange={(liquid) => set({ liquid })} />
                <p className="text-[13px] text-muted">{t.liquidHint}</p>
              </div>
              <details className="sm:col-span-2">
                <summary className="min-h-10 cursor-pointer font-semibold">{t.more}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <AmountField label={t.cost} value={row.costBasis} onChange={(costBasis) => set({ costBasis })} />
                  <DateField label={t.date} value={row.valuationDate} onChange={(valuationDate) => set({ valuationDate })} />
                </div>
              </details>
            </div>
          )
        }}
      />
      <Note>{t.returnsNote}</Note>
      <Note>{t.saleNote}</Note>
    </Section>
  )
}

export function DebtsStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.debts
  const total = preview(draft).loanPayments
  return (
    <Section title={t.title} why={t.why}>
      <Repeater
        items={draft.liabilities}
        max={LIMITS.commitments}
        addLabel={t.add}
        empty={t.empty}
        limitNote={c.errors.limits}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() =>
          setDraft((d) => ({
            ...d,
            liabilities: [...d.liabilities, { id: uid('debt'), name: '', kind: 'personal_loan', balance: '', ratePercent: '', payment: '', remainingMonths: '' } satisfies LiabilityDraft],
          }))
        }
        onRemove={(id) => setDraft((d) => ({ ...d, liabilities: d.liabilities.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          const set = (change: Partial<LiabilityDraft>) => setDraft((d) => ({ ...d, liabilities: patch(d.liabilities, row.id, change) }))
          const rateBad = row.ratePercent.trim() !== '' && percentToRate(row.ratePercent) === null
          const monthsBad = row.remainingMonths !== '' && !/^[1-9]\d{0,3}$/.test(row.remainingMonths)
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t.name} value={row.name} onChange={(name) => set({ name })} maxLength={80} error={tried && row.name.trim() === '' ? c.errors.label : null} />
              <SelectField label={t.kind} value={row.kind} onChange={(kind) => set({ kind })} options={options<LiabilityDraft['kind']>(t.kinds)} />
              <AmountField label={t.balance} value={row.balance} onChange={(balance) => set({ balance })} error={tried && row.balance === '' ? c.errors.amount : null} />
              <AmountField label={t.payment} value={row.payment} onChange={(payment) => set({ payment })} error={tried && row.payment === '' ? c.errors.amount : null} />
              <TextField label={t.rate} hint={t.rateHint} value={row.ratePercent} onChange={(ratePercent) => set({ ratePercent })} error={tried && rateBad ? c.errors.badInflation : null} />
              <TextField label={t.months} hint={t.monthsHint} value={row.remainingMonths} onChange={(remainingMonths) => set({ remainingMonths })} error={tried && monthsBad ? c.errors.amount : null} />
              {row.payment !== '' && row.remainingMonths === '' ? <div className="sm:col-span-2"><Note>{t.unknownNote}</Note></div> : null}
            </div>
          )
        }}
      />
      <TotalLine label={t.total} value={total} />
    </Section>
  )
}

export function GoalsStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.goals
  const sorted = [...draft.goals].sort((a, b) => a.tier - b.tier)
  const inflationBad = percentToRate(draft.inflationPercent) === null
  const totals = preview(draft)
  const addGoal = (seed: Partial<GoalDraft> = {}) =>
    setDraft((d) => ({
      ...d,
      goals: [
        ...d.goals,
        { id: uid('goal'), kind: 'other', label: '', amount: '', date: addMonths(d.asOf, 24), basis: 'today', tier: 3, saved: '', ...seed } satisfies GoalDraft,
      ],
    }))

  function move(id: string, direction: -1 | 1) {
    setDraft((d) => {
      const order = [...d.goals].sort((a, b) => a.tier - b.tier)
      const at = order.findIndex((row) => row.id === id)
      const neighbour = order[at + direction]
      if (!neighbour || neighbour.tier !== order[at].tier) return d
      const goals = [...d.goals]
      const first = goals.findIndex((row) => row.id === id)
      const second = goals.findIndex((row) => row.id === neighbour.id)
      ;[goals[first], goals[second]] = [goals[second], goals[first]]
      return { ...d, goals }
    })
  }

  return (
    <Section title={t.title} why={t.why}>
      <TextField
        label={t.inflation}
        hint={t.inflationHint}
        value={draft.inflationPercent}
        onChange={(inflationPercent) => setDraft((d) => ({ ...d, inflationPercent }))}
        error={tried && inflationBad ? c.errors.badInflation : null}
      />
      {!draft.goals.some((goal) => goal.kind === 'emergency_fund') && totals.emergencyTarget !== '0.00' ? (
        <button
          type="button"
          onClick={() => addGoal({ kind: 'emergency_fund', label: t.kinds.emergency_fund, amount: totals.emergencyTarget, tier: 1, date: addMonths(draft.asOf, 24) })}
          className="min-h-12 rounded-xl border border-line bg-paper px-4 text-left font-semibold"
        >
          {t.useEmergency}: {formatMoney(totals.emergencyTarget)}
        </button>
      ) : null}
      <p className="text-[14px] text-muted">{t.tierHint}</p>
      <Repeater
        items={sorted}
        max={LIMITS.goals}
        addLabel={t.add}
        empty={t.empty}
        limitNote={t.limit}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() => addGoal()}
        onRemove={(id) => setDraft((d) => ({ ...d, goals: d.goals.filter((row) => row.id !== id) }))}
        renderItem={(row, index) => {
          const issues = tried ? goalIssues(row, draft.asOf) : []
          const set = (change: Partial<GoalDraft>) => setDraft((d) => ({ ...d, goals: patch(d.goals, row.id, change) }))
          const sameTier = sorted.filter((other) => other.tier === row.tier)
          const place = sameTier.findIndex((other) => other.id === row.id)
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2 sm:col-span-2">
                <p className="font-semibold">
                  {index + 1}. {t.tiers[row.tier]}
                </p>
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(row.id, -1)} disabled={place === 0} aria-label={t.up} className="flex size-10 items-center justify-center rounded-lg border border-line disabled:opacity-40">
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(row.id, 1)} disabled={place === sameTier.length - 1} aria-label={t.down} className="flex size-10 items-center justify-center rounded-lg border border-line disabled:opacity-40">
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                </span>
              </div>
              <SelectField label={t.kind} value={row.kind} onChange={(kind: GoalKind) => set({ kind, label: row.label.trim() === '' ? t.kinds[kind] : row.label })} options={options<GoalKind>(t.kinds)} />
              <TextField label={t.name} value={row.label} onChange={(label) => set({ label })} maxLength={80} error={problem(c, issues, 'label')} />
              <AmountField label={t.amount} value={row.amount} onChange={(amount) => set({ amount })} error={problem(c, issues, 'amount')} />
              <MonthField label={t.date} value={row.date} onChange={(date) => set({ date })} error={problem(c, issues, 'date') ?? problem(c, issues, 'past') ?? problem(c, issues, 'range')} />
              <SelectField
                label={t.basis}
                hint={t.basisHint}
                value={row.basis}
                onChange={(basis: 'today' | 'future') => set({ basis })}
                options={[
                  { value: 'today', label: t.today },
                  { value: 'future', label: t.future },
                ]}
              />
              <SelectField
                label={t.tier}
                value={String(row.tier) as '1' | '2' | '3' | '4' | '5'}
                onChange={(tier) => set({ tier: Number(tier) as Tier })}
                options={([1, 2, 3, 4, 5] as const).map((tier) => ({ value: String(tier) as '1' | '2' | '3' | '4' | '5', label: t.tiers[tier] }))}
              />
              <AmountField label={t.saved} value={row.saved} onChange={(saved) => set({ saved })} />
            </div>
          )
        }}
      />
      <Note>{t.engineNote}</Note>
    </Section>
  )
}

export function InsuranceStep({ draft, setDraft, tried, c }: StepProps) {
  const t = c.insurance
  return (
    <Section title={t.title} why={t.why}>
      <Repeater
        items={draft.policies}
        addLabel={t.add}
        empty={t.empty}
        removeLabel={(index) => c.addRemove.remove(`${t.removeItem} ${index + 1}`)}
        confirmRemove={c.addRemove.confirm}
        confirmYes={c.addRemove.yes}
        confirmNo={c.addRemove.no}
        onAdd={() =>
          setDraft((d) => ({
            ...d,
            policies: [...d.policies, { id: uid('pol'), kind: 'health', insurer: '', label: '', reference: '', cover: '', premium: '', startDate: '', countPremium: false } satisfies PolicyDraft],
          }))
        }
        onRemove={(id) => setDraft((d) => ({ ...d, policies: d.policies.filter((row) => row.id !== id) }))}
        renderItem={(row) => {
          const set = (change: Partial<PolicyDraft>) => setDraft((d) => ({ ...d, policies: patch(d.policies, row.id, change) }))
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label={t.kind} value={row.kind} onChange={(kind) => set({ kind })} options={options<PolicyDraft['kind']>(t.kinds)} />
              <TextField label={t.insurer} value={row.insurer} onChange={(insurer) => set({ insurer })} maxLength={80} error={tried && row.insurer.trim() === '' ? c.errors.label : null} />
              <AmountField label={t.cover} value={row.cover} onChange={(cover) => set({ cover })} error={tried && row.cover === '' ? c.errors.amount : null} />
              <AmountField label={t.premium} value={row.premium} onChange={(premium) => set({ premium })} error={tried && row.premium === '' ? c.errors.amount : null} />
              <DateField label={t.start} value={row.startDate} onChange={(startDate) => set({ startDate })} error={tried && row.startDate === '' ? c.errors.date : null} />
              <div className="flex flex-col justify-end gap-1">
                <CheckField label={t.count} checked={row.countPremium} onChange={(countPremium) => set({ countPremium })} />
                <p className="text-[13px] text-muted">{t.countHint}</p>
              </div>
              <details className="sm:col-span-2">
                <summary className="min-h-10 cursor-pointer font-semibold">{t.more}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextField label={t.label} value={row.label} onChange={(label) => set({ label })} maxLength={80} />
                  <TextField label={t.reference} hint={t.referenceHint} value={row.reference} onChange={(reference) => set({ reference })} maxLength={40} />
                </div>
              </details>
            </div>
          )
        }}
      />
    </Section>
  )
}
