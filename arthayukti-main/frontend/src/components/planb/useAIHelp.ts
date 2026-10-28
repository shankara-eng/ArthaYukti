import { useEffect, useState } from 'react'
import { ApiFailure, api } from '../../api/client'
import type { SituationDraft } from '../../api/types'
import type { PlanBDraft } from '../../lib/planb'

/** Whether the server has AI help switched on. `unknown` until it answers; a failure counts as off. */
export function useAIStatus(): 'unknown' | 'on' | 'off' {
  const [state, setState] = useState<'unknown' | 'on' | 'off'>('unknown')
  useEffect(() => {
    const controller = new AbortController()
    api
      .aiStatus(controller.signal)
      .then((s) => setState(s.available ? 'on' : 'off'))
      .catch(() => {
        if (!controller.signal.aborted) setState('off')
      })
    return () => controller.abort()
  }, [])
  return state
}

export function failureText(error: unknown, words: Record<string, string>): string {
  return (error instanceof ApiFailure && words[error.code]) || words.generic
}

const plain = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(Math.round(Number(value))))

/** Puts only what the model found into the form. Anything it left empty stays as the person had it. */
export function applyDraft(draft: PlanBDraft, found: SituationDraft): PlanBDraft {
  const next = { ...draft }
  if (found.disruption) next.disruption = found.disruption
  if (found.start_month) {
    next.disruptionStart = found.start_month
    // The modelled window must include the month the change begins.
    if (found.start_month < next.startMonth) next.startMonth = found.start_month
  }
  if (found.duration_months) {
    next.durationKnown = true
    next.durationMonths = String(found.duration_months)
  }
  if (found.income_before != null) next.incomeBefore = plain(found.income_before)
  if (found.income_during != null) next.reducedIncome = plain(found.income_during)
  if (found.new_monthly_cost != null) next.newCost = plain(found.new_monthly_cost)
  if (found.cash_available != null) next.liquidCash = plain(found.cash_available)
  return next
}

