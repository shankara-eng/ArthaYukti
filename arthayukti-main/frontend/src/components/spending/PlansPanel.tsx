import { useState } from 'react'
import { api } from '../../api/client'
import type { SpendingCategory, SpendingPlan } from '../../api/types'
import { formatMoney } from '../../lib/money'
import {
  blankChange,
  blankDraft,
  changeToInput,
  draftFromPlan,
  draftToInput,
  durationText,
  monthOptions,
  periodText,
  ratePercentText,
  yearOptions,
  type ChangeDraft,
  type Duration,
  type Frequency,
  type PlanDraft,
} from '../../lib/spending'
import { useAction } from '../../state/useAction'
import { AmountField, CheckField, FormError, SelectField, TextField } from '../forms'
import { Notice, Panel } from '../panel'
import { failureText } from './failure'

const money = (amount: string) => formatMoney(amount, { paise: true })

export function PlansPanel({ plans, categories, onChanged }: { plans: SpendingPlan[]; categories: SpendingCategory[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(plans.length === 0 ? 'new' : null)
  const done = () => {
    setEditing(null)
    onChanged()
  }
  return (
    <Panel
      id="spending-plans"
      title="Your spending plans"
      aside={
        editing === null ? (
          <button type="button" onClick={() => setEditing('new')} className="min-h-10 rounded-xl border border-ink px-4 font-semibold">
            Add an expenditure
          </button>
        ) : null
      }
    >
      {editing === 'new' ? <PlanForm categories={categories} onDone={done} onCancel={plans.length ? () => setEditing(null) : undefined} /> : null}
      <ul className="flex flex-col gap-3">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-2xl bg-sand/40 p-4">
            {editing === plan.id ? (
              <PlanForm plan={plan} categories={categories} onDone={done} onCancel={() => setEditing(null)} />
            ) : (
              <PlanRow plan={plan} onEdit={() => setEditing(plan.id)} onChanged={onChanged} />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function PlanRow({ plan, onEdit, onChanged }: { plan: SpendingPlan; onEdit: () => void; onChanged: () => void }) {
  const action = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showChanges, setShowChanges] = useState(false)
  const stopped = plan.status === 'stopped'
  const run = (job: () => Promise<unknown>) =>
    void action.run(async () => {
      await job()
      onChanged()
    })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <strong>{plan.name || plan.category_name}</strong>
          <span className="ml-2 text-[13px] text-muted">{plan.category_name}{plan.category_hidden ? ' (hidden)' : ''}{plan.category_archived ? ' (archived)' : ''}</span>
          {stopped ? <span className="ml-2 rounded-full bg-blush px-2 py-0.5 text-[12px]">Stopped</span> : null}
        </div>
        <span className="font-figures">
          {money(plan.amount)} {plan.frequency === 'yearly' ? 'a year' : 'a month'}
        </span>
      </div>
      <p className="text-[14px] text-muted">
        {durationText(plan)} · {plan.frequency === 'yearly' ? `${money(plan.monthly_equivalent)} a month equivalent · ` : ''}
        inflation {ratePercentText(plan.inflation_now)} {plan.inflation_override === null ? '(global)' : '(its own)'}
      </p>
      <div className="flex flex-wrap gap-4 text-[14px]">
        {stopped ? (
          <button type="button" className="underline" disabled={action.busy} onClick={() => run(() => api.spendingReactivatePlan(plan.id))}>
            Reactivate
          </button>
        ) : (
          <>
            <button type="button" className="underline" onClick={onEdit}>Edit</button>
            <button type="button" className="underline" onClick={() => setShowChanges((open) => !open)} aria-expanded={showChanges}>
              Scheduled changes ({plan.changes.length})
            </button>
            <button type="button" className="underline" disabled={action.busy} onClick={() => run(() => api.spendingStopPlan(plan.id))}>
              Stop
            </button>
          </>
        )}
        {confirmDelete ? (
          <span className="flex gap-3">
            <button type="button" className="font-semibold text-late underline" disabled={action.busy} onClick={() => run(() => api.spendingDeletePlan(plan.id))}>
              Confirm delete
            </button>
            <button type="button" className="underline" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </span>
        ) : (
          <button type="button" className="text-late underline" onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>
      {showChanges ? <ChangesEditor plan={plan} onChanged={onChanged} /> : null}
      {action.failure ? <FormError>{failureText(action.failure)}</FormError> : null}
    </div>
  )
}

function PeriodPick({ label, frequency, year, month, onYear, onMonth }: { label: string; frequency: Frequency; year: string; month: string; onYear: (v: string) => void; onMonth: (v: string) => void }) {
  const [from] = useState(() => new Date().getFullYear())
  return (
    <div className={`grid gap-3 ${frequency === 'monthly' ? 'grid-cols-2' : 'grid-cols-1'}`}>
      <SelectField label={`${label} year`} value={year} onChange={onYear} options={yearOptions(from)} />
      {frequency === 'monthly' ? <SelectField label={`${label} month`} value={month} onChange={onMonth} options={monthOptions()} /> : null}
    </div>
  )
}

function PlanForm({ plan, categories, onDone, onCancel }: { plan?: SpendingPlan; categories: SpendingCategory[]; onDone: () => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState<PlanDraft>(plan ? draftFromPlan(plan) : blankDraft())
  const [shown, setShown] = useState(false)
  const action = useAction()
  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const usable = categories.filter((c) => (!c.hidden && !c.archived) || c.id === plan?.category)
  const result = draftToInput(draft)
  const problems = 'problems' in result ? result.problems : []

  const save = () => {
    setShown(true)
    if (!('body' in result)) return
    void action.run(async () => {
      await (plan ? api.spendingUpdatePlan(plan.id, result.body) : api.spendingCreatePlan(result.body))
      onDone()
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save() }}>
      <h3 className="font-semibold">{plan ? 'Edit this expenditure' : 'Add an expenditure'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Category"
          value={draft.category}
          onChange={(value) => set('category', value)}
          options={[{ value: '', label: 'Choose a category' }, ...usable.map((c) => ({ value: c.id, label: c.name }))]}
          error={shown && problems.includes('category') ? 'Choose a category.' : null}
        />
        <TextField label="Name (optional)" value={draft.name} onChange={(value) => set('name', value)} maxLength={80} />
        <AmountField label={draft.frequency === 'yearly' ? 'Amount per year' : 'Amount per month'} value={draft.amount} onChange={(value) => set('amount', value)} error={shown && problems.includes('amount') ? 'Enter an amount above zero.' : null} />
        <SelectField<Frequency> label="How often" value={draft.frequency} onChange={(value) => set('frequency', value)} options={[{ value: 'monthly', label: 'Every month' }, { value: 'yearly', label: 'Once a year (spread over 12 months)' }]} />
      </div>
      <SelectField<Duration>
        label="For how long"
        value={draft.duration}
        onChange={(value) => set('duration', value)}
        options={[
          { value: 'today_forever', label: 'From today, with no end' },
          { value: 'year_forever', label: 'From a year, with no end' },
          { value: 'range', label: 'Between two dates' },
        ]}
      />
      {draft.duration === 'year_forever' ? <PeriodPick label="Start" frequency="yearly" year={draft.startYear} month="" onYear={(v) => set('startYear', v)} onMonth={() => undefined} /> : null}
      {draft.duration === 'range' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <PeriodPick label="Start" frequency={draft.frequency} year={draft.startYear} month={draft.startMonth} onYear={(v) => set('startYear', v)} onMonth={(v) => set('startMonth', v)} />
          <PeriodPick label="End" frequency={draft.frequency} year={draft.endYear} month={draft.endMonth} onYear={(v) => set('endYear', v)} onMonth={(v) => set('endMonth', v)} />
          <p className="text-[13px] text-muted sm:col-span-2">The end is included: a plan ending in August runs through August, and one ending in 2030 runs through December 2030.</p>
        </div>
      ) : null}
      <CheckField label="Use its own inflation rate instead of the global one" checked={draft.customRate} onChange={(value) => set('customRate', value)} />
      {draft.customRate ? (
        <div className="max-w-48">
          <TextField label="Annual inflation (%)" value={draft.rate} onChange={(value) => set('rate', value)} inputMode="decimal" error={shown && problems.includes('rate') ? 'Enter 0 to 30, up to four decimals.' : null} />
        </div>
      ) : null}
      {action.failure ? <FormError>{failureText(action.failure)}</FormError> : null}
      <div className="flex gap-3">
        <button type="submit" disabled={action.busy} className="min-h-11 rounded-xl bg-ink px-5 font-semibold text-white disabled:opacity-50">
          {action.busy ? 'Saving…' : plan ? 'Save changes' : 'Add expenditure'}
        </button>
        {onCancel ? <button type="button" onClick={onCancel} className="min-h-11 px-3 underline">Cancel</button> : null}
      </div>
    </form>
  )
}

function ChangesEditor({ plan, onChanged }: { plan: SpendingPlan; onChanged: () => void }) {
  const [draft, setDraft] = useState<ChangeDraft>(blankChange())
  const action = useAction()
  const body = changeToInput(draft, plan.frequency)
  const set = <K extends keyof ChangeDraft>(key: K, value: ChangeDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const run = (job: () => Promise<unknown>) => void action.run(async () => { await job(); onChanged() })
  const monthly = plan.frequency === 'monthly'
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface/60 p-3">
      <Notice>A permanent change sets a new base amount from its month; inflation then starts again from that base. A temporary override sets an exact amount for a period and leaves the plan's own trajectory untouched. Amounts are in this plan's own terms ({monthly ? 'per month' : 'per year'}).</Notice>
      {plan.changes.length > 0 ? (
        <ul className="text-[14px]">
          {plan.changes.map((change) => (
            <li key={change.id} className="flex items-center justify-between gap-3 py-1">
              <span>
                {change.kind === 'permanent' ? 'New base' : 'Exactly'} {money(change.amount)} · {periodText(change.effective_year, change.effective_month)}
                {change.kind === 'temporary' && change.end_year ? ` to ${periodText(change.end_year, change.end_month)}` : ' onward'}
              </span>
              <button type="button" className="text-late underline" onClick={() => run(() => api.spendingRemoveChange(plan.id, change.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField<ChangeDraft['kind']> label="Kind" value={draft.kind} onChange={(v) => set('kind', v)} options={[{ value: 'permanent', label: 'Permanent new amount' }, { value: 'temporary', label: 'Temporary exact amount' }]} />
        <AmountField label="Amount" value={draft.amount} onChange={(v) => set('amount', v)} />
        <PeriodPick label="From" frequency={plan.frequency} year={draft.year} month={draft.month} onYear={(v) => set('year', v)} onMonth={(v) => set('month', v)} />
        {draft.kind === 'temporary' ? <PeriodPick label="Until" frequency={plan.frequency} year={draft.endYear} month={draft.endMonth} onYear={(v) => set('endYear', v)} onMonth={(v) => set('endMonth', v)} /> : null}
      </div>
      {action.failure ? <FormError>{failureText(action.failure)}</FormError> : null}
      <button type="button" disabled={body === null || action.busy} onClick={() => body && run(() => api.spendingAddChange(plan.id, body))} className="min-h-11 self-start rounded-xl border border-ink px-4 font-semibold disabled:opacity-50">
        Add change
      </button>
    </div>
  )
}
