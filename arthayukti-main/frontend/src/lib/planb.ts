import type { AgreementDraft, Plan, RecoveryAdjustment, RecoveryInput, RecoverySearchRequest, RestorationRule } from '../api/types'
import { monthlyEquivalent } from './frequency'
import { parseRupeeInput, toPaise } from './money'

/** What the forms hold: text exactly as typed. Nothing is a number until buildSearch turns it into a request. */
export type Disruption = 'income_reduction' | 'income_loss' | 'new_expense'
export type ItemKind = 'essential' | 'mandatory_debt' | 'protected_obligation' | 'flexible' | 'goal_contribution'

export interface ItemDraft {
  id: string
  label: string
  kind: ItemKind
  monthly: string
  protectedGoal: boolean
  balanceId: string
  allowPause: boolean
  maxPause: string
  allowReduce: boolean
  minMonthly: string
}

export interface BalanceDraft {
  id: string
  label: string
  balance: string
}

export interface RestoreDraft {
  incomeAtLeast: string
  cashAtLeast: string
  confirm: boolean
  mode: 'all' | 'steps'
  stepPercents: string
  gap: string
  guard: boolean
}

export interface PlanBDraft {
  disruption: Disruption
  startMonth: string
  months: string
  liquidCash: string
  floor: string
  incomeBefore: string
  reducedIncome: string
  newCost: string
  disruptionStart: string
  durationKnown: boolean
  durationMonths: string
  incomeAfter: string
  items: ItemDraft[]
  balances: BalanceDraft[]
  restore: RestoreDraft
  reviewMonth: string
  maxCandidates: string
  excluded: string[]
}

export type ProblemKey = 'money' | 'months' | 'month' | 'durationBeyond' | 'name' | 'items' | 'steps' | 'pause'
export type Problems = Record<string, ProblemKey>

let counter = 0
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}`

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
export function addMonths(m: string, n: number): string {
  const index = monthIndex(m) + n
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function blankItem(kind: ItemKind = 'flexible'): ItemDraft {
  return {
    id: newId('item'),
    label: '',
    kind,
    monthly: '',
    protectedGoal: true,
    balanceId: '',
    allowPause: false,
    maxPause: '6',
    allowReduce: false,
    minMonthly: '',
  }
}

export function blankPlanB(now = currentMonth()): PlanBDraft {
  return {
    disruption: 'income_reduction',
    startMonth: now,
    months: '12',
    liquidCash: '',
    floor: '',
    incomeBefore: '',
    reducedIncome: '',
    newCost: '',
    disruptionStart: now,
    durationKnown: true,
    durationMonths: '6',
    incomeAfter: '',
    items: [],
    balances: [],
    restore: { incomeAtLeast: '', cashAtLeast: '', confirm: false, mode: 'all', stepPercents: '50,100', gap: '1', guard: true },
    reviewMonth: '',
    maxCandidates: '1500',
    excluded: [],
  }
}

/** A starting point taken from the saved plan. Every figure stays editable, and contribution amounts are left for the person to enter. */
export function prefillFromPlan(plan: Plan, now = currentMonth()): PlanBDraft {
  const draft = blankPlanB(now)
  const income = plan.income_streams.reduce((total, stream) => {
    const monthly =
      toPaise(stream.monthly_net) > 0n
        ? stream.monthly_net
        : stream.amount
          ? monthlyEquivalent(stream.amount, stream.frequency === 'yearly' ? 'yearly' : stream.frequency === 'quarterly' ? 'quarterly' : 'monthly')
          : '0.00'
    return total + toPaise(monthly)
  }, 0n)
  draft.incomeBefore = String(income / 100n)
  draft.liquidCash = plan.unassigned_savings && toPaise(plan.unassigned_savings) > 0n ? plan.unassigned_savings.replace(/\.00$/, '') : ''
  draft.items = [
    ...(plan.expenses ?? []).map((e) => ({ ...blankItem(e.essential ? 'essential' : 'flexible'), label: e.label, monthly: e.monthly.replace(/\.00$/, '') })),
    ...(plan.commitments ?? []).map((c) => ({ ...blankItem('mandatory_debt'), label: c.label, monthly: c.monthly_payment.replace(/\.00$/, '') })),
  ]
  for (const goal of plan.goals) {
    const balanceId = newId('bal')
    if (toPaise(goal.current_savings) > 0n) draft.balances.push({ id: balanceId, label: goal.label, balance: goal.current_savings.replace(/\.00$/, '') })
    draft.items.push({ ...blankItem('goal_contribution'), label: goal.label, balanceId: toPaise(goal.current_savings) > 0n ? balanceId : '' })
  }
  return draft
}

const rupees = (text: string): string | null => {
  const t = text.trim()
  if (t === '') return null
  const value = parseRupeeInput(t)
  if (value === null) return null
  return toPaise(value) <= 100_000_000_000n ? value : null
}

const wholeMonths = (text: string, max = 120): number | null => {
  const t = text.trim()
  if (!/^\d{1,5}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= max ? n : null
}

export const isAdjustable = (item: ItemDraft) => item.kind === 'flexible' || (item.kind === 'goal_contribution' && !item.protectedGoal)

function parseSteps(text: string): number[] | null {
  const parts = text.split(',').map((p) => p.trim())
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.length === 0 || nums.some((n) => !(n >= 1 && n <= 100))) return null
  for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) return null
  return nums
}

function percentOf(amount: string, percent: number): string {
  const paise = (toPaise(amount) * BigInt(percent) + 50n) / 100n
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`
}

