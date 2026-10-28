import { Plus, Trash2 } from 'lucide-react'
import { MAX_STEPS, newId, type InvestmentDraft, type ProblemKey, type Problems, type StepDraft } from '../../lib/calculators'
import { useCalculatorsCopy } from '../../state/useCalculatorsCopy'
import { SelectField, TextField } from '../forms'

interface Props {
  index: number
  draft: InvestmentDraft
  problems: Problems
  showProblems: boolean
  canRemove: boolean
  onChange: (next: InvestmentDraft) => void
  onRemove: () => void
}

export function InvestmentCard({ index, draft, problems, showProblems, canRemove, onChange, onRemove }: Props) {
  const copy = useCalculatorsCopy()
  const t = copy.investment
  const words = copy.problems
  const set = <K extends keyof InvestmentDraft>(key: K, value: InvestmentDraft[K]) => onChange({ ...draft, [key]: value })
  const error = (field: string) => {
    const key: ProblemKey | undefined = showProblems ? problems[`${draft.id}.${field}`] : undefined
    return key ? words[key] : null
  }
  const setStep = (id: string, patch: Partial<StepDraft>) => set('steps', draft.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)))

  return (
    <section aria-labelledby={`${draft.id}-title`} className="glass flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${draft.id}-title`} className="font-display text-[20px] font-bold tracking-tight">
          {draft.name.trim() || t.heading(index + 1)}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-10 items-center gap-2 text-[14px]">
            <input type="checkbox" checked={draft.include} onChange={(event) => set('include', event.target.checked)} className="size-4 accent-[var(--color-brand)]" />
            {t.include}
          </label>
          {canRemove ? (
            <button type="button" onClick={onRemove} aria-label={`${t.remove}: ${draft.name.trim() || t.heading(index + 1)}`} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[14px] font-semibold">
              <Trash2 size={16} aria-hidden="true" />
              {t.remove}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t.name} value={draft.name} onChange={(value) => set('name', value)} error={error('name')} maxLength={80} />
        <TextField label={t.start} type="month" value={draft.startMonth} onChange={(value) => set('startMonth', value)} error={error('startMonth')} />
        <TextField label={t.lump} value={draft.lumpSum} onChange={(value) => set('lumpSum', value)} inputMode="numeric" hint={t.lumpHint} error={error('lumpSum')} placeholder="0" />
        <TextField label={t.growthRate} value={draft.growthPercent} onChange={(value) => set('growthPercent', value)} inputMode="decimal" hint={t.growthRateHint} error={error('growthPercent')} />
        <TextField label={t.growthYears} value={draft.growthYears} onChange={(value) => set('growthYears', value)} inputMode="numeric" hint={t.growthHint} error={error('growthYears')} />
        <TextField label={t.tax} value={draft.taxPercent} onChange={(value) => set('taxPercent', value)} inputMode="decimal" hint={t.taxHint} error={error('taxPercent')} />
        <SelectField
          label={t.taxMethod}
          value={draft.taxMethod}
          onChange={(value) => set('taxMethod', value)}
          options={[{ value: 'gains', label: t.taxMethods.gains }, { value: 'total_amount', label: t.taxMethods.total_amount }]}
          hint={t.taxMethodHint}
        />
        <SelectField
          label={t.rateConvention}
          value={draft.rateConvention}
          onChange={(value) => set('rateConvention', value)}
          options={[{ value: 'nominal_monthly', label: t.rateConventions.nominal_monthly }, { value: 'effective_annual', label: t.rateConventions.effective_annual }]}
          hint={t.rateConventionHint}
        />
        <TextField label={t.inflation} value={draft.inflationPercent} onChange={(value) => set('inflationPercent', value)} inputMode="decimal" hint={t.inflationHint} error={error('inflationPercent')} />
      </div>

      <label className="flex min-h-10 items-center gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={draft.recurring} onChange={(event) => set('recurring', event.target.checked)} className="size-4 accent-[var(--color-brand)]" />
        {t.recurring}
      </label>

      {draft.recurring ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label={t.amount} value={draft.amount} onChange={(value) => set('amount', value)} inputMode="numeric" error={error('amount')} />
            <SelectField
              label={t.frequency}
              value={draft.frequency}
              onChange={(value) => set('frequency', value)}
              options={[
                { value: 'monthly', label: t.monthly },
                { value: 'quarterly', label: t.quarterly },
                { value: 'annual', label: t.annual },
              ]}
            />
            <TextField label={t.contributionYears} value={draft.contributionYears} onChange={(value) => set('contributionYears', value)} inputMode="numeric" error={error('contributionYears')} />
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-[15px] font-semibold">{t.steps}</h3>
              <p className="text-[14px] text-muted">{t.stepsHint}</p>
            </div>
            {draft.steps.map((step) => (
              <div key={step.id} className="grid items-start gap-3 sm:grid-cols-[1fr_1.4fr_1.4fr_auto]">
                <TextField label={t.stepYear} value={step.fromYear} onChange={(value) => setStep(step.id, { fromYear: value })} inputMode="numeric" error={error(`step.${step.id}.fromYear`)} />
                <SelectField
                  label={t.stepMode}
                  value={step.mode}
                  onChange={(value) => setStep(step.id, { mode: value, value: '' })}
                  options={[
                    { value: 'amount', label: t.stepKindAmount },
                    { value: 'percent', label: t.stepKindPercent },
                  ]}
                />
                <TextField label={step.mode === 'amount' ? t.stepAmount : t.stepPercent} value={step.value} onChange={(value) => setStep(step.id, { value })} inputMode={step.mode === 'amount' ? 'numeric' : 'decimal'} error={error(`step.${step.id}.value`)} />
                <button type="button" onClick={() => set('steps', draft.steps.filter((item) => item.id !== step.id))} aria-label={t.removeStep} className="mt-8 flex size-10 items-center justify-center rounded-xl border border-line">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
            {draft.steps.length < MAX_STEPS ? (
              <button
                type="button"
                onClick={() => set('steps', [...draft.steps, { id: newId('step'), fromYear: String(draft.steps.length + 2), mode: 'amount', value: '' }])}
                className="flex min-h-10 items-center gap-1.5 self-start rounded-xl border border-line px-4 text-[14px] font-semibold"
              >
                <Plus size={16} aria-hidden="true" />
                {t.addStep}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
