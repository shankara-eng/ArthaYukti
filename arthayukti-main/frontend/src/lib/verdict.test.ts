import { describe, expect, it } from 'vitest'
import type { GoalOutcome, Plan, ProjectionResult } from '../api/types'
import { copy } from '../i18n/copy'
import { describeVerdict } from './verdict'

const plan = {
  goals: [
    { id: 'home', type: 'home', label: 'Home' },
    { id: 'education', type: 'education', label: 'Education' },
    { id: 'old_age', type: 'retirement', label: 'Old age' },
  ],
} as unknown as Plan

function outcome(id: string, status: GoalOutcome['status'], delay: number | null = null): GoalOutcome {
  return { goal_id: id, status, delay_months: delay } as GoalOutcome
}

function result(goals: GoalOutcome[], uncovered = '0.00'): ProjectionResult {
  return {
    goals,
    monthly: [{ uncovered_deficit: uncovered }],
  } as unknown as ProjectionResult
}

const en = copy.en
const hi = copy.hi

describe('describeVerdict', () => {
  const allGood = [outcome('home', 'on_track'), outcome('education', 'on_track'), outcome('old_age', 'on_track')]

  it('says the plan is on time when nothing changed', () => {
    const verdict = describeVerdict(result(allGood), plan, en, 'normal')
    expect(verdict.tone).toBe('good')
    expect(verdict.title).toBe('You’re on time.')
  })

  it('says it is still on time after a what-if that changes nothing', () => {
    const verdict = describeVerdict(result(allGood), plan, en, 'expense')
    expect(verdict.tone).toBe('good')
    expect(verdict.title).toBe('Still on time.')
  })

  it('names the one goal that waits and how long', () => {
    const goals = [outcome('home', 'delayed', 9), outcome('education', 'on_track'), outcome('old_age', 'on_track')]
    const verdict = describeVerdict(result(goals), plan, en, 'expense')
    expect(verdict.tone).toBe('late')
    expect(verdict.title).toBe('Home waits 9 months.')
    expect(verdict.body).toBe('The other 2 jars stay on time.')
  })

  it('says a goal is out of reach when it never completes', () => {
    const goals = [outcome('home', 'not_achievable'), outcome('education', 'on_track'), outcome('old_age', 'on_track')]
    expect(describeVerdict(result(goals), plan, en, 'expense').title).toBe('Home is out of reach.')
  })

  it('counts the late goals when there are several', () => {
    const goals = [outcome('home', 'delayed', 3), outcome('education', 'delayed', 2), outcome('old_age', 'on_track')]
    expect(describeVerdict(result(goals), plan, en, 'no_income').title).toBe('2 dreams run late.')
  })

  it('warns first when savings run out', () => {
    const verdict = describeVerdict(result(allGood, '25000.00'), plan, en, 'no_income')
    expect(verdict.tone).toBe('late')
    expect(verdict.title).toBe('Your savings run out.')
    expect(verdict.body).toContain('₹25,000')
  })

  it('speaks Hindi with the same logic', () => {
    const goals = [outcome('home', 'delayed', 9), outcome('education', 'on_track'), outcome('old_age', 'on_track')]
    expect(describeVerdict(result(goals), plan, hi, 'expense').title).toBe('घर 9 महीने रुकेगा।')
    expect(describeVerdict(result(allGood), plan, hi, 'normal').title).toBe('सपने समय पर पूरे होंगे।')
  })
})
