import type { GoalOutcome, Plan, ProjectionResult } from '../api/types'
import { formatMoney, isZero } from '../lib/money'
import { monthLabel } from '../lib/months'
import {
  contributionInFirstMonth,
  goalNameById,
  isReadyNow,
  jarLevel,
  readyLine,
  statusText,
  toneOf,
} from '../lib/outcome'
import { useStore } from '../state/useStore'
import { Jar } from './Jar'

interface GoalCardProps {
  plan: Plan
  result: ProjectionResult
  outcome: GoalOutcome
}

export function GoalCard({ plan, result, outcome }: GoalCardProps) {
  const { text, language } = useStore()
  const tone = toneOf(outcome)
  const name = goalNameById(text, plan, outcome.goal_id)
  const monthly = contributionInFirstMonth(result, outcome.goal_id)
  const monthlyLine = !isZero(monthly)
    ? text.status.perMonth(formatMoney(monthly))
    : isReadyNow(result, outcome)
      ? text.dreamsSetup.alreadyFull
      : text.status.paused

  return (
    <article
      className={`flex min-w-0 flex-col gap-4 rounded-3xl border bg-paper p-6 shadow-card ${
        tone === 'late' ? 'border-late' : 'border-line'
      }`}
    >
      <h3 className="font-display text-[24px] leading-[1.15] font-semibold">{name}</h3>
      <div className="flex items-center gap-4">
        <Jar level={jarLevel(outcome)} tone={tone} label={`${name}: ${statusText(text, outcome)}`} />
        <div className="min-w-0 flex-1 font-semibold">
          <p>{formatMoney(outcome.target_amount_today)}</p>
          <p className={tone === 'late' ? 'text-late' : 'text-ontime'}>{statusText(text, outcome)}</p>
        </div>
      </div>
      <div>
        <p>{readyLine(text, language, result, outcome)}</p>
        <p>{monthlyLine}</p>
        <p>{text.status.needed(monthLabel(outcome.target_date, language))}</p>
      </div>
    </article>
  )
}

export function GoalGrid({ plan, result }: { plan: Plan; result: ProjectionResult }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {result.goals.map((outcome) => (
        <GoalCard key={outcome.goal_id} plan={plan} result={result} outcome={outcome} />
      ))}
    </div>
  )
}