export type BuiltSearch = { request: RecoverySearchRequest; problems: null } | { request: null; problems: Problems }

/** Turns the forms into one search request, or names every field that is wrong. Nothing invalid is ever sent. */
export function buildSearch(draft: PlanBDraft): BuiltSearch {
  const problems: Problems = {}
  const bad = (field: string, key: ProblemKey) => {
    problems[field] = key
  }
  const months = wholeMonths(draft.months)
  if (months === null) bad('months', 'months')
  if (!MONTH.test(draft.startMonth)) bad('startMonth', 'month')
  if (!MONTH.test(draft.disruptionStart)) bad('disruptionStart', 'month')
  const cash = rupees(draft.liquidCash)
  if (cash === null) bad('liquidCash', 'money')
  const floor = rupees(draft.floor)
  if (floor === null) bad('floor', 'money')
  const before = rupees(draft.incomeBefore)
  const reduced = draft.disruption === 'income_loss' ? '0.00' : rupees(draft.reducedIncome)
  const newCost = rupees(draft.newCost)
  if (before === null) bad('incomeBefore', 'money')
  if (draft.disruption === 'income_reduction' && reduced === null) bad('reducedIncome', 'money')
  if (draft.disruption === 'new_expense' && newCost === null) bad('newCost', 'money')
  const duration = draft.durationKnown ? wholeMonths(draft.durationMonths) : null
  if (draft.durationKnown && duration === null) bad('durationMonths', 'months')
  const after = rupees(draft.incomeAfter)

  let horizonEnd = ''
  let dEnd: string | null = null
  if (months !== null && MONTH.test(draft.startMonth) && MONTH.test(draft.disruptionStart)) {
    horizonEnd = addMonths(draft.startMonth, months - 1)
    if (monthIndex(draft.disruptionStart) < monthIndex(draft.startMonth) || monthIndex(draft.disruptionStart) > monthIndex(horizonEnd)) bad('disruptionStart', 'month')
    if (duration !== null) {
      dEnd = addMonths(draft.disruptionStart, duration - 1)
      if (monthIndex(dEnd) > monthIndex(horizonEnd)) bad('durationMonths', 'durationBeyond')
      else if (monthIndex(dEnd) < monthIndex(horizonEnd) && after === null) bad('incomeAfter', 'money')
    }
  }

  const items: RecoveryInput['items'] = []
  const permissions: RecoveryInput['permissions'] = []
  if (draft.items.length === 0) bad('items', 'items')
  for (const it of draft.items) {
    const amount = rupees(it.monthly)
    if (!it.label.trim()) bad(`${it.id}.label`, 'name')
    if (amount === null) bad(`${it.id}.monthly`, 'money')
    items.push({
      id: it.id,
      label: it.label.trim() || 'Item',
      kind: it.kind,
      monthly: amount ?? '0.00',
      protected: it.kind === 'goal_contribution' ? it.protectedGoal : true,
      balance_id: it.kind === 'goal_contribution' ? it.balanceId || null : null,
    })
    if (isAdjustable(it)) {
      if (it.allowPause) {
        const max = wholeMonths(it.maxPause)
        if (max === null) bad(`${it.id}.maxPause`, 'pause')
        else permissions.push({ item_id: it.id, action: 'pause', max_months: max })
      }
      if (it.allowReduce) {
        const min = it.minMonthly.trim() === '' ? '0.00' : rupees(it.minMonthly)
        if (min === null || (amount !== null && toPaise(min) > toPaise(amount))) bad(`${it.id}.minMonthly`, 'money')
        else permissions.push({ item_id: it.id, action: 'reduce_to', min_monthly: min })
      }
    }
  }
  if (draft.disruption === 'new_expense' && newCost !== null) {
    items.push({
      id: 'new_expense',
      label: 'New recurring cost',
      kind: 'protected_obligation',
      protected: true,
      balance_id: null,
      monthly: newCost,
      from_month: draft.disruptionStart,
      to_month: dEnd,
    })
  }

  const balances: RecoveryInput['protected_balances'] = []
  for (const b of draft.balances) {
    const amount = rupees(b.balance)
    if (!b.label.trim()) bad(`${b.id}.label`, 'name')
    if (amount === null) bad(`${b.id}.balance`, 'money')
    balances.push({ id: b.id, label: b.label.trim() || 'Balance', balance: amount ?? '0.00' })
  }

  // Restoration: every condition must hold, and at least one is not a date (the form has no date condition).
  const conditions: NonNullable<RecoveryInput['restorations']>[number]['conditions'] = []
  const incomeAt = rupees(draft.restore.incomeAtLeast)
  const cashAt = rupees(draft.restore.cashAtLeast)
  if (draft.restore.incomeAtLeast.trim() && incomeAt === null) bad('restore.incomeAtLeast', 'money')
  if (draft.restore.cashAtLeast.trim() && cashAt === null) bad('restore.cashAtLeast', 'money')
  if (incomeAt) conditions.push({ type: 'income_at_least', amount: incomeAt })
  if (cashAt) conditions.push({ type: 'liquid_at_least', amount: cashAt })
  if (draft.restore.confirm) conditions.push({ type: 'user_confirmed' })
  const percents = draft.restore.mode === 'steps' ? parseSteps(draft.restore.stepPercents) : []
  if (draft.restore.mode === 'steps' && percents === null) bad('restore.stepPercents', 'steps')
  const gap = wholeMonths(draft.restore.gap, 12) ?? 1
  const restorations: RestorationRule[] = []
  if (conditions.length > 0 && percents !== null) {
    for (const it of draft.items) {
      if (!permissions.some((p) => p.item_id === it.id)) continue
      const original = rupees(it.monthly)
      if (original === null) continue
      restorations.push({
        item_id: it.id,
        conditions,
        steps: percents.map((pc) => percentOf(original, pc)),
        step_gap_months: gap,
        affordability_guard: draft.restore.guard,
      })
    }
  }

  if (draft.reviewMonth.trim() && !MONTH.test(draft.reviewMonth)) bad('reviewMonth', 'month')
  const candidates = wholeMonths(draft.maxCandidates, 20000)
  if (candidates === null) bad('maxCandidates', 'months')
  if (Object.keys(problems).length > 0 || months === null || before === null || cash === null || floor === null) return { request: null, problems }

  const income: RecoveryInput['income'] = []
  const during = draft.disruption === 'income_loss' ? '0.00' : draft.disruption === 'income_reduction' ? (reduced as string) : before
  if (monthIndex(draft.disruptionStart) > monthIndex(draft.startMonth)) {
    income.push({ from_month: draft.startMonth, to_month: addMonths(draft.disruptionStart, -1), monthly_net: before })
  }
  if (dEnd === null) {
    income.push({ from_month: draft.disruptionStart, to_month: null, monthly_net: during })
  } else {
    income.push({ from_month: draft.disruptionStart, to_month: dEnd, monthly_net: during })
    if (monthIndex(dEnd) < monthIndex(horizonEnd)) income.push({ from_month: addMonths(dEnd, 1), to_month: horizonEnd, monthly_net: after as string })
  }

  const request: RecoverySearchRequest = {
    input: {
      start_month: draft.startMonth,
      months,
      liquid_cash: cash,
      reserve_floor: floor,
      income,
      items,
      protected_balances: balances,
      permissions,
      adjustments: [],
      restorations,
      review_month: draft.reviewMonth.trim() || null,
    },
    adjust_from: draft.disruptionStart,
    adjust_months: duration ?? null,
    excluded_item_ids: draft.excluded,
    limits: { max_candidates: candidates as number, max_options: 3, reduce_step: '1000.00' },
  }
  return { request, problems: null }
}

