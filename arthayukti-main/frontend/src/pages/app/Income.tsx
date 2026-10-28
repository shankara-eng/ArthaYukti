import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { IncomeStream } from '../../api/types'
import { AmountField, FormError, SelectField, TextField } from '../../components/forms'
import { Notice, Panel } from '../../components/panel'
import {
  blankDraft,
  draftIssues,
  draftToStream,
  hasIssues,
  isPlaceholder,
  legacyToDraft,
  streamToDraft,
  type Issue,
  type IncomeDraft,
  type IncomeFrequency,
} from '../../lib/incomeForm'
import { monthlyEquivalent, type Frequency } from '../../lib/frequency'
import { formatMoney, fromPaise, toPaise } from '../../lib/money'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { useStore } from '../../state/useStore'

let counter = 0
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter += 1)}`

interface Editing {
  draft: IncomeDraft
  isNew: boolean
}

/**
 * Your Incomes: the confirmed incomes, and one form to add or change one. What is typed in the form stays in the form:
 * the plan (and the saved copy) changes only when the person confirms.
 */
export function IncomeSection() {
  const t = useExtrasCopy().income
  const { plan, accountState, savePlan, setIncomeStreams } = useStore()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false) // set at once, so a second click before the first finishes does nothing
  const firstYear = Number(plan?.as_of.slice(0, 4) ?? 0)

  const issues = useMemo(() => (editing ? draftIssues(editing.draft, firstYear) : null), [editing, firstYear])

  if (!plan) return null
  const streams = plan.income_streams
  const real = streams.filter((stream) => !isPlaceholder(stream))

  /** Saves the new list (for a signed-in person) and only then shows it in the plan. A failure changes nothing. */
  async function commit(next: IncomeStream[]): Promise<boolean> {
    if (busy.current || !plan) return false
    busy.current = true
    setSaving(true)
    setFailed(false)
    try {
      if (accountState === 'ready' && !(await savePlan({ ...plan, income_streams: next }))) {
        setFailed(true)
        return false
      }
      setIncomeStreams(next)
      return true
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const open = (draft: IncomeDraft, isNew: boolean) => {
    setEditing({ draft, isNew })
    setAttempted(false)
    setFailed(false)
    setAsking(null)
  }
  const close = () => {
    setEditing(null)
    setAttempted(false)
    setFailed(false)
  }
  const change = (patch: Partial<IncomeDraft>) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current))

  async function confirm() {
    if (!editing || !issues) return
    setAttempted(true)
    if (hasIssues(issues)) return
    const stream = draftToStream(editing.draft)
    const next = editing.isNew
      ? [...streams.filter((existing) => !isPlaceholder(existing)), stream]
      : streams.map((existing) => (existing.id === stream.id ? stream : existing))
    if (await commit(next)) close()
  }

  async function remove(id: string) {
    setAsking(null)
    await commit(streams.filter((stream) => stream.id !== id))
  }

  const err = (issue: Issue): string | null => (attempted && issues?.fields.includes(issue) ? t.issues[issue] : null)
  const stepErr = (id: string, ...which: Issue[]): string | null => {
    const found = attempted ? which.find((issue) => issues?.steps[id]?.includes(issue)) : undefined
    return found ? t.issues[found] : null
  }
  const draft = editing?.draft
  const monthly = draft && draft.amount !== '' && toPaise(draft.amount) > 0n ? monthlyEquivalent(fromPaise(toPaise(draft.amount)), draft.frequency as Frequency) : null
  const planGrowth = plan.assumptions.income_growth_annual

  return (
    <Panel id="income" title={t.title}>
      <p className="text-muted">{t.lead}</p>

      {real.length === 0 ? <p className="text-muted">{t.noIncomes}</p> : null}
      <ul className="flex flex-col gap-3">
        {real.map((stream) => (
          <li key={stream.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 font-semibold break-words">{stream.label}</span>
              <span className="font-figures">{t.entered(formatMoney(stream.amount ?? stream.monthly_net), stream.start_year == null ? 'monthly' : stream.frequency)}</span>
            </div>
            <p className="text-[13px] text-muted">{summary(stream, t, planGrowth)}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {asking === stream.id ? (
                <>
                  <span role="alert" className="mr-auto text-[14px] font-semibold">
                    {t.confirmRemove}
                  </span>
                  <button type="button" disabled={saving} onClick={() => void remove(stream.id)} className="min-h-10 rounded-lg bg-late px-3 font-semibold text-white disabled:opacity-60">
                    {t.yes}
                  </button>
                  <button type="button" onClick={() => setAsking(null)} className="min-h-10 rounded-lg border border-line px-3 font-semibold">
                    {t.keep}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={`${t.edit} ${stream.label}`}
                    disabled={stream.start_year == null && stream.ends_after != null && !stream.ends_after.endsWith('-12')}
                    onClick={() => open(stream.start_year == null ? legacyToDraft(stream, firstYear, planGrowth) : streamToDraft(stream), false)}
                    className="flex min-h-10 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold disabled:opacity-50"
                  >
                    <Pencil size={16} aria-hidden="true" />
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t.remove} ${stream.label}`}
                    disabled={streams.length <= 1}
                    onClick={() => setAsking(stream.id)}
                    className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-[14px] font-semibold disabled:opacity-50"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {t.remove}
                  </button>
                </>
              )}
            </div>
            {stream.start_year == null && stream.ends_after != null && !stream.ends_after.endsWith('-12') ? <p className="text-[13px] text-muted">{t.legacyNote(stream.ends_after)}</p> : null}
          </li>
        ))}
      </ul>
      {streams.length <= 1 && real.length === 1 ? <p className="text-[13px] text-muted">{t.lastIncomeNote}</p> : null}
      {failed && !editing ? <FormError>{t.saveFailed}</FormError> : null}

      {draft ? (
        <form
          aria-label={editing?.isNew ? t.formNew : t.formEdit}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
          className="flex flex-col gap-4 rounded-2xl border border-ink/30 p-4"
        >
          <h3 className="font-display text-[18px] font-bold">{editing?.isNew ? t.formNew : t.formEdit}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t.name} value={draft.name} onChange={(name) => change({ name })} maxLength={80} error={err('name')} />
            <AmountField label={t.amount} value={draft.amount} onChange={(amount) => change({ amount })} error={err('amount')} />
            <SelectField
              label={t.frequency}
              value={draft.frequency}
              onChange={(frequency: IncomeFrequency) => change({ frequency })}
              options={(['monthly', 'quarterly', 'yearly'] as const).map((value) => ({ value, label: t.frequencies[value] }))}
            />
            <div className="flex items-end pb-2 text-[14px] text-muted">{monthly ? t.perMonth(formatMoney(monthly)) : ''}</div>
            <TextField label={t.startYear} hint={t.startHint} value={draft.startYear} onChange={(startYear) => change({ startYear })} inputMode="numeric" maxLength={4} error={err('start')} />
            <TextField label={t.endYear} hint={t.endHint} value={draft.endYear} onChange={(endYear) => change({ endYear })} inputMode="numeric" maxLength={4} error={err('end')} />
            <TextField label={t.raise} hint={t.raiseHint} value={draft.growth} onChange={(growth) => change({ growth })} inputMode="decimal" maxLength={5} error={err('growth')} />
            <TextField
              label={t.raiseStart}
              hint={t.raiseStartHint(Number(draft.startYear) + 1)}
              value={draft.growthStart}
              onChange={(growthStart) => change({ growthStart })}
              inputMode="numeric"
              maxLength={4}
              error={err('growthStart')}
            />
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-sand/50 p-3">
            <p className="font-semibold">{t.stepUps}</p>
            <p className="text-[13px] text-muted">{t.stepHint}</p>
            {draft.steps.map((step, index) => (
              <div key={step.id} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <TextField
                  label={`${t.stepYear} ${index + 1}`}
                  value={step.year}
                  onChange={(year) => change({ steps: draft.steps.map((s) => (s.id === step.id ? { ...s, year } : s)) })}
                  inputMode="numeric"
                  maxLength={4}
                  error={stepErr(step.id, 'stepYear', 'stepDuplicate')}
                />
                <AmountField
                  label={`${t.stepAmount} ${index + 1}`}
                  value={step.amount}
                  onChange={(amount) => change({ steps: draft.steps.map((s) => (s.id === step.id ? { ...s, amount } : s)) })}
                  error={stepErr(step.id, 'stepAmount')}
                />
                <button
                  type="button"
                  aria-label={`${t.removeStep} ${index + 1}`}
                  onClick={() => change({ steps: draft.steps.filter((s) => s.id !== step.id) })}
                  className="mt-8 flex size-10 items-center justify-center rounded-lg border border-line"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => change({ steps: [...draft.steps, { id: uid('change'), year: '', amount: '' }] })}
              className="flex min-h-10 items-center gap-2 self-start rounded-lg border border-ink px-3 text-[14px] font-semibold"
            >
              <Plus size={16} aria-hidden="true" />
              {t.addStep}
            </button>
          </div>
          {attempted && issues && hasIssues(issues) ? <FormError>{t.fixIssues}</FormError> : null}
          {failed ? <FormError>{t.saveFailed}</FormError> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving} aria-busy={saving} className="min-h-12 rounded-xl bg-ink px-5 font-semibold text-white disabled:opacity-60">
              {saving ? t.saving : editing?.isNew ? t.confirmIncome : t.saveChanges}
            </button>
            <button type="button" disabled={saving} onClick={close} className="min-h-12 rounded-xl border border-line px-5 font-semibold disabled:opacity-60">
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => open(blankDraft(uid('income'), firstYear), true)} className="flex min-h-12 items-center gap-2 self-start rounded-xl bg-ink px-5 font-semibold text-white">
          <Plus size={18} aria-hidden="true" />
          {t.addIncome}
        </button>
      )}
      {accountState !== 'ready' ? <Notice>{t.notSignedIn}</Notice> : null}
    </Panel>
  )
}

/** One line describing when an income runs and how it changes. */
function summary(stream: IncomeStream, t: ReturnType<typeof useExtrasCopy>['income'], planGrowth: string): string {
  if (stream.start_year == null) {
    const growth = Number(planGrowth) * 100
    return [stream.ends_after ? t.endsAfter(stream.ends_after) : t.legacyNote(null), growth > 0 ? t.legacyGrowth(String(growth)) : ''].filter(Boolean).join(' ')
  }
  const parts = [stream.end_year == null ? t.fromYear(stream.start_year) : t.betweenYears(stream.start_year, stream.end_year)]
  if (stream.annual_growth && Number(stream.annual_growth) > 0) {
    parts.push(t.raiseSummary(String(Number(stream.annual_growth) * 100), stream.growth_start_year ?? stream.start_year + 1))
  }
  const changes = stream.step_ups ?? []
  if (changes.length > 0) parts.push(t.changesSummary(changes.length))
  return parts.join(' · ')
}
