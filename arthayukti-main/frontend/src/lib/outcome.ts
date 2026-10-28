import type { Goal, GoalOutcome, MonthRow, Plan, ProjectionResult } from '../api/types'
import type { Copy } from '../i18n/copy'
import { monthLabel, monthToIndex, type Language } from './months'
import { addMoney, isZero, share } from './money'

export function goalName(text: Copy, goal: Pick<Goal, 'type' | 'label'>): string {
  return text.goalNames[goal.type] ?? goal.label
}

export function goalNameById(text: Copy, plan: Plan, goalId: string): string {
  const goal = plan.goals.find((item) => item.id === goalId)
  return goal ? goalName(text, goal) : goalId
}

export type Tone = 'good' | 'late'

export function toneOf(outcome: GoalOutcome): Tone {
  return outcome.status === 'on_track' ? 'good' : 'late'
}

/** How full the jar looks at the deadline, from 0 to 1. A goal that is on time is full. */
export function jarLevel(outcome: GoalOutcome): number {
  if (outcome.status === 'on_track') return 1
  return share(outcome.balance_at_deadline, outcome.inflated_target_at_deadline)
}

export function statusText(text: Copy, outcome: GoalOutcome): string {
  if (outcome.status === 'on_track') return text.status.onTime
  if (outcome.status === 'delayed' && outcome.delay_months !== null) {
    return text.status.late(outcome.delay_months)
  }
  return text.status.notReachable
}

/** The first month that is not distorted by a one-off cost, so a usual month can be shown. */
export function usualRow(result: ProjectionResult): MonthRow | undefined {
  const rows = result.monthly ?? []
  return rows.find((row) => isZero(row.one_offs)) ?? rows[0]
}

export function contributionInFirstMonth(result: ProjectionResult, goalId: string): string {
  const row = usualRow(result)?.goals.find((goal) => goal.goal_id === goalId)
  return row?.contribution ?? '0.00'
}

export function isReadyNow(result: ProjectionResult, outcome: GoalOutcome): boolean {
  return (
    outcome.status === 'on_track' &&
    outcome.projected_completion !== null &&
    monthToIndex(outcome.projected_completion) <= monthToIndex(result.as_of)
  )
}

export function readyLine(
  text: Copy,
  language: Language,
  result: ProjectionResult,
  outcome: GoalOutcome,
): string {
  if (isReadyNow(result, outcome)) return text.status.readyNow
  if (outcome.projected_completion === null) return text.status.notReachable
  return text.status.readyBy(monthLabel(outcome.projected_completion, language))
}

export function totalUncovered(result: ProjectionResult): string {
  return addMoney('0.00', ...(result.monthly ?? []).map((row) => row.uncovered_deficit))
}

export function hasUncovered(result: ProjectionResult): boolean {
  return !isZero(totalUncovered(result))
}