/** The agreement to save: the situation that was searched plus the adjustments of the plan the person chose. */
export function agreementDraft(
  request: RecoverySearchRequest,
  adjustments: RecoveryAdjustment[],
  extra: { selectedLabel: string | null; rationale: string; fallback: string; plan?: { id: string; name: string } | null },
): AgreementDraft {
  return {
    input: { ...request.input, adjustments },
    selected_label: extra.selectedLabel,
    rationale: extra.rationale,
    fallback_note: extra.fallback,
    disruption_note: '',
    source_plan_id: extra.plan?.id ?? null,
    source_plan_name: extra.plan?.name ?? null,
  }
}

export interface Thresholds {
  incomeAtLeast: string
  cashAtLeast: string
  confirm: boolean
}

/** Reads the restoration conditions an agreement holds, for the edit form. */
export function thresholdsOf(input: RecoveryInput): Thresholds {
  const rule = input.restorations?.[0]
  const find = (type: string) => rule?.conditions.find((c) => c.type === type)
  return {
    incomeAtLeast: find('income_at_least')?.amount?.replace(/\.00$/, '') ?? '',
    cashAtLeast: find('liquid_at_least')?.amount?.replace(/\.00$/, '') ?? '',
    confirm: Boolean(find('user_confirmed')),
  }
}

