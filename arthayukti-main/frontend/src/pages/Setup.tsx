import { useId, useMemo, useState } from 'react'
import {
  Armchair,
  BookOpen,
  Bus,
  CircleCheck,
  House,
  Landmark,
  ShieldCheck,
  ShoppingBag,
  Plus,
  ShoppingBasket,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Goal, Plan } from '../api/types'
import { Card, CardTitle, PageHeading, StepProgress } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { MonthPicker, MoneyField, PriorityControls, Stepper } from '../components/Fields'
import { Layout } from '../components/Layout'
import { defaultGoalDate, MAX_GOALS } from '../lib/blank'
import { addMoney, formatMoney, isGreater, subMoney, toPaise } from '../lib/money'
import { monthLabelLong } from '../lib/months'
import { householdName } from '../lib/household'
import { Select } from '../components/Select'
import { goalName } from '../lib/outcome'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

function totalIncome(plan: Plan): string {
  return addMoney('0.00', ...plan.income_streams.map((stream) => stream.monthly_net))
}

function totalSpending(plan: Plan): string {
  return addMoney(
    '0.00',
    ...(plan.expenses ?? []).map((expense) => expense.monthly),
    ...(plan.commitments ?? []).map((commitment) => commitment.monthly_payment),
  )
}

export function MoneyIn({ navigate }: PageProps) {
  const { text, sample, plan, setIncome } = useStore()
  if (!plan) return null
  const copy = text.income

  const label = (id: string, fallback: string) =>
    id === 'arjun' ? copy.arjun : id === 'meera' ? copy.meera : id === 'income' ? copy.mine : fallback
  const hints = [copy.hintWork, copy.hintUsual]

  return (
    <Layout route="money-in" navigate={navigate} speak={`${copy.title} ${copy.subtitle}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle} />
      <StepProgress
        step={1}
        stepOf={text.common.stepOf(1)}
        labels={[text.common.moneyIn, text.common.moneyOut, text.common.dreams]}
      />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            {plan.income_streams.map((stream, index) => (
              <MoneyField
                key={stream.id}
                icon={<Wallet size={24} aria-hidden="true" />}
                label={label(stream.id, stream.label)}
                hint={hints[index]}
                value={stream.monthly_net}
                onChange={(amount) => setIncome(stream.id, amount)}
              />
            ))}
          </Card>
          <PrimaryButton onClick={() => navigate('money-out')}>{copy.next}</PrimaryButton>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <Wallet size={40} aria-hidden="true" />
            <p>{copy.together}</p>
            <p className="font-display text-[40px] leading-[1.15] font-semibold lg:text-[48px]">
              {formatMoney(totalIncome(plan))}
            </p>
            {sample ? (
              <p className="text-muted">{copy.exampleNote(householdName(text, sample, plan))}</p>
            ) : null}
          </Card>
          <p>{copy.noBank}</p>
        </div>
      </div>
    </Layout>
  )
}

const SPENDING_ICONS: Record<string, LucideIcon> = {
  food_home: ShoppingBasket,
  school_travel: Bus,
  loan: Landmark,
  other: ShoppingBag,
}

export function MoneyOut({ navigate }: PageProps) {
  const { text, plan, setExpense } = useStore()
  if (!plan) return null
  const copy = text.spending

  const labels: Record<string, string> = {
    food_home: copy.food,
    school_travel: copy.school,
    loan: copy.loan,
    other: copy.other,
  }
  const income = totalIncome(plan)
  const spending = totalSpending(plan)
  const left = subMoney(income, spending)
  const isShort = toPaise(left) < 0n

  return (
    <Layout route="money-out" navigate={navigate} speak={`${copy.title} ${copy.subtitle}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle} />
      <StepProgress
        step={2}
        stepOf={text.common.stepOf(2)}
        labels={[text.common.moneyIn, text.common.moneyOut, text.common.dreams]}
      />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            {(plan.expenses ?? []).map((expense) => {
              const Icon = SPENDING_ICONS[expense.id] ?? ShoppingBag
              return (
                <MoneyField
                  key={expense.id}
                  icon={<Icon size={24} aria-hidden="true" />}
                  label={labels[expense.id] ?? expense.label}
                  value={expense.monthly}
                  onChange={(amount) => setExpense(expense.id, amount)}
                />
              )
            })}
          </Card>
          <PrimaryButton onClick={() => navigate('dreams')}>{copy.next}</PrimaryButton>
          <SecondaryButton onClick={() => navigate('money-in')}>{text.common.back}</SecondaryButton>
        </div>
        <Card>
          <p>{copy.totalOut}</p>
          <p className="font-display text-[36px] leading-[1.15] font-semibold lg:text-[40px]">
            {formatMoney(spending)}
          </p>
          <p className="text-muted">{copy.inMinusOut(formatMoney(income), formatMoney(spending))}</p>
          <p className="font-display text-[34px] leading-[1.15] font-semibold lg:text-[48px]">
            {isShort ? copy.short(formatMoney(subMoney('0.00', left))) : copy.left(formatMoney(left))}
          </p>
          <p>{copy.leftNote}</p>
        </Card>
      </div>
    </Layout>
  )
}

