import { useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../api/client'
import type { SpendingCategory, SpendingPlan, SpendingSettings, SpendingTrajectory } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { ratePercentText } from '../../lib/spending'
import { useAction } from '../../state/useAction'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import { FormError, TextField } from '../forms'
import { Notice, Panel, Stat } from '../panel'
import { CategoriesPanel } from './CategoriesPanel'
import { InflationEditor } from './InflationEditor'
import { failureText } from './failure'
import { PlansPanel } from './PlansPanel'

const money = (amount: string) => formatMoney(amount, { paise: true })

/**
 * The Expenditure dashboard: cumulative spending with inflation, the annual bars, the year-by-year table, then the
 * categories and the plans behind them. Every figure comes from the server's trajectory; nothing is recalculated here.
 */
export function SpendingDashboard() {
  const [version, setVersion] = useState(0)
  const refresh = () => setVersion((current) => current + 1)
  const trajectory = useRemote<SpendingTrajectory>(`spending-trajectory-${version}`, (signal) => api.spendingTrajectory(signal))
  const settings = useRemote<SpendingSettings>(`spending-settings-${version}`, (signal) => api.spendingSettings(signal))
  const plans = useRemote<SpendingPlan[]>(`spending-plans-${version}`, (signal) => api.spendingPlans(signal))
  const categories = useRemote<SpendingCategory[]>(`spending-categories-${version}`, (signal) => api.spendingCategories(signal))

  const failed = trajectory.error || settings.error || plans.error || categories.error
  if (failed && !trajectory.data) {
    return (
      <Panel title="Planned spending">
        <FormError>We could not load your spending plans.</FormError>
        <button type="button" onClick={refresh} className="min-h-11 self-start rounded-xl border border-ink px-4 font-semibold">
          Try again
        </button>
      </Panel>
    )
  }
  if (!trajectory.data || !settings.data) {
    return (
      <p role="status" className="text-muted">
        Loading your spending plans…
      </p>
    )
  }

  const t = trajectory.data
  return (
    <>
      <Summary trajectory={t} settings={settings.data} onChanged={refresh} />
      {t.plans_included === 0 ? (
        <Panel title="No spending plans yet">
          <p className="text-muted">Add your first expenditure below. Each plan is an amount, how often you pay it, and for how long. The projection appears here as soon as there is one.</p>
        </Panel>
      ) : (
        <>
          <UseForGoals onChanged={refresh} />
          <AnnualBars trajectory={t} />
          <YearTable trajectory={t} />
        </>
      )}
      <CategoriesPanel categories={categories.data ?? []} onChanged={refresh} />
      <PlansPanel plans={plans.data ?? []} categories={categories.data ?? []} onChanged={refresh} />
    </>
  )
}

function Summary({ trajectory, settings, onChanged }: { trajectory: SpendingTrajectory; settings: SpendingSettings; onChanged: () => void }) {
  const horizon = useAction()
  const exporter = useAction()
  const [custom, setCustom] = useState('')
  const [editingRate, setEditingRate] = useState(false)

  const setYears = (years: number) => void horizon.run(async () => { await api.spendingSetHorizon(years); onChanged() })
  const customYears = Number(custom)
  const customValid = /^\d{1,2}$/.test(custom) && customYears >= 1 && customYears <= 50

  const download = (granularity: 'yearly' | 'monthly') =>
    void exporter.run(async () => {
      const blob = await api.spendingTrajectoryCsv(granularity)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `arthayukti_expenditure_trajectory_${granularity}_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    })

  const last = trajectory.years.at(-1)
  return (
    <Panel
      id="spending-summary"
      title="Planned spending"
      aside={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => download('yearly')} disabled={exporter.busy} className="flex min-h-9 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold disabled:opacity-50">
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
          <button type="button" onClick={() => download('monthly')} disabled={exporter.busy} className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-3 text-[14px] disabled:opacity-50">
            <Download size={16} aria-hidden="true" /> Monthly CSV
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Stat
          label="Cumulative spending with inflation"
          value={money(trajectory.total_with_inflation)}
          note={`From ${trajectory.starts} for ${trajectory.horizon_years} year${trajectory.horizon_years === 1 ? '' : 's'}${last ? `, to ${last.year}` : ''}`}
        />
        <Stat label="Cumulative spending without inflation" value={money(trajectory.total_without_inflation)} note="Planned changes kept, inflation set to zero" />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div role="group" aria-label="Projection horizon" className="flex flex-wrap gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
          {settings.horizon_presets.map((years) => (
            <button key={years} type="button" aria-pressed={settings.horizon_years === years} disabled={horizon.busy} onClick={() => setYears(years)} className={`min-h-9 rounded-lg px-3 ${settings.horizon_years === years ? 'bg-ink font-semibold text-white' : 'text-muted hover:text-ink'}`}>
              {years} {years === 1 ? 'year' : 'years'}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="w-32">
            <TextField label="Custom (years)" value={custom} onChange={setCustom} inputMode="numeric" maxLength={2} hint="1 to 50" />
          </div>
          <button type="button" disabled={!customValid || horizon.busy} onClick={() => setYears(customYears)} className="min-h-11 rounded-xl border border-ink px-4 font-semibold disabled:opacity-50">
            Apply
          </button>
        </div>
        <button type="button" onClick={() => setEditingRate((open) => !open)} aria-expanded={editingRate} className="min-h-11 rounded-xl border border-line px-4">
          Global inflation: <strong>{ratePercentText(settings.current_inflation)}</strong> · Change
        </button>
      </div>
      {editingRate ? <InflationEditor settings={settings} onChanged={() => { setEditingRate(false); onChanged() }} /> : null}
      {horizon.failure ? <FormError>{failureText(horizon.failure)}</FormError> : null}
      {exporter.failure ? <FormError>The export did not download. Please try again.</FormError> : null}
      <Notice>
        Spending starts from this month. A plan with its own rate ignores the global one. The projection is a deterministic estimate from the plans you enter, not a forecast.
      </Notice>
    </Panel>
  )
}

/** Lets the goals, scenarios and fixes read these spending plans instead of the plan's own expense lines. */
function UseForGoals({ onChanged }: { onChanged: () => void }) {
  const { plan, replacePlan } = useStore()
  const action = useAction()
  if (!plan) return null
  const active = (plan.spending_schedule?.length ?? 0) > 0
  const apply = () =>
    void action.run(async () => {
      replacePlan(await api.spendingApplyToPlan(plan))
      onChanged()
    })
  return (
    <Panel id="spending-use" title="Use these plans for your goals">
      <p className="text-muted">
        {active
          ? `Your goals, scenarios and fixes now read the spending from these plans for ${plan.spending_schedule?.length} months, starting ${plan.spending_schedule?.[0]?.month}. Months after that use your plan's own expense lines. If you change a plan here, apply it again.`
          : 'Your goals, scenarios and fixes read the expense lines in your plan. You can have them read these spending plans instead. The expense lines are not added on top for the months these plans cover.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={action.busy} onClick={apply} className="min-h-11 rounded-xl bg-ink px-5 font-semibold text-white disabled:opacity-50">
          {active ? 'Apply again' : 'Use these plans'}
        </button>
        {active ? (
          <button type="button" disabled={action.busy} onClick={() => replacePlan({ ...plan, spending_schedule: [] })} className="min-h-11 rounded-xl border border-ink px-5 font-semibold disabled:opacity-50">
            Go back to my plan's expense lines
          </button>
        ) : null}
      </div>
      {action.failure ? <FormError>{failureText(action.failure)}</FormError> : null}
    </Panel>
  )
}

function AnnualBars({ trajectory }: { trajectory: SpendingTrajectory }) {
  const peak = Math.max(...trajectory.years.map((row) => Number(row.annual_with_inflation)), 1)
  return (
    <Panel id="spending-chart" title="Spending by year (with inflation)">
      <div className="overflow-x-auto pb-2" role="img" aria-label={`Annual spending with inflation for ${trajectory.years.length} years; the same values are in the table below.`}>
        <ul className="flex min-w-max items-end gap-3" style={{ height: 240 }}>
          {trajectory.years.map((row) => (
            <li key={row.year} className="flex h-full w-[92px] flex-col justify-end gap-1 text-center">
              <span className="font-figures text-[12px] leading-tight break-words">{money(row.annual_with_inflation)}</span>
              <span aria-hidden="true" className="rounded-t-lg bg-brand" style={{ height: `${Math.max(2, (Number(row.annual_with_inflation) / peak) * 170)}px` }} />
              <span className="text-[13px] text-muted">
                {row.year}
                {row.months_included < 12 ? ` · ${row.months_included} mo` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function YearTable({ trajectory }: { trajectory: SpendingTrajectory }) {
  return (
    <Panel id="spending-table" title="Year by year">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <caption className="sr-only">Annual spending with inflation, and cumulative spending with and without inflation</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Year</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Annual, with inflation</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Cumulative, with inflation</th>
              <th scope="col" className="py-2 text-right font-medium">Cumulative, without inflation</th>
            </tr>
          </thead>
          <tbody>
            {trajectory.years.map((row) => (
              <tr key={row.year} className="border-b border-line/60">
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {row.year}
                  {row.months_included < 12 ? <span className="ml-2 text-[12px] font-normal text-muted">{row.months_included} months</span> : null}
                </th>
                <td className="font-figures py-2 pr-3 text-right">{money(row.annual_with_inflation)}</td>
                <td className="font-figures py-2 pr-3 text-right">{money(row.cumulative_with_inflation)}</td>
                <td className="font-figures py-2 text-right">{money(row.cumulative_without_inflation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
