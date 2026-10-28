import { describe, expect, it } from 'vitest'
import stretched from '../../../contracts/samples/family_stretched.json'
import type { Plan, TradeoffResult } from '../api/types'
import fixture from '../test/tradeoffs.fixture.json'
import {
  compareRows,
  currentOrder,
  isCurrentOrder,
  leastDelayRows,
  outcomeJarLevel,
  reachedMonth,
  suggestedGoal,
} from './tradeoffs'

// The sample file predates the optional `essential` flag on expenses.
const plan = stretched.plan as unknown as Plan
const result = fixture as TradeoffResult

describe('trade-off helpers', () => {
  it('reads the current order from the goal priorities', () => {
    expect(currentOrder(plan)).toEqual(['emergency', 'education', 'home'])
  })

  it('finds the row that matches the current order', () => {
    const now = result.rows.filter((row) => isCurrentOrder(plan, row))
    expect(now.map((row) => row.prioritised_goal_id)).toEqual(['emergency'])
  })

  it('marks every row with the least total delay, and says nothing when all rows match', () => {
    expect([...leastDelayRows(result.rows)].sort()).toEqual(['education', 'emergency'])
    const same = result.rows.map((row) => ({ ...row, totals: result.rows[0].totals }))
    expect(leastDelayRows(same).size).toBe(0)
  })

  it('counts a missed goal before delay when picking the least', () => {
    const rows = [
      { ...result.rows[0], prioritised_goal_id: 'a', totals: { ...result.rows[0].totals, goals_missed: 2, total_delay_months: 1 } },
      { ...result.rows[0], prioritised_goal_id: 'b', totals: { ...result.rows[0].totals, goals_missed: 1, total_delay_months: 40 } },
    ]
    expect([...leastDelayRows(rows)]).toEqual(['b'])
  })

  it('fills a late jar by what was saved against the target', () => {
    const home = result.rows[0].outcomes.find((outcome) => outcome.goal_id === 'home')!
    const goal = plan.goals.find((item) => item.id === 'home')
    expect(outcomeJarLevel(home, goal)).toBe(0.875)
    expect(outcomeJarLevel(result.rows[2].outcomes[2], goal)).toBe(1)
  })

  it('sorts what changes when home goes first', () => {
    const impacts = compareRows(plan, result.rows[0], result.rows[2])
    const kinds = Object.fromEntries(impacts.map((impact) => [impact.goalId, impact.kind]))
    expect(kinds).toEqual({ emergency: 'newly_late', education: 'newly_late', home: 'brought_on_time' })
  })

  it('reports a change in delay only when both sides give a number', () => {
    const later = { ...result.rows[2], outcomes: result.rows[2].outcomes.map((o) => (o.goal_id === 'home' ? { ...o, status: 'delayed' as const, delay_months: 9 } : o)) }
    const [, , home] = compareRows(plan, result.rows[0], later)
    expect(home).toMatchObject({ goalId: 'home', kind: 'longer', deltaMonths: 4 })
    const gone = { ...later, outcomes: later.outcomes.map((o) => (o.goal_id === 'home' ? { ...o, status: 'not_achievable' as const, delay_months: null } : o)) }
    expect(compareRows(plan, result.rows[0], gone)[2]).toMatchObject({ kind: 'longer', deltaMonths: null })
  })

  it('places a goal at its target plus the engine delay', () => {
    const home = plan.goals.find((goal) => goal.id === 'home')!
    expect(reachedMonth(home, result.rows[0].outcomes[2])).toBe('2032-05')
    expect(reachedMonth(home, result.rows[2].outcomes[2])).toBe('2031-12')
  })

  it('starts on the first goal that waits today', () => {
    expect(suggestedGoal(plan, result.rows[0])).toBe('home')
    expect(suggestedGoal(plan, undefined)).toBe('home')
  })
})
