import { useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { MonthRow, Plan, ProjectionResult, Scenario } from '../../api/types'
import { AmountField, SelectField } from '../../components/forms'
import { Loaded, Notice, Panel, Table, Unavailable } from '../../components/panel'
import { addMonths, monthLabelLong } from '../../lib/months'
import { addMoney, fromPaise, formatMoney, mulMoney, share, toPaise } from '../../lib/money'
import { goalNameById, statusText, toneOf } from '../../lib/outcome'
import { ownScenario } from '../../lib/scenarios'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import { SpendingDashboard } from '../../components/spending/SpendingDashboard'
import { RecordedDebts } from './RecordedDebts'

const HORIZONS = ['12', '24', '60'] as const

function useHorizon() {
  const m = useModulesCopy().outlook
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>('12')
  const control = (
    <div className="w-48">
      <SelectField
        label={m.horizon}
        value={horizon}
        onChange={setHorizon}
        options={HORIZONS.map((value) => ({ value, label: m.months(Number(value)) }))}
      />
    </div>
  )
  return { months: Number(horizon), control }
}

/** Runs `render` once the plan and its month-by-month result are there. */
function WithProjection({ children }: { children: (plan: Plan, result: ProjectionResult) => ReactNode }) {
  const m = useModulesCopy()
  const { plan, projection, text } = useStore()
  if (!plan) return <Notice>{m.common.needsPlan}</Notice>
  // With no goals there is nothing to project: say so, rather than waiting on a result that will not come.
  if (plan.goals.length === 0) {
    return (
      <Panel title={text.needGoals.title}>
        <p className="text-muted">{text.needGoals.body}</p>
        <a href="#/dreams" className="min-h-12 self-start rounded-xl bg-brand px-6 py-3 font-semibold text-white">
          {text.needGoals.action}
        </a>
      </Panel>
    )
  }
  return <Loaded remote={projection}>{(result) => children(plan, result)}</Loaded>
}

function monthlyRows(result: ProjectionResult, months: number): MonthRow[] {
  return (result.monthly ?? []).slice(0, months)
}

/** Bars of what is left each month. Heights only scale the figures; the table holds the numbers. */
function SurplusBars({ rows, label }: { rows: MonthRow[]; label: string }) {
  const values = rows.map((row) => Number(toPaise(row.surplus)))
  const peak = Math.max(1, ...values.map(Math.abs))
  const width = 100 / Math.max(rows.length, 1)
  return (
    <svg role="img" aria-label={label} viewBox="0 0 100 40" preserveAspectRatio="none" className="h-32 w-full rounded-xl bg-cream">
      <line x1="0" x2="100" y1="20" y2="20" stroke="var(--color-line)" strokeWidth="0.3" />
      {values.map((value, index) => {
        const height = (Math.abs(value) / peak) * 18
        return (
          <rect
            key={rows[index].month}
            x={index * width + width * 0.15}
            width={width * 0.7}
            y={value >= 0 ? 20 - height : 20}
            height={height}
            rx="0.25"
            fill={value >= 0 ? 'var(--color-ontime)' : 'var(--color-late)'}
          />
        )
      })}
    </svg>
  )
}

export function HouseholdTrajectoryPage() {
  const m = useModulesCopy().outlook
  const { language } = useStore()
  const { months, control } = useHorizon()
  return (
    <WithProjection>
      {(_plan, result) => {
        const rows = monthlyRows(result, months)
        return (
          <Panel title={m.household.what} aside={control}>
            <SurplusBars rows={rows} label={m.surplus} />
            <Table
              caption={m.household.what}
              head={[m.month, m.income, m.spending, m.loans, m.oneOffs, m.surplus]}
              rows={rows.map((r) => [monthLabelLong(r.month, language), formatMoney(r.income), formatMoney(r.expenses), formatMoney(r.commitments), formatMoney(r.one_offs), formatMoney(r.surplus)])}
            />
            <Notice>{m.fromPlanner}</Notice>
          </Panel>
        )
      }}
    </WithProjection>
  )
}

export function InvestmentTrajectoryPage() {
  const m = useModulesCopy()
  const t = m.outlook.investment
  const holdings = useRemote('outlook-holdings', (signal) => api.investments(signal))
  return (
    <>
      <Unavailable title={t.title}>
        <p>{t.body}</p>
      </Unavailable>
      <Panel title={t.holdings}>
        <Loaded remote={holdings}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">{m.common.none}</p>
            ) : (
              <Table caption={t.holdings} head={[m.common.name, m.common.kind, m.assets.current]} rows={list.map((h) => [h.asset_name, m.assets.kinds[h.asset_type] ?? h.asset_type, formatMoney(h.current_value)])} />
            )
          }
        </Loaded>
      </Panel>
    </>
  )
}