export type Revised = { input: RecoveryInput; problem: null } | { input: null; problem: ProblemKey }

/** The agreement's situation with new reserve floor, review month and restoration conditions. Everything else is kept as saved. */
export function reviseInput(input: RecoveryInput, edit: Thresholds & { floor: string; reviewMonth: string }): Revised {
  const floor = rupees(edit.floor)
  if (floor === null) return { input: null, problem: 'money' }
  if (edit.reviewMonth.trim() && !MONTH.test(edit.reviewMonth)) return { input: null, problem: 'month' }
  const conditions: RestorationRule['conditions'] = []
  const incomeAt = rupees(edit.incomeAtLeast)
  const cashAt = rupees(edit.cashAtLeast)
  if (edit.incomeAtLeast.trim() && incomeAt === null) return { input: null, problem: 'money' }
  if (edit.cashAtLeast.trim() && cashAt === null) return { input: null, problem: 'money' }
  if (incomeAt) conditions.push({ type: 'income_at_least', amount: incomeAt })
  if (cashAt) conditions.push({ type: 'liquid_at_least', amount: cashAt })
  if (edit.confirm) conditions.push({ type: 'user_confirmed' })
  const restorations = conditions.length > 0 ? (input.restorations ?? []).map((r) => ({ ...r, conditions })) : (input.restorations ?? [])
  return {
    input: { ...input, reserve_floor: floor, review_month: edit.reviewMonth.trim() || null, restorations },
    problem: null,
  }
}