const GOAL_ICONS: Record<string, LucideIcon> = {
  emergency_fund: ShieldCheck,
  home: House,
  education: BookOpen,
  retirement: Armchair,
}

function stepFor(amount: string): string {
  const paise = toPaise(amount)
  if (paise >= 500000000n) return '100000.00'
  if (paise >= 100000000n) return '50000.00'
  return '10000.00'
}

export function Dreams({ navigate }: PageProps) {
  const { text, language, plan, projection, setGoalAmount, setGoalDate, moveGoal, removeGoal } =
    useStore()
  const ordered = useMemo(
    () => (plan ? [...plan.goals].sort((a, b) => a.priority - b.priority) : []),
    [plan],
  )
  if (!plan) return null
  const copy = text.dreamsSetup

  const left = subMoney(totalIncome(plan), totalSpending(plan))
  const result = projection.data
  const need = result
    ? addMoney('0.00', ...result.goals.map((goal) => goal.required_monthly_level_standalone))
    : null

  const required = (goal: Goal): string => {
    const outcome = result?.goals.find((item) => item.goal_id === goal.id)
    if (!outcome) return ''
    return toPaise(outcome.required_monthly_level_standalone) === 0n
      ? copy.alreadyFull
      : text.status.perMonth(formatMoney(outcome.required_monthly_level_standalone))
  }

  return (
    <Layout route="dreams" navigate={navigate} speak={`${copy.title} ${copy.subtitle}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle} />
      <StepProgress
        step={3}
        stepOf={text.common.stepOf(3)}
        labels={[text.common.moneyIn, text.common.moneyOut, text.common.dreams]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        {ordered.map((goal, index) => {
          const Icon = GOAL_ICONS[goal.type] ?? House
          const step = stepFor(goal.target_amount_today)
          return (
            <Card key={goal.id}>
              <div className="flex items-center gap-2">
                <CircleCheck size={24} aria-hidden="true" className="text-ontime" />
                <Icon size={24} aria-hidden="true" />
                <h2 className="flex-1 font-semibold">{goalName(text, goal)}</h2>
                <button
                  type="button"
                  onClick={() => {
                    removeGoal(goal.id)
                    window.setTimeout(() => document.getElementById('add-goal')?.focus(), 0)
                  }}
                  aria-label={`${copy.remove(goalName(text, goal))} (${copy.priority(index + 1)})`}
                  className="flex size-11 items-center justify-center rounded-xl text-muted hover:text-late"
                >
                  <Trash2 size={20} aria-hidden="true" />
                </button>
              </div>
              <PriorityControls
                rankText={copy.priority(index + 1)}
                moveUpLabel={copy.moveUp}
                moveDownLabel={copy.moveDown}
                canMoveUp={index > 0}
                canMoveDown={index < ordered.length - 1}
                onMoveUp={() => moveGoal(goal.id, 'up')}
                onMoveDown={() => moveGoal(goal.id, 'down')}
              />
              <p>{copy.moneyNeeded}</p>
              <Stepper
                value={goal.target_amount_today}
                decreaseLabel={copy.decrease}
                increaseLabel={copy.increase}
                onDecrease={() => {
                  const next = subMoney(goal.target_amount_today, step)
                  if (toPaise(next) > 0n) setGoalAmount(goal.id, next)
                }}
                onIncrease={() => setGoalAmount(goal.id, addMoney(goal.target_amount_today, step))}
              />
              <p>{copy.neededBy}</p>
              <MonthPicker
                value={goal.target_date}
                from={plan.as_of}
                label={copy.neededBy}
                language={language}
                onChange={(month) => setGoalDate(goal.id, month)}
              />
              <p className="text-muted">{copy.alreadySaved(formatMoney(goal.current_savings ?? '0.00'))}</p>
              <p className="font-semibold">{required(goal)}</p>
            </Card>
          )
        })}
      </div>
      {ordered.length === 0 ? <p className="text-muted">{copy.noGoals}</p> : null}
      <AddGoal />
      <Card>
        <CardTitle>{copy.sharedTitle(formatMoney(left))}</CardTitle>
        {need !== null ? (
          <p>
            {isGreater(need, left)
              ? copy.tooMuch(formatMoney(need))
              : copy.sharedBody(formatMoney(need))}
          </p>
        ) : null}
        <p className="text-muted">{copy.planStarts(monthLabelLong(plan.as_of, language))}</p>
      </Card>
      <PrimaryButton disabled={ordered.length === 0} onClick={() => navigate('plan')}>
        {copy.showPlan}
      </PrimaryButton>
      <SecondaryButton onClick={() => navigate('money-out')}>{text.common.back}</SecondaryButton>
    </Layout>
  )
}

const GOAL_KINDS = ['emergency_fund', 'home', 'education', 'retirement', 'loan_payoff'] as const

function AddGoal() {
  const { text, language, plan, addGoal } = useStore()
  const copy = text.dreamsSetup
  const [kind, setKind] = useState<(typeof GOAL_KINDS)[number]>('emergency_fund')
  const [amount, setAmount] = useState('0.00')
  const [date, setDate] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const kindId = useId()
  if (!plan) return null

  const when = date ?? defaultGoalDate(plan.as_of)
  const full = plan.goals.length >= MAX_GOALS
  const missing = toPaise(amount) <= 0n

  return (
    <Card>
      <h2 id="add-goal" tabIndex={-1} className="font-display text-[28px] leading-[1.15] font-semibold outline-none">
        {copy.addTitle}
      </h2>
      {full ? (
        <p className="text-muted">{copy.maxGoals}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={kindId}>{copy.kind}</label>
            <Select
              id={kindId}
              value={kind}
              onChange={setKind}
              options={GOAL_KINDS.map((value) => ({ value, label: text.goalNames[value] }))}
              className="min-h-14 rounded-2xl border border-line bg-cream px-4"
            />
          </div>
          <MoneyField icon={null} label={copy.amountLabel} value={amount} onChange={setAmount} />
          {tried && missing ? (
            <p role="alert" className="text-late">
              {copy.needAmount}
            </p>
          ) : null}
          <p>{copy.neededBy}</p>
          <MonthPicker value={when} from={plan.as_of} label={copy.neededBy} language={language} onChange={setDate} />
          <PrimaryButton
            icon={Plus}
            onClick={() => {
              if (missing) {
                setTried(true)
                return
              }
              addGoal(kind, text.goalNames[kind], amount, when)
              setAmount('0.00')
              setDate(null)
              setTried(false)
            }}
          >
            {copy.add}
          </PrimaryButton>
        </>
      )}
    </Card>
  )
}
