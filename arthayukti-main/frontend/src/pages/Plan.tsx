import { useEffect } from 'react'
import { Card, CardTitle, PageHeading, SummaryTiles, VerdictBanner } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { GoalGrid } from '../components/GoalCard'
import { Layout } from '../components/Layout'
import { MonthlyBars } from '../components/MonthlyBars'
import { Await } from '../components/Status'
import { addMoney, atLeastZero, formatMoney } from '../lib/money'
import { monthLabelLong } from '../lib/months'
import { usualRow } from '../lib/outcome'
import { householdName } from '../lib/household'
import { describeVerdict } from '../lib/verdict'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

export function PlanPage({ navigate }: PageProps) {
  const { text, language, sample, plan, projection, choice, setChoice, previousOrder, undoOrder } = useStore()

  // "My plan" always shows the plan as it is, before any what-if.
  useEffect(() => {
    if (choice !== 'normal') setChoice('normal')
  }, [choice, setChoice])

  const copy = text.plan
  const verdict =
    plan && projection.data ? describeVerdict(projection.data, plan, text, 'normal') : null

  return (
    <Layout
      route="plan"
      navigate={navigate}
      speak={verdict ? `${copy.title}. ${verdict.title} ${verdict.body}` : copy.title}
    >
      <PageHeading
        title={copy.title}
        subtitle={plan ? copy.subtitle(householdName(text, sample, plan), monthLabelLong(plan.as_of, language)) : undefined}
      />
      {previousOrder ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-sand px-4 py-3">
          <span className="flex-1">{text.tradeoffs.undoNote}</span>
          <button type="button" onClick={undoOrder} className="min-h-11 rounded-xl border border-ink px-4 font-semibold">
            {text.tradeoffs.undo}
          </button>
        </div>
      ) : null}
      <Await remote={projection}>
        {(result) => {
          if (!plan || !verdict) return null
          const row = usualRow(result)
          return (
            <>
              <VerdictBanner tone={verdict.tone} title={verdict.title} body={verdict.body} />
              {row ? (
                <SummaryTiles
                  inLabel={copy.tileIn}
                  outLabel={copy.tileOut}
                  leftLabel={copy.tileLeft}
                  income={formatMoney(row.income)}
                  spending={formatMoney(addMoney(row.expenses, row.commitments))}
                  left={formatMoney(atLeastZero(row.surplus))}
                />
              ) : null}
              <section className="flex flex-col gap-4">
                <h2 className="font-display text-[28px] leading-[1.15] font-semibold">{copy.yourFour}</h2>
                <p className="text-muted">{copy.dashed}</p>
                <GoalGrid plan={plan} result={result} />
              </section>
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
                <MonthlyBars plan={plan} result={result} />
                <div className="flex flex-col gap-6">
                  <Card>
                    <CardTitle>{copy.oneMonth}</CardTitle>
                    <p>{copy.oneMonthBody}</p>
                    <p className="text-muted">{copy.noGrowth}</p>
                  </Card>
                  <Card>
                    <CardTitle>{copy.lab}</CardTitle>
                    <p>{copy.labBody}</p>
                    <PrimaryButton onClick={() => navigate('tradeoffs')}>{text.nav.tradeoffs}</PrimaryButton>
                    <p className="text-[15px] text-muted">{copy.assumptions}</p>
                  </Card>
                  <SecondaryButton icon="forward" onClick={() => navigate('what-if')}>
                    {copy.whatIf}
                  </SecondaryButton>
                  <SecondaryButton icon="forward" onClick={() => navigate('money-in')}>
                    {copy.change}
                  </SecondaryButton>
                </div>
              </div>
            </>
          )
        }}
      </Await>
    </Layout>
  )
}
