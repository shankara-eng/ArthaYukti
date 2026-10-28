import { useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  Minus,
  TriangleAlert,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api/client'
import type { Plan, TradeoffResult, TradeoffRow } from '../api/types'
import { Card, CardTitle, PageHeading } from '../components/Cards'
import { GoalRippleTimeline } from '../components/GoalRippleTimeline'
import { Await } from '../components/Status'
import { Layout } from '../components/Layout'
import { goalIcon } from '../lib/goalIcon'
import { householdName } from '../lib/household'
import { formatMoney } from '../lib/money'
import { monthLabelLong } from '../lib/months'
import { goalNameById, usualRow } from '../lib/outcome'
import {
  compareRows,
  currentOrder,
  isCurrentOrder,
  suggestedGoal,
  type GoalImpact,
  type ImpactKind,
} from '../lib/tradeoffs'
import { useRemote } from '../state/useRemote'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

const EDIT_DELAY_MS = 200

export function TradeoffsPage({ navigate }: PageProps) {
  const { text, plan, situation, activeChoice: choice, projection, previousOrder, undoOrder } = useStore()
  const copy = text.tradeoffs

  const key = plan ? JSON.stringify([plan, situation]) : null
  const remote = useRemote<TradeoffResult>(
    key,
    (signal) => api.tradeoffs(plan as Plan, situation, signal),
    EDIT_DELAY_MS,
  )

  return (
    <Layout route="tradeoffs" navigate={navigate} speak={`${copy.title} ${copy.subtitle}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle} />
      {previousOrder ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-sand px-4 py-3">
          <span className="flex-1">{copy.undoNote}</span>
          <button type="button" onClick={undoOrder} className="flex min-h-11 items-center gap-2 rounded-xl border border-ink px-4 font-semibold">
            <Undo2 size={18} aria-hidden="true" />
            {copy.undo}
          </button>
        </div>
      ) : null}
      {remote.error === 'not_implemented' ? (
        <Card>
          <p role="alert">{copy.unavailable}</p>
        </Card>
      ) : (
        <Await remote={remote}>
          {(result) =>
            plan ? (
              <Lab
                key={JSON.stringify(plan.goals.map((goal) => goal.id))}
                plan={plan}
                result={result}
                choiceLabel={
                  choice === 'no_income'
                    ? text.whatIf.noIncome
                    : choice === 'expense'
                      ? text.whatIf.expense
                      : text.whatIf.normal
                }
                surplus={projection.data ? usualRow(projection.data)?.surplus : undefined}
                navigate={navigate}
              />
            ) : null
          }
        </Await>
      )}
    </Layout>
  )
}

interface LabProps {
  plan: Plan
  result: TradeoffResult
  choiceLabel: string
  surplus: string | undefined
  navigate: PageProps['navigate']
}

const IMPACT_ROWS: { kind: ImpactKind; icon: LucideIcon; label: 'broughtOnTime' | 'newlyLate' | 'longer' | 'shorter' | 'unchanged'; tone: string }[] = [
  { kind: 'brought_on_time', icon: CircleCheck, label: 'broughtOnTime', tone: 'text-ontime' },
  { kind: 'newly_late', icon: TriangleAlert, label: 'newlyLate', tone: 'text-late' },
  { kind: 'longer', icon: ArrowUpRight, label: 'longer', tone: 'text-late' },
  { kind: 'shorter', icon: ArrowDownRight, label: 'shorter', tone: 'text-ontime' },
  { kind: 'unchanged', icon: Minus, label: 'unchanged', tone: 'text-muted' },
]

function Lab({ plan, result, choiceLabel, surplus, navigate }: LabProps) {
  const { text, language, sample, situation, applyOrder } = useStore()
  const copy = text.tradeoffs
  const name = (id: string) => goalNameById(text, plan, id)

  const baseline = result.rows.find((row) => isCurrentOrder(plan, row))
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const selectedId = picked === undefined ? suggestedGoal(plan, baseline) : picked
  const selected = result.rows.find((row) => row.prioritised_goal_id === selectedId)
  const compared = Boolean(baseline && selected)
  const isSame = selected !== undefined && selected === baseline

  if (!baseline) {
    // The answer does not match the goals on screen, so show nothing made up.
    return (
      <Card>
        <p role="alert">{text.common.tryAgain}</p>
      </Card>
    )
  }
  const impacts = compareRows(plan, baseline, selected ?? baseline)
  const order = currentOrder(plan)
  const live = <span>{copy.live}</span>

  const choose = (id: string) => {
    setPicked(id)
    setConfirming(false)
  }

  return (
    <>
      <ContextStrip
        plan={plan}
        label={householdName(text, sample, plan)}
        sampleTag={sample ? copy.sample : null}
        surplus={surplus}
        situation={choiceLabel}
        live={live}
      />

      <section aria-labelledby="pick-title" className="flex flex-col gap-3">
        <h2 id="pick-title" className="font-display text-[22px] leading-tight font-semibold">
          {copy.pickTitle}
        </h2>
        <div role="radiogroup" aria-labelledby="pick-title" className="flex flex-wrap gap-2">
          {order.map((id, index) => {
            const goal = plan.goals.find((item) => item.id === id)
            if (!goal) return null
            const Icon = goalIcon(goal)
            const active = selectedId === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(id)}
                className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left transition-colors motion-reduce:transition-none ${
                  active ? 'border-turmeric bg-paper shadow-card' : 'border-line bg-paper hover:border-ink/40'
                }`}
              >
                <Icon size={22} aria-hidden="true" />
                <span>
                  <span className="block font-semibold">{name(id)}</span>
                  <span className="block text-[14px] text-muted">
                    {index === 0 ? copy.firstNow : copy.rank(index + 1)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="stage">
          <CardTitle>{copy.timelineTitle}</CardTitle>
          <p className="text-[15px] text-muted">{copy.timelineNote}</p>
          {compared ? (
            isSame ? <p className="font-semibold">{copy.sameAsNow}</p> : null
          ) : (
            <p>{copy.pickPrompt}</p>
          )}
          <GoalRippleTimeline plan={plan} impacts={impacts} compared={compared} />
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle>{copy.impactTitle}</CardTitle>
            <ul className="flex flex-col gap-3">
              {IMPACT_ROWS.map(({ kind, icon: Icon, label, tone }) => {
                const items = impacts.filter((impact) => impact.kind === kind)
                return (
                  <li key={kind} className="flex gap-3">
                    <Icon size={20} aria-hidden="true" className={`mt-1 shrink-0 ${tone}`} />
                    <div>
                      <p className="font-semibold">{copy[label]}</p>
                      <p className="text-muted">
                        {items.length === 0
                          ? copy.nothing
                          : items.map((impact) => impactText(impact, name(impact.goalId), copy.byMonths)).join(', ')}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          {selected && !isSame ? <Totals baseline={baseline} selected={selected} /> : null}
        </div>
      </div>

      {selected && !isSame ? (
        <Card>
          <CardTitle>{copy.receiptTitle}</CardTitle>
          <p>{receipt(copy, name(selected.prioritised_goal_id), impacts, name)}</p>
          <details className="group rounded-2xl bg-cream p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold">
              {copy.howTitle}
              <ChevronDown size={20} aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <ol className="list-decimal pl-5">
                {copy.howSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>{copy.howOrderNow(baseline.priority_order.map(name).join(' → '))}</p>
              <p>{copy.howOrderIfFirst(selected.priority_order.map(name).join(' → '))}</p>
              <div>
                <p className="font-semibold">{copy.assumptionsTitle}</p>
                <ul className="list-disc pl-5 text-muted">
                  <li>{copy.asOf(monthLabelLong(plan.as_of, language))}</li>
                  <li>{copy.inflation(percent(plan.assumptions.general_inflation_annual))}</li>
                  <li>{copy.returns(percent(plan.assumptions.savings_return_annual))}</li>
                  <li>{copy.situation(situation?.name ?? choiceLabel)}</li>
                  <li>{copy.noGrowthNote}</li>
                </ul>
              </div>
            </div>
          </details>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        {selected && !isSame && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="min-h-12 rounded-2xl bg-brand px-6 font-semibold text-white">
            {copy.use}
          </button>
        ) : null}
        {picked !== null && selected ? (
          <button type="button" onClick={() => { setPicked(null); setConfirming(false) }} className="min-h-12 rounded-2xl border border-line bg-paper px-6 font-semibold">
            {copy.reset}
          </button>
        ) : null}
        {selected && selected.totals.goals_missed > 0 ? (
          <button type="button" onClick={() => navigate('fixes')} className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-paper px-6 font-semibold">
            <Wrench size={18} aria-hidden="true" />
            {copy.repair}
          </button>
        ) : null}
        <button type="button" onClick={() => navigate('plan')} className="min-h-12 rounded-2xl px-4 font-semibold underline underline-offset-4">
          {copy.backToPlan}
        </button>
      </div>

      {confirming && selected ? (
        <div role="alertdialog" aria-labelledby="confirm-title" className="flex flex-col gap-3 rounded-3xl border-2 border-turmeric bg-paper p-6">
          <p id="confirm-title" className="font-display text-[22px] font-semibold">
            {copy.confirmTitle(selected.priority_order.map(name).join(' → '))}
          </p>
          <p className="text-muted">{copy.confirmBody}</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                applyOrder(selected.priority_order)
                navigate('plan')
              }}
              className="min-h-12 rounded-2xl bg-brand px-6 font-semibold text-white"
            >
              {copy.confirm}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-12 rounded-2xl border border-line px-6 font-semibold">
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function percent(rate: string | undefined): string {
  return `${(Number(rate ?? '0') * 100).toFixed(1)}%`
}

function impactText(impact: GoalImpact, name: string, byMonths: (months: number) => string): string {
  if ((impact.kind === 'longer' || impact.kind === 'shorter') && impact.deltaMonths !== null) {
    return `${name} ${byMonths(Math.abs(impact.deltaMonths))}`
  }
  if (impact.kind === 'newly_late' && impact.after.delay_months) {
    return `${name} ${byMonths(impact.after.delay_months)}`
  }
  return name
}

function receipt(
  copy: ReturnType<typeof useStore>['text']['tradeoffs'],
  first: string,
  impacts: GoalImpact[],
  name: (id: string) => string,
): string {
  const byKind = (kind: ImpactKind) => impacts.filter((impact) => impact.kind === kind)
  const list = (kind: ImpactKind) =>
    byKind(kind)
      .map((impact) => impactText(impact, name(impact.goalId), copy.byMonths))
      .join(', ')
  const parts = [copy.receiptOpening(first)]
  if (byKind('brought_on_time').length) parts.push(copy.receiptOnTime(list('brought_on_time')))
  if (byKind('newly_late').length) parts.push(copy.receiptNewlyLate(list('newly_late')))
  if (byKind('longer').length) parts.push(copy.receiptLonger(list('longer')))
  if (byKind('shorter').length) parts.push(copy.receiptShorter(list('shorter')))
  if (parts.length === 1) parts.push(copy.receiptNoChange)
  return parts.join(' ')
}

function ContextStrip({
  plan,
  label,
  sampleTag,
  surplus,
  situation,
  live,
}: {
  plan: Plan
  label: string
  sampleTag: string | null
  surplus: string | undefined
  situation: string
  live: React.ReactNode
}) {
  const { text } = useStore()
  const copy = text.tradeoffs
  return (
    <div className="flex flex-col gap-1 rounded-2xl glass px-4 py-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">{label}</span>
        {surplus !== undefined ? <span>{copy.leftEachMonth(formatMoney(surplus))}</span> : null}
        <span>{copy.goalCount(plan.goals.length)}</span>
        <span>{copy.situation(situation)}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 text-[15px] text-muted">
        {sampleTag ? <span>{sampleTag}</span> : null}
        {live}
      </p>
    </div>
  )
}

function Totals({ baseline, selected }: { baseline: TradeoffRow; selected: TradeoffRow }) {
  const { text } = useStore()
  const copy = text.tradeoffs
  const rows: { label: string; now: string; next: string; same: boolean }[] = [
    {
      label: copy.goalsLate,
      now: String(baseline.totals.goals_missed),
      next: String(selected.totals.goals_missed),
      same: baseline.totals.goals_missed === selected.totals.goals_missed,
    },
    {
      label: copy.totalDelay,
      now: copy.months(baseline.totals.total_delay_months),
      next: copy.months(selected.totals.total_delay_months),
      same: baseline.totals.total_delay_months === selected.totals.total_delay_months,
    },
    {
      label: copy.shortfall,
      now: formatMoney(baseline.totals.total_shortfall_today),
      next: formatMoney(selected.totals.total_shortfall_today),
      same: baseline.totals.total_shortfall_today === selected.totals.total_shortfall_today,
    },
  ]
  return (
    <Card>
      <CardTitle>{copy.totalsTitle}</CardTitle>
      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
            <dt className="text-[15px] text-muted">{row.label}</dt>
            <dd className="font-semibold">
              {copy.totalsNow} {row.now} → {copy.totalsIfFirst} {row.next}
              {row.same ? ` • ${copy.same}` : ''}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
