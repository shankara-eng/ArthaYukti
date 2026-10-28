import { Check } from 'lucide-react'
import type { CompareResult, FixOption, GoalOutcome, Plan, Scenario } from '../api/types'
import { api } from '../api/client'
import { Card, PageHeading } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { Jar } from '../components/Jar'
import { Layout } from '../components/Layout'
import { Await } from '../components/Status'
import { fixSummary } from '../lib/fixText'
import { addMoney, formatMoney, subMoney } from '../lib/money'
import { monthLabel, monthToIndex } from '../lib/months'
import { goalNameById, jarLevel, statusText, toneOf } from '../lib/outcome'
import { withFix } from '../lib/scenarios'
import { useStore } from '../state/useStore'
import { useRemote } from '../state/useRemote'
import type { PageProps } from './types'

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

export function ComparePage({ navigate }: PageProps) {
  const { text, plan, situation, fix, setFix, fixes, activeChoice: choice } = useStore()
  const copy = text.compare

  const suggested = fixes.data?.options.find((option) => option.id === fixes.data?.recommended_option_id)
  const chosen: FixOption | null = fix ?? suggested ?? fixes.data?.options[0] ?? null

  const base: Scenario = situation ?? { name: 'Baseline', extra_monthly_savings: '0.00' }
  const key = plan && chosen ? JSON.stringify([plan, base, chosen.id]) : null
  const comparison = useRemote<CompareResult>(key, (signal) =>
    api.compare(plan as Plan, [base, withFix(base, chosen) as Scenario], signal),
  )

  const after =
    choice === 'no_income' ? text.whatIf.noIncome : choice === 'expense' ? text.whatIf.expense : text.whatIf.normal

  if (plan && !chosen) {
    // Wait for the answer before saying anything: no answer yet is not the same as "nothing to fix".
    return (
      <Layout route="compare" navigate={navigate} speak={copy.title}>
        <PageHeading title={copy.title} subtitle={copy.subtitle(after)} />
        <Await remote={fixes}>
          {(result) => (
            <Card>
              <p>{result.needs_fix ? text.fixes.noSingle : text.fixes.nothingToFixBody}</p>
            </Card>
          )}
        </Await>
        <SecondaryButton onClick={() => navigate('what-if')}>{text.whatIf.backToPlan}</SecondaryButton>
      </Layout>
    )
  }

  const summary = chosen ? fixSummary(text, chosen) : ''

  return (
    <Layout route="compare" navigate={navigate} speak={`${copy.title} ${copy.same(summary)}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle(after)} />
      <Await remote={comparison}>
        {(result) => {
          if (!plan || !chosen) return null
          const [before, selected] = result.results
          const income = incomeTotal(plan)
          const spending = spendingTotal(plan)
          const lowered = chosen.lever === 'extra_savings' ? chosen.magnitude : '0.00'
          const spendingAfter = subMoney(spending, lowered)
          const title =
            chosen.lever === 'extra_savings'
              ? copy.spendLess
              : chosen.lever === 'delay_goal'
                ? copy.waitLonger
                : copy.aimLower
          return (
            <>
              <p className="font-semibold">{copy.same(summary)}</p>
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <PlanColumn
                  plan={plan}
                  heading={copy.baseline(after)}
                  title={copy.keepAsIs}
                  goals={before.goals}
                  income={income}
                  spending={spending}
                  footer={copy.noChange}
                />
                <PlanColumn
                  highlighted
                  plan={plan}
                  heading={copy.selected}
                  title={title}
                  goals={selected.goals}
                  income={income}
                  spending={spendingAfter}
                  footer={copy.changeLine(summary)}
                />
              </div>
              <PrimaryButton
                icon={Check}
                onClick={() => {
                  setFix(chosen)
                  navigate('what-if')
                }}
              >
                {copy.keep}
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate('fixes')}>{copy.backToFixes}</SecondaryButton>
            </>
          )
        }}
      </Await>
    </Layout>
  )
}

interface ColumnProps {
  plan: Plan
  heading: string
  title: string
  goals: GoalOutcome[]
  income: string
  spending: string
  footer: string
  highlighted?: boolean
}

function PlanColumn({ plan, heading, title, goals, income, spending, footer, highlighted }: ColumnProps) {
  const { text, language } = useStore()
  const copy = text.compare
  const worst = goals.find((goal) => goal.status !== 'on_track') ?? goals[0]
  const left = subMoney(income, spending)

  const completion = (goal: GoalOutcome): string => {
    if (!goal.projected_completion) return text.status.notReachable
    return monthToIndex(goal.projected_completion) <= monthToIndex(plan.as_of)
      ? text.status.readyNow
      : monthLabel(goal.projected_completion, language)
  }

  return (
    <section
      className={`flex flex-col gap-6 rounded-3xl bg-paper p-6 ${
        highlighted ? 'border-2 border-ontime' : 'border border-line'
      }`}
    >
      <p className={`font-semibold ${highlighted ? 'text-ontime' : 'text-muted'}`}>{heading}</p>
      <h2 className="font-display text-[32px] leading-[1.15] font-semibold">{title}</h2>
      {worst ? (
        <div className="flex items-center gap-4">
          <Jar
            level={jarLevel(worst)}
            tone={toneOf(worst)}
            label={`${goalNameById(text, plan, worst.goal_id)}: ${statusText(text, worst)}`}
          />
          <div className="font-semibold">
            <p>{goalNameById(text, plan, worst.goal_id)}</p>
            <p className={toneOf(worst) === 'late' ? 'text-late' : 'text-ontime'}>
              {statusText(text, worst)}
            </p>
          </div>
        </div>
      ) : null}
      <dl className="flex flex-col gap-4">
        {goals.map((goal) => (
          <div key={goal.goal_id} className="min-h-[72px]">
            <dt>{goalNameById(text, plan, goal.goal_id)}</dt>
            <dd>{completion(goal)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-4 rounded-2xl bg-cream p-4">
        <p className="font-display text-[26px] leading-[1.15] font-semibold">{copy.eachMonth}</p>
        <div>
          <p>{copy.moneyIn}</p>
          <p>{formatMoney(income)}</p>
        </div>
        <div>
          <p>{copy.moneyOut}</p>
          <p>{formatMoney(spending)}</p>
        </div>
        <div>
          <p>{copy.leftForJars}</p>
          <p>{formatMoney(left)}</p>
        </div>
      </div>
      <p>{footer}</p>
    </section>
  )
}
