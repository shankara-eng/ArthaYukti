import type { Goal, Plan, TradeoffOutcome, TradeoffRow } from '../api/types'
import type { Copy } from '../i18n/copy'
import { addMonths } from './months'
import { share, subMoney } from './money'
import type { Tone } from './outcome'

export function outcomeTone(outcome: TradeoffOutcome): Tone {
  return outcome.status === 'on_track' ? 'good' : 'late'
}

/** Delay is only meaningful for a goal that is late; a missing or zero delay means none. */
export function lateMonths(outcome: TradeoffOutcome): number | null {
  return outcome.status === 'delayed' ? (outcome.delay_months ?? null) : null
}

export function outcomeStatusText(text: Copy, outcome: TradeoffOutcome): string {
  if (outcome.status === 'on_track') return text.status.onTime
  const months = lateMonths(outcome)
  return months === null ? text.status.notReachable : text.status.late(months)
}

/** How full the jar is at the deadline: what was saved, in today's money, against the target. */
export function outcomeJarLevel(outcome: TradeoffOutcome, goal: Goal | undefined): number {
  if (outcome.status === 'on_track') return 1
  if (!goal) return 0
  return share(subMoney(goal.target_amount_today, outcome.shortfall_today), goal.target_amount_today)
}

export function currentOrder(plan: Plan): string[] {
  return [...plan.goals].sort((a, b) => a.priority - b.priority).map((goal) => goal.id)
}

export function isCurrentOrder(plan: Plan, row: TradeoffRow): boolean {
  const current = currentOrder(plan)
  return (
    row.priority_order.length === current.length &&
    row.priority_order.every((id, index) => id === current[index])
  )
}

/**
 * The rows with the fewest dreams missed and, among those, the least total delay. Nothing is
 * marked when every row comes out the same, because then no order is better than another.
 */
export function leastDelayRows(rows: TradeoffRow[]): Set<string> {
  const compare = (a: TradeoffRow, b: TradeoffRow) =>
    a.totals.goals_missed - b.totals.goals_missed ||
    a.totals.total_delay_months - b.totals.total_delay_months
  const best = [...rows].sort(compare)[0]
  if (!best) return new Set()
  const winners = rows.filter((row) => compare(row, best) === 0)
  return winners.length === rows.length
    ? new Set()
    : new Set(winners.map((row) => row.prioritised_goal_id))
}

export type ImpactKind = 'brought_on_time' | 'newly_late' | 'longer' | 'shorter' | 'unchanged'

export interface GoalImpact {
  goalId: string
  kind: ImpactKind
  before: TradeoffOutcome
  after: TradeoffOutcome
  /** Change in months late. Null when either side is not reachable, so no number is made up. */
  deltaMonths: number | null
}

export function outcomeFor(row: TradeoffRow, goalId: string): TradeoffOutcome | undefined {
  return row.outcomes.find((outcome) => outcome.goal_id === goalId)
}

/** Sorts what changes between two orders, in the plan's current goal order. */
export function compareRows(plan: Plan, before: TradeoffRow, after: TradeoffRow): GoalImpact[] {
  return currentOrder(plan).flatMap((goalId) => {
    const was = outcomeFor(before, goalId)
    const now = outcomeFor(after, goalId)
    if (!was || !now) return []
    const wasLate = was.status !== 'on_track'
    const nowLate = now.status !== 'on_track'
    const wasMonths = lateMonths(was)
    const nowMonths = lateMonths(now)
    let kind: ImpactKind = 'unchanged'
    let deltaMonths: number | null = null
    if (wasLate && !nowLate) kind = 'brought_on_time'
    else if (!wasLate && nowLate) kind = 'newly_late'
    else if (wasLate && nowLate) {
      if (wasMonths !== null && nowMonths !== null) {
        deltaMonths = nowMonths - wasMonths
        kind = deltaMonths > 0 ? 'longer' : deltaMonths < 0 ? 'shorter' : 'unchanged'
      } else if (was.status !== now.status) {
        kind = now.status === 'not_achievable' ? 'longer' : 'shorter'
      }
    }
    return [{ goalId, kind, before: was, after: now, deltaMonths }]
  })
}

/** The month a goal is reached: its target date plus the delay the engine reported. */
export function reachedMonth(goal: Goal, outcome: TradeoffOutcome): string | null {
  if (outcome.status === 'on_track') return goal.target_date
  const months = lateMonths(outcome)
  return months === null ? null : addMonths(goal.target_date, months)
}

/** Starts the screen on a goal that waits today, so a first look already shows a change. */
export function suggestedGoal(plan: Plan, baseline: TradeoffRow | undefined): string | null {
  const order = currentOrder(plan)
  const late = baseline
    ? order.find((id) => {
        const outcome = outcomeFor(baseline, id)
        return outcome !== undefined && outcome.status !== 'on_track'
      })
    : undefined
  return late ?? order.at(-1) ?? null
}
