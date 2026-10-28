import { CircleCheck, Columns2, SlidersHorizontal } from 'lucide-react'
import type { FixOption, Plan } from '../api/types'
import { Card, PageHeading, VerdictBanner } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { Layout } from '../components/Layout'
import { Await } from '../components/Status'
import { fixAmount, fixSummary } from '../lib/fixText'
import { addMoney, formatMoney, isGreater, subMoney } from '../lib/money'
import { monthLabel } from '../lib/months'
import { goalNameById } from '../lib/outcome'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

const MAX_CARDS = 3

function spendingTotal(plan: Plan): string {
  return addMoney(
    '0.00',
    ...(plan.expenses ?? []).map((expense) => expense.monthly),
    ...(plan.commitments ?? []).map((commitment) => commitment.monthly_payment),
  )
}

export function FixesPage({ navigate }: PageProps) {
  const { text, language, plan, fixes, activeChoice: choice, setFix } = useStore()
  const copy = text.fixes

  const after =
    choice === 'no_income' ? text.whatIf.noIncome : choice === 'expense' ? text.whatIf.expense : text.whatIf.normal

  const choose = (option: FixOption) => {
    setFix(option)
    navigate('compare')
  }

  return (
    <Layout route="fixes" navigate={navigate} speak={`${copy.title} ${copy.subtitle(after)}`}>
      <PageHeading title={copy.title} subtitle={copy.subtitle(after)} />
      <Await remote={fixes}>
        {(result) => {
          if (!plan) return null
          if (!result.needs_fix) {
            return (
              <>
                <VerdictBanner tone="good" title={copy.nothingToFix} body={copy.nothingToFixBody} />
                <PrimaryButton icon="back" onClick={() => navigate('plan')}>
                  {text.whatIf.backToPlan}
                </PrimaryButton>
              </>
            )
          }
          const options = result.options.slice(0, MAX_CARDS)
          const first = options[0]
          const unresolved = Boolean(result.no_single_fix_reason)
          return (
            <>
              <VerdictBanner
                tone={unresolved ? 'late' : 'good'}
                title={unresolved ? copy.noSingle : copy.startSmall}
                body={first && !unresolved ? copy.startSmallBody(fixSummary(text, first)) : ''}
              />
              <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                {options.map((option, index) => (
                  <FixCard
                    key={option.id}
                    option={option}
                    first={index === 0}
                    plan={plan}
                    language={language}
                    onChoose={() => choose(option)}
                  />
                ))}
              </div>
              <p className="text-muted">{copy.careful}</p>
              {first ? (
                <SecondaryButton icon={Columns2} onClick={() => choose(first)}>
                  {copy.compareSmallest}
                </SecondaryButton>
              ) : null}
              <SecondaryButton onClick={() => navigate('what-if')}>{text.common.back}</SecondaryButton>
            </>
          )
        }}
      </Await>
    </Layout>
  )
}

function FixCard({
  option,
  first,
  plan,
  language,
  onChoose,
}: {
  option: FixOption
  first: boolean
  plan: Plan
  language: 'en' | 'hi'
  onChoose: () => void
}) {
  const { text } = useStore()
  const copy = text.fixes
  const Icon = first ? CircleCheck : SlidersHorizontal
  const goalId = option.goal_id ?? option.resolves[0] ?? plan.goals[0]?.id ?? ''
  const goal = goalNameById(text, plan, goalId)
  const names = (ids: string[]) => ids.map((id) => goalNameById(text, plan, id)).join(', ')
  const override = option.scenario_delta.goal_overrides?.[0]
  const spending = spendingTotal(plan)
  const fitsInSpending = option.lever === 'extra_savings' && !isGreater(option.magnitude, spending)

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Icon size={24} aria-hidden="true" />
        <p className="flex-1 font-semibold">{first ? copy.smallest : copy.another}</p>
      </div>
      <p className="font-display text-[40px] leading-[1.15] font-semibold">
        {option.lever === 'extra_savings'
          ? copy.extraTitle(fixAmount(text, option))
          : option.lever === 'delay_goal'
            ? copy.delayTitle(Number(option.magnitude))
            : copy.reduceTitle(Number(option.magnitude))}
      </p>
      <p>
        {option.lever === 'extra_savings'
          ? copy.extraLine
          : option.lever === 'delay_goal'
            ? copy.delayLine(goal)
            : copy.reduceLine(goal)}
      </p>
      {option.lever === 'extra_savings' && fitsInSpending ? (
        <p>{copy.extraSpend(formatMoney(subMoney(spending, option.magnitude)))}</p>
      ) : null}
      {option.lever === 'delay_goal' && override?.target_date ? (
        <p className="font-semibold">{copy.delayNew(monthLabel(override.target_date, language))}</p>
      ) : null}
      {option.lever === 'reduce_target' && override?.target_amount_today ? (
        <p className="font-semibold">{copy.reduceNew(formatMoney(override.target_amount_today))}</p>
      ) : null}
      {option.resolves.length > 0 ? (
        <div className="rounded-2xl bg-sage p-4">
          <p className="text-ontime font-semibold">{copy.backOnTime(names(option.resolves))}</p>
        </div>
      ) : null}
      {option.leaves_unresolved.length > 0 ? (
        <p className="text-late font-semibold">{copy.stillLate(names(option.leaves_unresolved))}</p>
      ) : (
        <p className="text-muted">{copy.verified}</p>
      )}
      <PrimaryButton onClick={onChoose}>{copy.doThis}</PrimaryButton>
    </Card>
  )
}
