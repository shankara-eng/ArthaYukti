import { useState } from 'react'
import { api } from '../../api/client'
import type { Goal, TrajectoryResult } from '../../api/types'
import { CheckField, FormError, SelectField, TextField } from '../../components/forms'
import { Notice, Panel, Stat, Table } from '../../components/panel'
import { InputHealth } from '../../components/trajectory/InputHealth'
import { AllocationBars, TrajectoryCharts } from '../../components/trajectory/TrajectoryCharts'
import { TrajectoryLedger } from '../../components/trajectory/TrajectoryLedger'
import type { TrajectoryCopy } from '../../i18n/trajectory'
import { formatMoney, toPaise } from '../../lib/money'
import { monthLabel, monthLabelLong, type Language } from '../../lib/months'
import {
  ASSET_CLASSES,
  YEAR_CHOICES,
  buildRequest,
  defaultChoices,
  editRoute,
  fingerprint,
  percentToGrowthRate,
  percentToSignedRate,
  series,
  timeline,
  type GoalEffectName,
  type TrajectoryChoices,
} from '../../lib/trajectory'
import { useKeyedRemote } from '../../state/useKeyedRemote'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import { useTrajectoryCopy } from '../../state/useTrajectoryCopy'

const AGE = 'age'
const TIMELINE_SHOWN = 8

/**
 * The Financial Trajectory: one monthly timeline of cash, assets, debts, insurance and the goals the person chooses.
 * Everything is worked out by the server from records kept elsewhere; this page only chooses, asks and shows. Numbers
 * for earlier choices are never shown while new ones are being worked out.
 */
