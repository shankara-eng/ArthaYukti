import { Plus, Trash2 } from 'lucide-react'
import { blankItem, isAdjustable, newId, type Disruption, type ItemDraft, type ItemKind, type PlanBDraft, type ProblemKey, type Problems } from '../../lib/planb'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { CheckField, SelectField, TextField } from '../forms'

interface StepProps {
  draft: PlanBDraft
  set: (next: PlanBDraft) => void
  problems: Problems
  show: boolean
}

const KINDS: ItemKind[] = ['essential', 'mandatory_debt', 'protected_obligation', 'flexible', 'goal_contribution']

function useError(problems: Problems, show: boolean) {
  const words = usePlanBCopy().problems
  return (field: string) => {
    const key: ProblemKey | undefined = show ? problems[field] : undefined
    return key ? words[key] : null
  }
}

export function StepChange({ draft, set }: StepProps) {
  const t = usePlanBCopy().s1
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-display text-[20px] font-bold">{t.title}</legend>
      {(['income_reduction', 'income_loss', 'new_expense'] as Disruption[]).map((kind) => (
        <label key={kind} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border p-4 ${draft.disruption === kind ? 'border-brand bg-brand/10' : 'border-line'}`}>
          <input type="radio" name="disruption" checked={draft.disruption === kind} onChange={() => set({ ...draft, disruption: kind })} className="size-5 accent-[var(--color-brand)]" />
          <span className="font-semibold">{t[kind]}</span>
        </label>
      ))}
      <p className="text-[14px] text-muted">{t.hint}</p>
    </fieldset>
  )
}

export function StepDescribe({ draft, set, problems, show }: StepProps) {
  const t = usePlanBCopy().s2
  const err = useError(problems, show)
  const up = <K extends keyof PlanBDraft>(key: K, value: PlanBDraft[K]) => set({ ...draft, [key]: value })
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-display text-[20px] font-bold">{t.title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t.start} type="month" value={draft.startMonth} onChange={(v) => up('startMonth', v)} error={err('startMonth')} />
        <TextField label={t.months} value={draft.months} onChange={(v) => up('months', v)} inputMode="numeric" hint={t.monthsHint} error={err('months')} />
        <TextField label={t.cash} value={draft.liquidCash} onChange={(v) => up('liquidCash', v)} inputMode="numeric" hint={t.cashHint} error={err('liquidCash')} />
        <TextField label={t.floor} value={draft.floor} onChange={(v) => up('floor', v)} inputMode="numeric" hint={t.floorHint} error={err('floor')} />
        <TextField label={t.before} value={draft.incomeBefore} onChange={(v) => up('incomeBefore', v)} inputMode="numeric" error={err('incomeBefore')} />
        {draft.disruption === 'income_reduction' ? (
          <TextField label={t.reduced} value={draft.reducedIncome} onChange={(v) => up('reducedIncome', v)} inputMode="numeric" error={err('reducedIncome')} />
        ) : null}
        {draft.disruption === 'new_expense' ? <TextField label={t.newCost} value={draft.newCost} onChange={(v) => up('newCost', v)} inputMode="numeric" error={err('newCost')} /> : null}
        <TextField label={t.begins} type="month" value={draft.disruptionStart} onChange={(v) => up('disruptionStart', v)} error={err('disruptionStart')} />
      </div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {[true, false].map((known) => (
          <label key={String(known)} className="flex min-h-10 items-center gap-3 text-[15px]">
            <input type="radio" name="duration-known" checked={draft.durationKnown === known} onChange={() => up('durationKnown', known)} className="size-5 accent-[var(--color-brand)]" />
            {known ? t.known : t.unknown}
          </label>
        ))}
      </div>
      {draft.durationKnown ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t.duration} value={draft.durationMonths} onChange={(v) => up('durationMonths', v)} inputMode="numeric" error={err('durationMonths')} />
          <TextField label={t.after} value={draft.incomeAfter} onChange={(v) => up('incomeAfter', v)} inputMode="numeric" hint={t.afterHint} error={err('incomeAfter')} />
        </div>
      ) : (
        <p role="note" className="rounded-xl bg-sand px-4 py-3 text-[14px]">
          {t.unknownNote}
        </p>
      )}
    </div>
  )
}

export function StepProtect({ draft, set, problems, show }: StepProps) {
  const t = usePlanBCopy().s3
  const err = useError(problems, show)
  const patch = (id: string, change: Partial<ItemDraft>) => set({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...change } : i)) })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-[20px] font-bold">{t.title}</h3>
        <p className="text-muted">{t.body}</p>
        <p className="mt-1 text-[14px] text-muted">{t.mandatoryNote}</p>
      </div>
      {err('items') ? <p className="text-[14px] font-semibold text-late">{err('items')}</p> : null}
      {draft.items.map((item) => (
        <div key={item.id} className={`flex flex-col gap-3 rounded-2xl border p-4 ${item.kind === 'flexible' || (item.kind === 'goal_contribution' && !item.protectedGoal) ? 'border-line' : 'border-brand/50 bg-brand/5'}`}>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <TextField label={t.label} value={item.label} onChange={(v) => patch(item.id, { label: v })} error={err(`${item.id}.label`)} maxLength={80} />
            <SelectField label={t.kind} value={item.kind} onChange={(v) => patch(item.id, { kind: v })} options={KINDS.map((k) => ({ value: k, label: t.kinds[k] }))} />
            <TextField label={t.amount} value={item.monthly} onChange={(v) => patch(item.id, { monthly: v })} inputMode="numeric" error={err(`${item.id}.monthly`)} />
            <button type="button" onClick={() => set({ ...draft, items: draft.items.filter((i) => i.id !== item.id) })} aria-label={`${t.remove}: ${item.label || t.label}`} className="mt-8 flex size-10 items-center justify-center rounded-xl border border-line">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
          {item.kind === 'goal_contribution' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <CheckField label={t.protectedGoal} checked={item.protectedGoal} onChange={(v) => patch(item.id, { protectedGoal: v })} />
              <SelectField label={t.goesTo} value={item.balanceId || 'none'} onChange={(v) => patch(item.id, { balanceId: v === 'none' ? '' : v })} options={[{ value: 'none', label: t.none }, ...draft.balances.map((b) => ({ value: b.id, label: b.label || t.balanceLabel }))]} />
            </div>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => set({ ...draft, items: [...draft.items, blankItem('essential')] })} className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-line px-4 font-semibold">
        <Plus size={16} aria-hidden="true" />
        {t.add}
      </button>

      <h4 className="font-semibold">{t.balances}</h4>
      {draft.balances.map((b) => (
        <div key={b.id} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
          <TextField label={t.balanceLabel} value={b.label} onChange={(v) => set({ ...draft, balances: draft.balances.map((x) => (x.id === b.id ? { ...x, label: v } : x)) })} error={err(`${b.id}.label`)} />
          <TextField label={t.balanceAmount} value={b.balance} onChange={(v) => set({ ...draft, balances: draft.balances.map((x) => (x.id === b.id ? { ...x, balance: v } : x)) })} inputMode="numeric" error={err(`${b.id}.balance`)} />
          <button type="button" onClick={() => set({ ...draft, balances: draft.balances.filter((x) => x.id !== b.id), items: draft.items.map((i) => (i.balanceId === b.id ? { ...i, balanceId: '' } : i)) })} aria-label={`${t.remove}: ${b.label || t.balanceLabel}`} className="mt-8 flex size-10 items-center justify-center rounded-xl border border-line">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ ...draft, balances: [...draft.balances, { id: newId('bal'), label: '', balance: '' }] })} className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-line px-4 font-semibold">
        <Plus size={16} aria-hidden="true" />
        {t.addBalance}
      </button>
    </div>
  )
}

export function StepAllow({ draft, set, problems, show }: StepProps) {
  const t = usePlanBCopy().s4
  const err = useError(problems, show)
  const patch = (id: string, change: Partial<ItemDraft>) => set({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...change } : i)) })
  const adjustable = draft.items.filter(isAdjustable)
  const r = draft.restore
  const setRestore = (change: Partial<typeof r>) => set({ ...draft, restore: { ...r, ...change } })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-[20px] font-bold">{t.title}</h3>
        <p className="text-muted">{t.body}</p>
      </div>
      {adjustable.length === 0 ? <p className="rounded-xl bg-sand px-4 py-3">{t.nothing}</p> : null}
      {adjustable.map((item) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <p className="font-semibold">{item.label || '—'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckField label={t.canPause} checked={item.allowPause} onChange={(v) => patch(item.id, { allowPause: v })} />
            {item.allowPause ? <TextField label={t.maxPause} value={item.maxPause} onChange={(v) => patch(item.id, { maxPause: v })} inputMode="numeric" error={err(`${item.id}.maxPause`)} /> : <span />}
            <CheckField label={t.canReduce} checked={item.allowReduce} onChange={(v) => patch(item.id, { allowReduce: v })} />
            {item.allowReduce ? <TextField label={t.minAmount} value={item.minMonthly} onChange={(v) => patch(item.id, { minMonthly: v })} inputMode="numeric" error={err(`${item.id}.minMonthly`)} /> : <span />}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <h4 className="font-semibold">{t.restore}</h4>
        <p className="text-[14px] text-muted">{t.restoreBody}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t.incomeAtLeast} value={r.incomeAtLeast} onChange={(v) => setRestore({ incomeAtLeast: v })} inputMode="numeric" error={err('restore.incomeAtLeast')} />
          <TextField label={t.cashAtLeast} value={r.cashAtLeast} onChange={(v) => setRestore({ cashAtLeast: v })} inputMode="numeric" error={err('restore.cashAtLeast')} />
        </div>
        <CheckField label={t.confirm} checked={r.confirm} onChange={(v) => setRestore({ confirm: v })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label={t.restoreMode} value={r.mode} onChange={(v) => setRestore({ mode: v })} options={[{ value: 'all', label: t.allAtOnce }, { value: 'steps', label: t.inSteps }]} />
          {r.mode === 'steps' ? <TextField label={t.stepPercents} value={r.stepPercents} onChange={(v) => setRestore({ stepPercents: v })} error={err('restore.stepPercents')} /> : <span />}
          {r.mode === 'steps' ? <TextField label={t.gap} value={r.gap} onChange={(v) => setRestore({ gap: v })} inputMode="numeric" /> : <span />}
        </div>
        <CheckField label={t.guard} checked={r.guard} onChange={(v) => setRestore({ guard: v })} />
        <TextField label={t.review} type="month" value={draft.reviewMonth} onChange={(v) => set({ ...draft, reviewMonth: v })} hint={t.reviewHint} error={err('reviewMonth')} />
      </div>

      <details className="rounded-2xl border border-line p-4">
        <summary className="cursor-pointer font-semibold">{t.limits}</summary>
        <div className="mt-3 max-w-xs">
          <TextField label={t.maxCandidates} value={draft.maxCandidates} onChange={(v) => set({ ...draft, maxCandidates: v })} inputMode="numeric" error={err('maxCandidates')} />
        </div>
      </details>
    </div>
  )
}
