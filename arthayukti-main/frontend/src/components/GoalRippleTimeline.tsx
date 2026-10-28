import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck } from 'lucide-react'
import type { Goal, Plan } from '../api/types'
import { goalIcon } from '../lib/goalIcon'
import { goalName } from '../lib/outcome'
import { monthLabel, monthToIndex } from '../lib/months'
import {
  outcomeStatusText,
  outcomeTone,
  reachedMonth,
  type GoalImpact,
} from '../lib/tradeoffs'
import { useStore } from '../state/useStore'

interface Props {
  plan: Plan
  /** One entry per goal. When `compared` is false, only the "now" markers are drawn. */
  impacts: GoalImpact[]
  compared: boolean
}

interface Lane {
  impact: GoalImpact
  goal: Goal
  target: number
  now: number | null
  next: number | null
}

/**
 * One lane per goal on a shared month axis: the target date, where the goal is reached today,
 * and where it would be reached with the chosen goal first. Positions come from the engine's
 * delay figures; nothing is calculated here beyond placing markers on the axis.
 */
export function GoalRippleTimeline({ plan, impacts, compared }: Props) {
  const { text, language } = useStore()
  const copy = text.tradeoffs
  const start = monthToIndex(plan.as_of)

  const lanes: Lane[] = impacts.flatMap((impact) => {
    const goal = plan.goals.find((item) => item.id === impact.goalId)
    if (!goal) return []
    const now = reachedMonth(goal, impact.before)
    const next = reachedMonth(goal, impact.after)
    return [
      {
        impact,
        goal,
        target: monthToIndex(goal.target_date),
        now: now === null ? null : monthToIndex(now),
        next: next === null ? null : monthToIndex(next),
      },
    ]
  })

  const last = Math.max(start + 1, ...lanes.flatMap((lane) => [lane.target, lane.now ?? 0, lane.next ?? 0]))
  const place = (index: number) => `${((index - start) / (last - start)) * 100}%`
  const years = Array.from(
    new Set(Array.from({ length: last - start + 1 }, (_, step) => Math.floor((start + step) / 12))),
  )

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-muted" aria-label={copy.timelineTitle}>
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rotate-45 border-2 border-ink" aria-hidden="true" />
          {copy.legendTarget}
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block size-4 rounded-full border-2 border-ink bg-paper" aria-hidden="true" />
          {copy.legendNow}
        </li>
        {compared ? (
          <li className="flex items-center gap-2">
            <span className="inline-block size-4 rounded-full bg-ink" aria-hidden="true" />
            {copy.legendIfFirst}
          </li>
        ) : null}
      </ul>

      <ol className="flex flex-col gap-5">
        {lanes.map((lane) => {
          const Icon = goalIcon(lane.goal)
          const name = goalName(text, lane.goal)
          const changed = compared && lane.impact.kind !== 'unchanged'
          const from = lane.now
          const to = compared ? lane.next : null
          const lo = Math.min(from ?? last, to ?? from ?? last)
          const hi = Math.max(from ?? last, to ?? from ?? last)
          const movedLater = compared && from !== null && to !== null ? to > from : lane.impact.kind === 'longer' || lane.impact.kind === 'newly_late'
          return (
            <li key={lane.goal.id} className="grid gap-2 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center sm:gap-4">
              <div className="flex items-center gap-2 font-semibold">
                <Icon size={20} aria-hidden="true" />
                <span className="min-w-0">{name}</span>
              </div>
              <div>
                <div className="relative h-10 px-3">
                  <div className="absolute inset-x-3 top-1/2 h-px bg-line" aria-hidden="true" />
                  <div className="relative h-full">
                    {changed && from !== null && to !== null ? (
                      <div
                        aria-hidden="true"
                        className={`ripple-move absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${
                          movedLater ? 'bg-late/40' : 'bg-ontime/40'
                        }`}
                        style={{ left: place(lo), width: `calc(${place(hi)} - ${place(lo)})` }}
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="ripple-move absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-ink bg-cream"
                      style={{ left: place(lane.target) }}
                    />
                    {from !== null ? (
                      <Marker left={place(from)} outline tone={outcomeTone(lane.impact.before)} />
                    ) : null}
                    {compared && to !== null ? (
                      <Marker left={place(to)} tone={outcomeTone(lane.impact.after)} emphasised={changed} />
                    ) : null}
                  </div>
                </div>
                <p className="text-[15px]">
                  <StatusLine label={copy.laneNow(outcomeStatusText(text, lane.impact.before))} month={lane.now} language={language} bad={outcomeTone(lane.impact.before) === 'late'} />
                  {compared ? (
                    <>
                      {' '}
                      <span className="text-muted" aria-hidden="true">
                        {movedLater ? <ArrowRight size={14} className="inline" /> : <ArrowLeft size={14} className="inline" />}
                      </span>{' '}
                      <StatusLine label={copy.laneIfFirst(outcomeStatusText(text, lane.impact.after))} month={lane.next} language={language} bad={outcomeTone(lane.impact.after) === 'late'} strong={changed} />
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex justify-between border-t border-line pt-1 text-[14px] text-muted" aria-hidden="true">
        {years.map((year) => (
          <span key={year}>{year}</span>
        ))}
      </div>
    </div>
  )
}

function Marker({
  left,
  tone,
  outline,
  emphasised,
}: {
  left: string
  tone: 'good' | 'late'
  outline?: boolean
  emphasised?: boolean
}) {
  const Icon = tone === 'good' ? CircleCheck : CircleAlert
  const colour = tone === 'good' ? 'text-ontime' : 'text-late'
  return (
    <span
      aria-hidden="true"
      className={`ripple-move absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ${
        outline ? 'size-6 border-2 border-ink bg-paper' : 'size-7 bg-ink'
      } ${emphasised ? 'ring-4 ring-turmeric/40' : ''}`}
      style={{ left }}
    >
      <Icon size={outline ? 14 : 18} className={outline ? colour : 'text-cream'} />
    </span>
  )
}

function StatusLine({
  label,
  month,
  language,
  bad,
  strong,
}: {
  label: string
  month: number | null
  language: 'en' | 'hi'
  bad: boolean
  strong?: boolean
}) {
  const when =
    month === null
      ? ''
      : ` (${monthLabel(`${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`, language)})`
  return (
    <span className={`${strong ? 'font-semibold' : ''} ${bad ? 'text-late' : 'text-ontime'}`}>
      {label}
      {when}
    </span>
  )
}