export function TrajectoryPage() {
  const t = useTrajectoryCopy()
  const { plan, planId, dirty, language, scenario } = useStore()
  const [choices, setChoices] = useState<TrajectoryChoices>(defaultChoices)
  const debts = useRemote('trajectory-debts', (signal) => api.liabilities(signal))
  const built = buildRequest(choices)

  const needsGoals = choices.view === 'selected_goals' && choices.goalIds.length === 0
  const needsScenario = choices.view === 'scenario' && scenario === undefined
  const runnable = plan !== null && built.problems.length === 0 && !needsGoals && !needsScenario
  const useSaved = planId !== null && !dirty
  const key = runnable ? fingerprint([built.request, useSaved ? planId : plan, choices.view === 'scenario' ? scenario : null]) : null
  const remote = useKeyedRemote<TrajectoryResult>(
    key,
    (signal) =>
      api.trajectory(
        {
          ...built.request,
          ...(useSaved && planId ? { plan_id: planId } : { plan: plan ?? undefined }),
          ...(choices.view === 'scenario' ? { scenario } : {}),
        },
        signal,
      ),
    300,
  )

  if (!plan) return <Notice>{t.needPlan}</Notice>

  const set = (change: Partial<TrajectoryChoices>) => setChoices((current) => ({ ...current, ...change }))
  const horizonValue = choices.horizon.kind === 'age' ? AGE : String(choices.horizon.years)
  const ageProblem = built.problems.includes('age') && choices.horizon.kind === 'age'

  return (
    <>
      <Panel id="trajectory-header" title={t.title}>
        <p className="text-muted">{t.lead}</p>
        <p className="text-[14px] font-semibold">{t.starting(monthLabelLong(plan.as_of, language))}</p>
        <p role="status" className="min-h-6 text-[14px] text-muted">
          {remote.loading ? (remote.outdated ? t.recalculating : t.calculating) : ''}
        </p>
      </Panel>

      <Panel id="trajectory-controls" title={t.controls}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t.horizon}
            value={horizonValue}
            onChange={(value) => set({ horizon: value === AGE ? { kind: 'age', age: '' } : { kind: 'years', years: Number(value) } })}
            options={[...YEAR_CHOICES.map((years) => ({ value: String(years), label: t.years(years) })), { value: AGE, label: t.toAge }]}
          />
          {choices.horizon.kind === 'age' ? (
            <TextField
              label={t.targetAge}
              hint={t.ageHint}
              value={choices.horizon.age}
              onChange={(age) => set({ horizon: { kind: 'age', age } })}
              inputMode="numeric"
              maxLength={3}
              error={ageProblem && choices.horizon.age !== '' ? t.badAge : null}
            />
          ) : null}
        </div>

        <div role="group" aria-label={t.view} className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
          {(['baseline', 'selected_goals', 'scenario'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={choices.view === view}
              onClick={() => set({ view })}
              className={`min-h-10 rounded-lg px-4 ${choices.view === view ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'}`}
            >
              {t.views[view]}
            </button>
          ))}
        </div>
        <p className="text-[14px] text-muted">{t.viewHints[choices.view]}</p>

        {choices.view !== 'baseline' ? <GoalPicker goals={plan.goals} choices={choices} set={set} t={t} debts={(debts.data ?? []).map((debt) => ({ id: debt.id, name: debt.liability_name }))} /> : null}
        {choices.view === 'scenario' ? <Notice tone={needsScenario ? 'warn' : undefined}>{needsScenario ? t.scenarioNone : t.scenarioUsing(scenario?.name ?? '')}</Notice> : null}

        <details className="rounded-2xl border border-line p-4">
          <summary className="min-h-10 cursor-pointer font-semibold">{t.moreOptions}</summary>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h3 className="font-semibold">{t.assumptionsTitle}</h3>
              <p className="text-[14px] text-muted">{t.assumptionsLead}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ASSET_CLASSES.map((klass) => {
                  const typed = choices.rates[klass] ?? ''
                  return (
                    <TextField
                      key={klass}
                      label={t.classes[klass]}
                      value={typed}
                      onChange={(value) => set({ rates: { ...choices.rates, [klass]: value } })}
                      placeholder={t.ratePlaceholder}
                      inputMode="decimal"
                      maxLength={6}
                      error={typed.trim() !== '' && percentToSignedRate(typed) === null ? t.badRate : null}
                    />
                  )
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t.premiumGrowth}
                hint={t.premiumGrowthHint}
                value={choices.premiumGrowth}
                onChange={(premiumGrowth) => set({ premiumGrowth })}
                inputMode="decimal"
                maxLength={5}
                error={percentToGrowthRate(choices.premiumGrowth) === null ? t.badGrowth : null}
              />
              <SelectField
                label={t.spendingSource}
                hint={t.spendingSourceHint}
                value={choices.spendingSource}
                onChange={(spendingSource) => set({ spendingSource })}
                options={(['plan', 'expenditure_plans'] as const).map((value) => ({ value, label: t.spendingSources[value] }))}
              />
              <TextField
                label={t.inflation}
                hint={t.inflationHint}
                value={choices.inflation}
                onChange={(inflation) => set({ inflation })}
                inputMode="decimal"
                maxLength={5}
                error={choices.inflation.trim() !== '' && percentToGrowthRate(choices.inflation) === null ? t.badInflation : null}
              />
              <SelectField
                label={t.premiumRule}
                value={choices.premiumRule}
                onChange={(premiumRule) => set({ premiumRule })}
                options={(['auto', 'yes', 'no'] as const).map((value) => ({ value, label: t.premiumRules[value] }))}
              />
            </div>
          </div>
        </details>
      </Panel>

      {remote.error ? (
        <div className="flex flex-col items-start gap-2">
          <FormError>{t.errors[remote.error] ?? t.failed}</FormError>
          <button type="button" onClick={remote.reload} className="min-h-11 rounded-xl border border-ink px-4 font-semibold">
            {t.retry}
          </button>
        </div>
      ) : null}

      {remote.data ? <Results data={remote.data} t={t} language={language} choices={choices} set={set} /> : null}
    </>
  )
}

interface PickerProps {
  goals: Goal[]
  choices: TrajectoryChoices
  set: (change: Partial<TrajectoryChoices>) => void
  t: TrajectoryCopy
  debts: { id: string; name: string }[]
}