export function DebtTrajectoryPage() {
  const m = useModulesCopy()
  const t = m.outlook.debt
  const { plan } = useStore()
  if (!plan) return <Notice>{m.common.needsPlan}</Notice>
  const loans = plan.commitments ?? []
  return (
    <>
    <RecordedDebts />
    <Panel title={t.what}>
      {loans.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <Table
          caption={t.what}
          head={[t.loan, t.payment, t.left, t.last, t.remaining]}
          rows={loans.map((loan) => [loan.label, formatMoney(loan.monthly_payment), String(loan.remaining_months), addMonths(plan.as_of, loan.remaining_months - 1), formatMoney(mulMoney(loan.monthly_payment, loan.remaining_months))])}
        />
      )}
    </Panel>
    </>
  )
}

export function ExpenditureTrajectoryPage() {
  const all = useModulesCopy()
  const m = all.outlook
  const t = m.expenditure
  const { plan, language } = useStore()
  const { months, control } = useHorizon()
  if (!plan) return <><SpendingDashboard /><Notice>{all.common.needsPlan}</Notice></>
  const lines = plan.expenses ?? []
  const total = addMoney('0.00', ...lines.map((line) => line.monthly))
  return (
    <>
      <SpendingDashboard />
      <Panel title={t.byLine}>
        <p className="text-muted">{t.what}</p>
        <Table
          caption={t.byLine}
          head={[t.byLine, m.spending, t.share, ' ']}
          rows={lines.map((line) => [line.label, formatMoney(line.monthly), `${Math.round(share(line.monthly, total) * 100)}%`, line.essential ? t.essential : t.flexible])}
        />
      </Panel>
      <WithProjection>
        {(_plan, result) => (
          <Panel title={m.spending} aside={control}>
            <Table caption={m.spending} head={[m.month, m.spending, m.loans]} rows={monthlyRows(result, months).map((r) => [monthLabelLong(r.month, language), formatMoney(r.expenses), formatMoney(r.commitments)])} />
            <Notice>{m.fromPlanner}</Notice>
          </Panel>
        )}
      </WithProjection>
    </>
  )
}

type Sign = 'add' | 'subtract' | 'ignore'
const FLOWS = ['income', 'expenses', 'commitments', 'one_offs'] as const

export function CustomTrajectoryPage() {
  const m = useModulesCopy().outlook
  const t = m.custom
  const { language } = useStore()
  const { months, control } = useHorizon()
  const [signs, setSigns] = useState<Record<(typeof FLOWS)[number], Sign>>({ income: 'add', expenses: 'subtract', commitments: 'subtract', one_offs: 'ignore' })
  const labels: Record<(typeof FLOWS)[number], string> = { income: m.income, expenses: m.spending, commitments: m.loans, one_offs: m.oneOffs }
  const chosen = FLOWS.some((flow) => signs[flow] !== 'ignore')
  return (
    <WithProjection>
      {(_plan, result) => {
        const rows = monthlyRows(result, months)
        const net = (row: MonthRow) =>
          FLOWS.reduce((sum, flow) => {
            const value = toPaise(row[flow])
            return signs[flow] === 'add' ? sum + value : signs[flow] === 'subtract' ? sum - value : sum
          }, 0n)
        const total = rows.reduce((sum, row) => sum + net(row), 0n)
        return (
          <Panel title={t.what} aside={control}>
            <div className="grid gap-3 sm:grid-cols-4">
              {FLOWS.map((flow) => (
                <SelectField
                  key={flow}
                  label={labels[flow]}
                  value={signs[flow]}
                  onChange={(sign: Sign) => setSigns((current) => ({ ...current, [flow]: sign }))}
                  options={[
                    { value: 'add', label: t.add },
                    { value: 'subtract', label: t.subtract },
                    { value: 'ignore', label: t.ignore },
                  ]}
                />
              ))}
            </div>
            {chosen ? (
              <>
                <p className="flex items-baseline justify-between gap-3 rounded-xl bg-brand px-4 py-3 text-white" aria-live="polite">
                  <span>{t.result}</span>
                  <span className="font-figures text-[24px] font-semibold">{formatMoney(fromPaise(total))}</span>
                </p>
                <Table
                  caption={t.what}
                  head={[m.month, ...FLOWS.filter((flow) => signs[flow] !== 'ignore').map((flow) => `${signs[flow] === 'add' ? '+' : '−'} ${labels[flow]}`), t.result]}
                  rows={rows.map((row) => [monthLabelLong(row.month, language), ...FLOWS.filter((flow) => signs[flow] !== 'ignore').map((flow) => formatMoney(row[flow])), formatMoney(fromPaise(net(row)))])}
                />
              </>
            ) : (
              <Notice>{t.incomplete}</Notice>
            )}
            <Notice>{m.fromPlanner}</Notice>
          </Panel>
        )
      }}
    </WithProjection>
  )
}

