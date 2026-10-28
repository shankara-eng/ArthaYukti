import type { Plan, ProjectionResult } from '../api/types'
import type { Copy } from '../i18n/copy'
import { formatMoney } from './money'
import { goalNameById, hasUncovered, totalUncovered, type Tone } from './outcome'
import type { Choice } from './scenarios'

export interface Verdict {
  tone: Tone
  title: string
  body: string
}

/** One sentence about how things stand, written from the engine's result. */
export function describeVerdict(
  result: ProjectionResult,
  plan: Plan,
  text: Copy,
  choice: Choice,
): Verdict {
  const late = result.goals.filter((goal) => goal.status !== 'on_track')

  if (hasUncovered(result)) {
    return {
      tone: 'late',
      title: text.verdict.deficitTitle,
      body: text.verdict.deficitBody(formatMoney(totalUncovered(result))),
    }
  }

  if (late.length === 0) {
    return choice === 'normal'
      ? { tone: 'good', title: text.verdict.allOnTime, body: text.verdict.allOnTimeBody }
      : { tone: 'good', title: text.verdict.stillOnTime, body: text.verdict.stillOnTimeBody }
  }

  if (late.length === 1) {
    const [only] = late
    return {
      tone: 'late',
      title: text.verdict.oneLateTitle(goalNameById(text, plan, only.goal_id), only.delay_months),
      body: text.verdict.oneLateBody(result.goals.length - 1),
    }
  }

  return {
    tone: 'late',
    title: text.verdict.manyLateTitle(late.length),
    body: text.verdict.manyLateBody,
  }
}
