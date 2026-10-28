import { CalendarX, CircleCheck, Circle, Sun, Wrench, type LucideIcon } from 'lucide-react'
import type { Plan, ProjectionResult } from '../api/types'
import { Card, CardTitle, PageHeading, SummaryTiles, VerdictBanner } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { GoalGrid } from '../components/GoalCard'
import { Layout } from '../components/Layout'
import { MoneyField } from '../components/Fields'
import { Await } from '../components/Status'
import { fixSummary } from '../lib/fixText'
import { addMoney, atLeastZero, formatMoney, isNegative, mulMoney, subMoney } from '../lib/money'
import { addMonths, monthLabel, monthLabelLong, monthsBetween } from '../lib/months'
import { usualRow } from '../lib/outcome'
import type { Choice } from '../lib/scenarios'
import { describeVerdict } from '../lib/verdict'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

const CHOICES: { value: Choice; icon: LucideIcon; key: 'normal' | 'noIncome' | 'expense' }[] = [
  { value: 'normal', icon: Sun, key: 'normal' },
  { value: 'no_income', icon: CalendarX, key: 'noIncome' },
  { value: 'expense', icon: Wrench, key: 'expense' },
]

function incomeTotal(plan: Plan): string {
  return addMoney('0.00', ...plan.income_streams.map((stream) => stream.monthly_net))
}

function spendingTotal(plan: Plan): string {
  return addMoney(
    '0.00',
    ...(plan.expenses ?? []).map((expense) => expense.monthly),
    ...(plan.commitments ?? []).map((commitment) => commitment.monthly_payment),
  )
}

export function WhatIfPage({ navigate }: PageProps) {
  const { text, language, plan, projection, choice, setChoice, situation, fix, setFix, fixes, source, shockAmount, setShockAmount } =
    useStore()
  const copy = text.whatIf

  // An own plan has no expense until an amount is typed, so there is nothing to show yet.
  const awaitingAmount = source === 'own' && choice === 'expense' && !situation
  const events = situation?.events ?? []
  const incomeEvent = events.find((event) => event.type === 'income_change')
  const expenseEvent = events.find((event) => event.type === 'one_time_expense')

  const heading =
    choice === 'no_income' ? copy.headingNoIncome : choice === 'expense' ? copy.headingExpense : copy.title
  let subtitle = copy.chooseOne
  if (choice === 'no_income' && incomeEvent && incomeEvent.type === 'income_change') {
    subtitle = copy.subNoIncome(
      `${monthLabel(incomeEvent.from_month, language)} – ${monthLabel(incomeEvent.to_month, language)}`,
    )
  } else if (choice === 'expense' && expenseEvent && expenseEvent.type === 'one_time_expense') {
    subtitle = copy.subExpense(monthLabel(expenseEvent.month, language))
  }

  const verdict =
    plan && projection.data ? describeVerdict(projection.data, plan, text, choice) : null
  const recommended = fixes.data?.options.find((option) => option.id === fixes.data?.recommended_option_id)

  return (
    <Layout
      route="what-if"
      navigate={navigate}
      speak={verdict ? `${heading}. ${verdict.title} ${verdict.body}` : heading}
    >
      <PageHeading title={heading} subtitle={subtitle} />

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="sr-only">{copy.chooseOne}</legend>
        {CHOICES.map(({ value, icon: Icon, key }) => {
          const selected = choice === value
          const Mark = selected ? CircleCheck : Circle
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => setChoice(value)}
              className={`flex min-h-20 items-center gap-4 rounded-2xl border p-4 text-left font-semibold ${
                selected ? 'border-ink bg-brand text-white' : 'border-line bg-paper'
              }`}
            >
              <Icon size={24} aria-hidden="true" className="shrink-0" />
              <span className="flex-1">{copy[key]}</span>
              <Mark size={24} aria-hidden="true" className={`shrink-0 ${selected ? 'text-turmeric' : ''}`} />
            </button>
          )
        })}
      </fieldset>

      {source === 'own' && choice === 'expense' ? (
        <Card>
          <MoneyField
            icon={<Wrench size={20} aria-hidden="true" />}
            label={copy.expenseAmount}
            hint={copy.expenseAmountHint}
            value={shockAmount === '' ? '0.00' : shockAmount}
            onChange={(amount) => setShockAmount(amount)}
          />
        </Card>
      ) : null}

      {awaitingAmount ? null : (
      <Await remote={projection}>
        {(result) => {
          if (!plan || !verdict) return null
          const row = usualRow(result)
          const short = row && isNegative(row.surplus)
          const anyLate = result.goals.some((goal) => goal.status !== 'on_track')
          return (
            <>
              <VerdictBanner tone={verdict.tone} title={verdict.title} body={verdict.body} />
              {fix ? (
                <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-sage p-4">
                  <p className="min-w-0 flex-1 font-semibold">{copy.fixKept(fixSummary(text, fix))}</p>
                  <button type="button" onClick={() => setFix(null)} className="min-h-12 px-4 underline">
                    {copy.undoFix}
                  </button>
                </div>
              ) : null}
              {row ? (
                <SummaryTiles
                  inLabel={text.plan.tileIn}
                  outLabel={text.plan.tileOut}
                  leftLabel={text.plan.tileLeft}
                  income={formatMoney(row.income)}
                  spending={formatMoney(addMoney(row.expenses, row.commitments))}
                  left={formatMoney(atLeastZero(row.surplus))}
                  note={short ? copy.shortBy(formatMoney(subMoney('0.00', row.surplus))) : undefined}
                />
              ) : null}
              <Explainer plan={plan} result={result} choice={choice} />
              <section className="flex flex-col gap-4">
                <h2 className="font-display text-[28px] leading-[1.15] font-semibold">{text.plan.yourFour}</h2>
                <p className="text-muted">{text.plan.dashed}</p>
                <GoalGrid plan={plan} result={result} />
              </section>
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
                {anyLate && recommended ? (
                  <Card>
                    <CardTitle>{copy.smallestFix(fixSummary(text, recommended))}</CardTitle>
                  </Card>
                ) : (
                  <span />
                )}
                <div className="flex flex-col gap-4">
                  {anyLate ? (
                    <PrimaryButton onClick={() => navigate('fixes')}>{copy.whatCanIDo}</PrimaryButton>
                  ) : (
                    <PrimaryButton icon="back" onClick={() => navigate('plan')}>
                      {copy.backToPlan}
                    </PrimaryButton>
                  )}
                  {choice === 'normal' ? (
                    <SecondaryButton icon={CalendarX} onClick={() => setChoice('no_income')}>
                      {copy.tryNoIncome}
                    </SecondaryButton>
                  ) : null}
                  {choice === 'no_income' ? (
                    <SecondaryButton icon={Wrench} onClick={() => setChoice('expense')}>
                      {copy.tryExpense}
                    </SecondaryButton>
                  ) : null}
                  {anyLate ? (
                    <SecondaryButton onClick={() => navigate('plan')}>{copy.backToPlan}</SecondaryButton>
                  ) : null}
                </div>
              </div>
            </>
          )
        }}
      </Await>
      )}
    </Layout>
  )
}