export function GoalFeasibilityPage() {
  const m = useModulesCopy().outlook
  const t = m.feasibility
  const { text, language } = useStore()
  return (
    <WithProjection>
      {(plan, result) => (
        <Panel title={t.what}>
          <Table
            caption={t.what}
            head={[t.goal, t.date, t.status, t.shortfall, t.average, t.needed, t.crowded]}
            rows={result.goals.map((goal) => [
              goalNameById(text, plan, goal.goal_id),
              monthLabelLong(goal.target_date, language),
              <span key={goal.goal_id} className={`font-semibold ${toneOf(goal) === 'late' ? 'text-late' : 'text-ontime'}`}>{statusText(text, goal)}</span>,
              formatMoney(goal.shortfall_at_deadline_today),
              formatMoney(goal.average_monthly_contribution),
              formatMoney(goal.required_monthly_level_standalone),
              goal.crowded_out_by.length ? goal.crowded_out_by.map((entry) => goalNameById(text, plan, entry.goal_id)).join(', ') : t.none,
            ])}
          />
          <Notice>{m.fromPlanner}</Notice>
        </Panel>
      )}
    </WithProjection>
  )
}

export function ScenarioComparisonPage() {
  const all = useModulesCopy()
  const extras = useExtrasCopy().scenarios
  const m = all.outlook
  const t = m.scenarios
  const { plan, text } = useStore()
  const [amount, setAmount] = useState('')
  const scenarios = useMemo(() => {
    if (!plan) return []
    const list: { label: string; scenario: Scenario }[] = [
      { label: t.baseline, scenario: { name: 'Baseline', extra_monthly_savings: '0.00' } },
    ]
    const income = ownScenario(plan, 'no_income', '')
    if (income) list.push({ label: t.noIncome, scenario: income })
    const expense = ownScenario(plan, 'expense', amount)
    if (expense) list.push({ label: t.expense, scenario: expense })
    return list
  }, [plan, amount, t.baseline, t.noIncome, t.expense])
  const key = plan ? JSON.stringify([plan, scenarios.map((s) => s.scenario)]) : null
  const comparison = useRemote(key, (signal) => api.compare(plan as Plan, scenarios.map((s) => s.scenario), signal), 200)
  if (!plan) return <Notice>{all.common.needsPlan}</Notice>
  return (
    <>
    <Panel title={t.what}>
      <div className="max-w-xs">
        <AmountField label={t.expenseAmount} hint={t.expenseHint} value={amount} onChange={setAmount} />
      </div>
      <Loaded remote={comparison}>
        {(result) => (
          <Table
            caption={t.what}
            head={[t.goal, ...scenarios.map((s) => s.label)]}
            rows={plan.goals.map((goal) => [
              goalNameById(text, plan, goal.id),
              ...result.results.map((r, index) => {
                const outcome = r.goals.find((item) => item.goal_id === goal.id)
                if (!outcome) return '–'
                return (
                  <span key={`${goal.id}-${index}`} className={`font-semibold ${toneOf(outcome) === 'late' ? 'text-late' : 'text-ontime'}`}>
                    {outcome.status === 'on_track' ? t.onTime : outcome.status === 'delayed' && outcome.delay_months !== null ? t.late(outcome.delay_months) : t.notReachable}
                  </span>
                )
              }),
            ])}
          />
        )}
      </Loaded>
      <Notice>{m.fromPlanner}</Notice>
    </Panel>
    <Panel title={extras.title}>
      <p>{extras.body}</p>
      <p className="text-muted">{extras.custom}</p>
    </Panel>
    </>
  )
}
