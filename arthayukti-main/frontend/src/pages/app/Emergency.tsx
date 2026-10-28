import { useState } from 'react'
import { api } from '../../api/client'
import { AmountField, FormError, TextField } from '../../components/forms'
import { AreaLine } from '../../components/charts'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { monthLabel, monthLabelLong } from '../../lib/months'
import { useAction } from '../../state/useAction'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { useStore } from '../../state/useStore'

const DEFAULT_TARGET_MONTHS = 12
const submit = 'min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60'
const money = (amount: string) => formatMoney(amount, { paise: true })

/** A target in whole months from 1 to 60, or null when what was typed is not one. */
function parseTarget(text: string): number | null {
  return /^[1-9]\d?$/.test(text.trim()) && Number(text) <= 60 ? Number(text) : null
}

/**
 * The emergency reserve: what is held, the person's own target in months of essentials, and the engine's projection of
 * how the plan grows it. The reserve is the emergency-fund goal's saved balance, counted once.
 */
export function EmergencyPage() {
  const t = useRestructureCopy().emergency
  const common = useModulesCopy().common
  const { plan, language, setEmergencyReserve, addEmergencyGoal } = useStore()
  const profile = useRemote('household-profile', (signal) => api.getHouseholdProfile(signal))
  const [typed, setTyped] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTarget = useAction()

  // The saved target is shown until the person types; after that the typing is theirs.
  const storedTarget = profile.data?.emergency_fund_months_target
  // Until the person sets their own, the starting default of 12 months is used and said so.
  const usingDefault = typed === null && storedTarget == null
  const targetText = typed ?? (storedTarget != null ? String(storedTarget) : String(DEFAULT_TARGET_MONTHS))
  const profileKnown = profile.data !== null || profile.error !== null

  const target = parseTarget(targetText)
  const typedBadly = targetText.trim() !== '' && target === null
  const key = plan && profileKnown ? JSON.stringify([plan, target]) : null
  const analysis = useRemote(key, (signal) => api.emergencyAnalyze(plan!, target, signal), 250)

  async function save() {
    setTried(true)
    setSaved(false)
    if (target === null) return
    const ok = await saveTarget.run(() => api.updateHouseholdProfile({ emergency_fund_months_target: target }))
    if (ok) setSaved(true)
  }

  if (!plan) return <Notice>{common.needsPlan}</Notice>

  const emergencyGoal = plan.goals.find((goal) => goal.type === 'emergency_fund')
  const data = analysis.data
  const hasSpending = (plan.expenses ?? []).some((expense) => Number(expense.monthly) > 0)

  return (
    <>
      <Panel title={t.title}>
        <p className="text-muted">{t.intro}</p>
        {!hasSpending && !emergencyGoal ? <Notice>{t.empty}</Notice> : null}
        <Loaded remote={analysis}>
          {(result) => (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t.held} value={result.reserve_held !== null ? money(result.reserve_held) : '–'} />
              <Stat label={t.essentials} value={money(result.monthly_essentials)} note={t.essentialsNote} />
              <Stat label={t.covered} value={result.months_covered ?? '–'} />
              <Stat label={t.target} value={result.target_amount !== null ? money(result.target_amount) : '–'} />
              {result.progress !== null ? (
                <div className="sm:col-span-2 lg:col-span-4">
                  <p className="text-[14px] text-muted">{t.progress}</p>
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(result.progress) * 100)} aria-label={t.progress} className="h-3 w-full overflow-hidden rounded-full bg-sand">
                    <div className="h-full bg-brand" style={{ width: `${Math.round(Number(result.progress) * 100)}%` }} />
                  </div>
                  <p className="mt-1 font-figures text-[15px]">
                    {Math.round(Number(result.progress) * 100)}%
                    {result.shortfall_to_target !== null && Number(result.shortfall_to_target) > 0 ? ` · ${t.shortfall}: ${money(result.shortfall_to_target)}` : ` · ${t.reached}`}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </Loaded>
      </Panel>

      <Panel title={t.target}>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <TextField label={t.targetMonths} hint={usingDefault ? `${t.targetHint} ${t.defaultNote}` : t.targetHint} value={targetText} onChange={(value) => { setTyped(value); setSaved(false) }} inputMode="numeric" error={(tried || typedBadly) && target === null ? t.badTarget : null} />
          <div className="flex items-end">
            <button type="submit" disabled={saveTarget.busy} className={submit}>
              {saveTarget.busy ? t.saving : t.saveTarget}
            </button>
          </div>
          {saveTarget.failure ? (
            <div className="sm:col-span-2">
              <FormError>{t.targetFailed}</FormError>
            </div>
          ) : null}
          {saved ? <p role="status" className="rounded-xl bg-sage px-4 py-3 font-semibold sm:col-span-2">{t.targetSaved}</p> : null}
        </form>
      </Panel>

      {emergencyGoal ? (
        <Panel title={t.heldLabel}>
          <div className="grid gap-3 sm:grid-cols-2">
            <AmountField label={t.heldLabel} hint={t.heldHint} value={emergencyGoal.current_savings ?? ''} onChange={(value) => setEmergencyReserve(value === '' ? '0.00' : value)} />
          </div>
          <Notice>{t.notCounted}</Notice>
        </Panel>
      ) : (
        <Panel title={t.noGoalTitle}>
          <p className="text-muted">{t.noGoalBody}</p>
          {data?.target_amount ? (
            <>
              <button type="button" onClick={() => addEmergencyGoal(data.target_amount as string)} className={submit}>
                {t.addGoal}
              </button>
              <p className="text-[14px] text-muted">{t.addGoalNote}</p>
            </>
          ) : (
            <p className="text-[14px] text-muted">{t.needTarget}</p>
          )}
        </Panel>
      )}

      {data && data.projected.length >= 2 ? (
        <Panel title={t.projectedTitle}>
          <p className="text-muted">{t.projectedNote}</p>
          {data.goal_status ? (
            <p className="font-semibold">
              {t.status[data.goal_status as keyof typeof t.status] ?? data.goal_status}
              {data.projected_completion ? ` · ${t.completes} ${monthLabelLong(data.projected_completion, language)}` : ''}
            </p>
          ) : null}
          <AreaLine points={data.projected.map((point) => ({ label: monthLabel(point.month, language), value: point.balance }))} summary={t.chartLabel} />
          <Table
            caption={t.chartLabel}
            head={[t.month, t.balance]}
            rows={data.projected.filter((_, index) => index % 3 === 2 || index === 0).map((point) => [monthLabel(point.month, language), money(point.balance)])}
          />
        </Panel>
      ) : null}

      {data ? (
        <ul className="list-disc space-y-1 pl-6 text-[14px] text-muted">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