function GoalPicker({ goals, choices, set, t, debts }: PickerProps) {
  if (goals.length === 0) return <Notice>{t.noGoals}</Notice>
  const toggle = (id: string, on: boolean) => {
    const goalIds = on ? [...choices.goalIds, id] : choices.goalIds.filter((existing) => existing !== id)
    const goalEffects = { ...choices.goalEffects }
    if (!on) delete goalEffects[id]
    set({ goalIds, goalEffects })
  }
  const setEffect = (id: string, effect: GoalEffectName | '', liabilityId?: string) => {
    const goalEffects = { ...choices.goalEffects }
    if (effect === '') delete goalEffects[id]
    else goalEffects[id] = { effect, liabilityId: effect === 'debt_reduction' ? (liabilityId ?? debts[0]?.id) : undefined }
    set({ goalEffects })
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-semibold">{t.goalsPick}</legend>
      {goals.map((goal) => {
        const selected = choices.goalIds.includes(goal.id)
        const chosen = choices.goalEffects[goal.id]
        const askEffect = selected && (goal.type === 'custom' || goal.type === 'loan_payoff')
        const options: GoalEffectName[] = goal.type === 'custom' ? ['hold', 'spend', 'asset_purchase'] : ['hold', 'debt_reduction']
        return (
          <div key={goal.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <CheckField label={`${goal.label} · ${formatMoney(goal.target_amount_today)}`} checked={selected} onChange={(on) => toggle(goal.id, on)} />
            {askEffect ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label={`${goal.label}: ${t.goalEffect}`}
                  value={chosen?.effect ?? 'hold'}
                  onChange={(value: GoalEffectName) => setEffect(goal.id, value === 'hold' && goal.type === 'custom' ? '' : value, chosen?.liabilityId)}
                  options={options.map((value) => ({ value, label: t.effects[value] }))}
                  hint={goal.type === 'custom' ? t.effectNote : undefined}
                />
                {chosen?.effect === 'debt_reduction' ? (
                  debts.length === 0 ? (
                    <p className="self-end text-[14px] text-muted">{t.noDebtToPick}</p>
                  ) : (
                    <SelectField
                      label={`${goal.label}: ${t.whichDebt}`}
                      value={chosen.liabilityId ?? debts[0].id}
                      onChange={(id) => setEffect(goal.id, 'debt_reduction', id)}
                      options={debts.map((debt) => ({ value: debt.id, label: debt.name }))}
                    />
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </fieldset>
  )
}

interface ResultsProps {
  data: TrajectoryResult
  t: TrajectoryCopy
  language: Language
  choices: TrajectoryChoices
  set: (change: Partial<TrajectoryChoices>) => void
}

function Results({ data, t, language, choices, set }: ResultsProps) {
  const [allEvents, setAllEvents] = useState(false)
  const summary = data.summary
  const yearly = data.yearly ?? []
  const last = data.checkpoints[data.checkpoints.length - 1]
  const lastLabel = monthLabelLong(last.month, language)
  const insufficient = data.completeness.status === 'insufficient'
  const debts = summary.projected_debt_free_dates
  const debtFree =
    debts.length === 0 ? t.metrics.debtFreeNone : summary.all_debts_cleared_month ? monthLabelLong(summary.all_debts_cleared_month, language) : t.metrics.debtFreeUnknown
  const events = timeline(data)
  const driverRows = Object.entries(data.drivers).filter(([name, value]) => toPaise(value) !== 0n || name === 'income' || name === 'spending')
  const link = (commitmentId: string, debtId: string) => set({ links: { ...choices.links, [commitmentId]: debtId } })

  if (insufficient) {
    return (
      <>
        <Panel id="trajectory-empty" title={t.empty.title}>
          <p>{t.empty.body}</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['equities', t.empty.accounts],
                ['debts', t.empty.debts],
                ['equities', t.empty.equities],
              ] as const
            ).map(([route, label]) => (
              <a key={label} href={`#/${route}`} className="min-h-11 rounded-xl bg-brand px-4 py-2.5 font-semibold text-white">
                {label}
              </a>
            ))}
          </div>
        </Panel>
        <InputHealth result={data} copy={t} links={choices.links} onLink={link} />
      </>
    )
  }

  return (
    <>
      <Panel id="trajectory-metrics">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat label={t.metrics.now} value={formatMoney(summary.current_net_worth)} />
          <Stat label={t.metrics.end(lastLabel)} value={formatMoney(summary.horizon_net_worth)} />
          {summary.horizon_net_worth_real ? <Stat label={t.metrics.real(lastLabel)} value={formatMoney(summary.horizon_net_worth_real)} note={`${summary.inflation_annual ? Number(summary.inflation_annual) * 100 : 0}% a year`} /> : null}
          <Stat label={t.metrics.cash} value={formatMoney(summary.horizon_cash)} />
          <Stat label={t.metrics.assets} value={formatMoney(summary.horizon_assets)} />
          <Stat label={t.metrics.liabilities} value={formatMoney(summary.horizon_liabilities)} />
          <Stat label={t.metrics.debtFree} value={debtFree} />
        </div>
        <p className="text-[13px] text-muted">{t.metrics.definition}</p>
        <p className="text-[13px] text-muted">
          {t.metrics.prices}: {data.completeness.stale_quotes > 0 ? t.metrics.pricesStale(data.completeness.stale_quotes) : t.metrics.pricesOk}
        </p>
      </Panel>

      <InputHealth result={data} copy={t} links={choices.links} onLink={link} />

      {yearly.length > 0 ? (
        <Panel id="trajectory-yearly" title={t.yearly.title}>
          <Table
            caption={t.yearly.title}
            head={[t.yearly.year, t.yearly.age, t.yearly.cashIn, t.yearly.cashOut, t.yearly.closingCash, t.yearly.netWorth, t.yearly.change, ...(yearly[0].closing_net_worth_real !== null && yearly[0].closing_net_worth_real !== undefined ? [t.yearly.real] : [])]}
            rows={yearly.map((y) => [
              String(y.year),
              y.age === null ? '–' : String(y.age),
              formatMoney(y.cash_in),
              formatMoney(y.cash_out),
              formatMoney(y.closing_cash),
              formatMoney(y.closing_net_worth),
              formatMoney(y.net_worth_change),
              ...(y.closing_net_worth_real !== null && y.closing_net_worth_real !== undefined ? [formatMoney(y.closing_net_worth_real)] : []),
            ])}
          />
          <p className="text-[13px] text-muted">{t.yearly.note}</p>
        </Panel>
      ) : null}

      {data.comparison ? (
        <Panel id="trajectory-comparison" title={t.comparison.title}>
          <Table
            caption={t.comparison.title}
            head={['', t.comparison.baseline, t.views[data.view], t.comparison.difference]}
            rows={[
              [t.comparison.netWorth, formatMoney(data.comparison.baseline_horizon_net_worth), formatMoney(summary.horizon_net_worth), formatMoney(data.comparison.net_worth_difference)],
              [t.comparison.cash, formatMoney(data.comparison.baseline_horizon_cash), formatMoney(summary.horizon_cash), formatMoney(data.comparison.cash_difference)],
            ]}
          />
          <p className="text-[13px] text-muted">{t.comparison.note}</p>
        </Panel>
      ) : null}

      {data.goals.length > 0 ? (
        <Panel id="trajectory-goals" title={t.goals.title}>
          <Table
            caption={t.goals.title}
            head={[t.goals.goal, t.goals.status, t.goals.effect, t.goals.when]}
            rows={data.goals.map((goal) => [
              goal.label,
              `${t.goals.statuses[goal.status] ?? goal.status}${goal.delay_months ? ` (${t.goals.delay(goal.delay_months)})` : ''}`,
              goal.effect_month ? t.effects[goal.effect as GoalEffectName] : t.goals.none,
              goal.effect_month ? monthLabel(goal.effect_month, language) : '–',
            ])}
          />
        </Panel>
      ) : null}

      {data.monthly_ledger ? (
        <Panel id="trajectory-charts" title={t.charts.netWorth}>
          <TrajectoryCharts points={series(data)} copy={t} language={language} />
        </Panel>
      ) : null}

      <Panel id="trajectory-allocation" title={t.charts.allocation}>
        <AllocationBars now={data.opening_balances} end={data.monthly_ledger ? data.monthly_ledger[data.monthly_ledger.length - 1].closing_balances : data.opening_balances} copy={t} />
      </Panel>

      <Panel id="trajectory-drivers" title={t.drivers.title}>
        <Table caption={t.drivers.title} head={['', t.drivers.title]} rows={driverRows.map(([name, value]) => [t.drivers.rows[name] ?? name, formatMoney(value)])} />
        <p className="text-[13px] text-muted">{t.drivers.note}</p>
      </Panel>

      <Panel id="trajectory-checkpoints" title={t.checkpoints.title}>
        <Table
          caption={t.checkpoints.title}
          head={[t.checkpoints.month, ...(data.reference_age !== null ? [t.checkpoints.age] : []), t.checkpoints.assets, t.checkpoints.liabilities, t.checkpoints.netWorth, t.checkpoints.cash]}
          rows={data.checkpoints.map((c) => [
            monthLabel(c.month, language),
            ...(data.reference_age !== null ? [String(c.age ?? '–')] : []),
            formatMoney(c.assets),
            formatMoney(c.liabilities),
            formatMoney(c.net_worth),
            formatMoney(c.cash),
          ])}
        />
      </Panel>

      <Panel id="trajectory-timeline" title={t.timeline.title}>
        {events.length === 0 ? (
          <p className="text-muted">{t.timeline.empty}</p>
        ) : (
          <>
            <ol className="flex flex-col gap-2">
              {(allEvents ? events : events.slice(0, TIMELINE_SHOWN)).map((item, index) => (
                <li key={`${item.month}-${item.kind}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-xl bg-sand/50 px-3 py-2 text-[14px]">
                  <span>
                    <strong>{monthLabel(item.month, language)}</strong> · {t.timeline.kinds[item.kind] ?? item.kind}: {item.label}
                  </span>
                  {toPaise(item.cash) !== 0n ? <span className="font-figures">{formatMoney(item.cash)}</span> : null}
                </li>
              ))}
            </ol>
            {events.length > TIMELINE_SHOWN ? (
              <button type="button" onClick={() => setAllEvents((value) => !value)} className="min-h-11 self-start rounded-xl border border-ink px-4 font-semibold">
                {allEvents ? t.timeline.fewer : t.timeline.all}
              </button>
            ) : null}
          </>
        )}
      </Panel>

      {data.monthly_ledger ? (
        <Panel id="trajectory-ledger" title={t.ledger.title}>
          <TrajectoryLedger rows={data.monthly_ledger} copy={t} language={language} />
        </Panel>
      ) : null}

      <Panel id="trajectory-sources" title={t.sources.title}>
        <details>
          <summary className="min-h-10 cursor-pointer font-semibold">{t.sources.assumptions}</summary>
          <ul className="mt-2 flex flex-col gap-2 text-[14px]">
            {data.effective_assumptions.map((a) => (
              <li key={a.id}>
                <strong>{a.label}</strong>: {a.value} <span className="text-muted">({t.sources.assumptionKinds[a.kind] ?? a.kind}; {a.source})</span>{' '}
                {editRoute(a.edit_route) ? (
                  <a href={`#/${a.edit_route}`} className="font-semibold underline">
                    {t.sources.editAt}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary className="min-h-10 cursor-pointer font-semibold">{t.sources.provenance}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-[14px]">
            {data.provenance.map((p, index) => (
              <li key={`${p.component}-${p.label}-${index}`}>
                <strong>{p.label}</strong>: {t.sources.kinds[p.kind] ?? p.kind}
                {p.source ? `, ${p.source}` : ''}
                {p.as_of ? `, ${p.as_of}` : ''}
              </li>
            ))}
          </ul>
        </details>
        <p className="text-[13px] text-muted">{t.sources.model(data.model_version, data.input_snapshot_hash.slice(0, 12))}</p>
      </Panel>
    </>
  )
}