function Explainer({ plan, result, choice }: { plan: Plan; result: ProjectionResult; choice: Choice }) {
  const { text, language, situation } = useStore()
  const copy = text.whatIf
  const income = incomeTotal(plan)
  const out = spendingTotal(plan)
  const left = subMoney(income, out)
  const events = situation?.events ?? []

  if (choice === 'no_income') {
    const event = events.find((item) => item.type === 'income_change')
    if (event && event.type === 'income_change') {
      const months = monthsBetween(event.from_month, event.to_month) + 1
      const emergency = result.goals.find((goal) =>
        plan.goals.some((item) => item.id === goal.goal_id && item.type === 'emergency_fund'),
      )
      return (
        <Card>
          <CardTitle>{copy.noIncomeTitle}</CardTitle>
          <p>{copy.noIncomeUse(formatMoney(out), months, formatMoney(mulMoney(out, months)))}</p>
          <p>{copy.noIncomeStop}</p>
          <p className="text-muted">
            {copy.noIncomeBack(
              monthLabelLong(addMonths(event.to_month, 1), language),
              formatMoney(income),
              formatMoney(out),
              formatMoney(left),
            )}{' '}
            {emergency?.projected_completion
              ? copy.refill(monthLabelLong(emergency.projected_completion, language))
              : ''}
          </p>
        </Card>
      )
    }
  }

  if (choice === 'expense') {
    const event = events.find((item) => item.type === 'one_time_expense')
    if (event && event.type === 'one_time_expense') {
      const used = addMoney('0.00', ...result.goals.map((goal) => goal.total_withdrawn))
      return (
        <Card>
          <CardTitle>{copy.expenseTitle(formatMoney(event.amount))}</CardTitle>
          <p>{copy.expenseUse(formatMoney(used))}</p>
          <p className="text-muted">{copy.expenseSame}</p>
        </Card>
      )
    }
  }

  return (
    <Card>
      <CardTitle>{copy.usualTitle}</CardTitle>
      <p>{copy.usualBody(formatMoney(left))}</p>
      <p className="text-muted">{text.plan.noGrowth}</p>
    </Card>
  )
}
