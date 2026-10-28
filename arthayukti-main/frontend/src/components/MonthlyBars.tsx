import type { Plan, ProjectionResult } from '../api/types'
import { formatMoney, isGreater, isZero, share } from '../lib/money'
import { goalNameById, usualRow } from '../lib/outcome'
import { useStore } from '../state/useStore'
import { Card, CardTitle } from './Cards'

interface Bar {
  key: string
  label: string
  amount: string
  color: string
}

/** Where the first month's money goes: spending, then each dream. */
export function MonthlyBars({ plan, result }: { plan: Plan; result: ProjectionResult }) {
  const { text } = useStore()
  const month = usualRow(result)
  if (!month) return null

  const contributions = month.goals
    .filter((goal) => !isZero(goal.contribution))
    .map((goal) => ({ id: goal.goal_id, amount: goal.contribution }))
  const largest = contributions.reduce(
    (best, item) => (best === null || share(item.amount, month.income) > share(best.amount, month.income) ? item : best),
    null as { id: string; amount: string } | null,
  )

  const bars: Bar[] = [
    { key: 'spending', label: text.plan.living, amount: month.expenses, color: 'bg-sand' },
    ...contributions.map((item) => ({
      key: item.id,
      label: goalNameById(text, plan, item.id),
      amount: item.amount,
      color: item.id === largest?.id ? 'bg-turmeric' : 'bg-bar',
    })),
  ]

  // Like the design, bars are drawn against the biggest amount so the small ones stay readable.
  const biggest = bars.reduce((best, bar) => (isGreater(bar.amount, best) ? bar.amount : best), '0.00')

  return (
    <Card>
      <CardTitle>{text.plan.chartTitle}</CardTitle>
      {bars.map((bar) => (
        <div key={bar.key} className="flex flex-col gap-2">
          <p>
            {bar.label} · {formatMoney(bar.amount)}
          </p>
          <div className="h-4 w-full rounded-lg bg-cream" aria-hidden="true">
            <div
              className={`h-4 rounded-lg ${bar.color}`}
              style={{ width: `${Math.max(2, share(bar.amount, biggest) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <p className="text-muted">{text.plan.barsNote(formatMoney(month.income))}</p>
    </Card>
  )
}
