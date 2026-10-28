import { useState } from 'react'
import { api } from '../../api/client'
import type { ProjectionResult } from '../../api/types'
import { AreaLine, HatchedBars } from '../../components/charts'
import { MonthlyBars } from '../../components/MonthlyBars'
import { Money } from '../../components/Money'
import { PageActions } from '../../components/PageActions'
import { SectionNavigator } from '../../components/SectionNavigator'
import { GettingStarted } from './GettingStarted'
import { isBlankPlan } from '../../lib/blank'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { addMoney, atLeastZero, formatMoney, isNegative, subMoney } from '../../lib/money'
import { monthLabel, monthLabelLong } from '../../lib/months'
import { goalNameById, statusText, toneOf, usualRow } from '../../lib/outcome'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRemote } from '../../state/useRemote'
import { useShellCopy } from '../../state/useShellCopy'
import { useStore } from '../../state/useStore'
import type { PageProps } from '../types'

const SECTIONS = ['summary', 'cashflow', 'goals', 'emergency', 'investments', 'debt', 'insurance', 'trajectory', 'scenario', 'alerts'] as const

type Range = '12' | '24' | 'all'

const link = 'text-[14px] font-semibold underline'

function Pill({ tone, children }: { tone: 'good' | 'late'; children: string }) {
  return <span className={`inline-block rounded-xl px-3 py-1 text-[13px] font-semibold ${tone === 'late' ? 'bg-blush text-late' : 'bg-sage text-ontime'}`}>{children}</span>
}

/** Money left each month and the total set aside, both read from the engine's month-by-month rows. */
function Charts({ result }: { result: ProjectionResult }) {
  const d = useModulesCopy().dashboard
  const { language } = useStore()
  const [range, setRange] = useState<Range>('12')
  const rows = result.monthly ?? []
  const count = range === 'all' ? rows.length : Math.min(Number(range), rows.length)
  const bars = rows.slice(0, count).map((row) => ({ label: monthLabel(row.month, language), value: row.surplus }))
  const saved = rows.map((row) => ({ label: monthLabel(row.month, language), value: addMoney('0.00', ...row.goals.map((goal) => goal.balance)) }))

  return (
    <>
      <Panel
        id="dash-cashflow"
        title={d.barsTitle}
        aside={
          <div role="group" aria-label={d.ranges.label} className="flex gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
            {(['12', '24', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => setRange(value)}
                className={`min-h-9 rounded-xl px-4 ${range === value ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'}`}
              >
                {value === '12' ? d.ranges.year : value === '24' ? d.ranges.two : d.ranges.all}
              </button>
            ))}
          </div>
        }
      >
        {bars.length ? <HatchedBars points={bars} summary={d.barsSummary(bars.length)} /> : null}
      </Panel>
      <Panel id="dash-trajectory" title={d.savedTitle} aside={<span className="text-[13px] text-muted">{d.sections.trajectory}</span>}>
        <AreaLine points={saved} summary={d.savedSummary} />
      </Panel>
    </>
  )
}

export function DashboardPage({ navigate }: PageProps) {
  const m = useModulesCopy()
  const d = m.dashboard
  const shell = useShellCopy()
  const { text, language, plan, projection, activeChoice } = useStore()
  const worth = useRemote('net-worth', (signal) => api.netWorth(signal))
  const holdings = useRemote('investments', (signal) => api.investments(signal))
  const loans = useRemote('liabilities', (signal) => api.liabilities(signal))
  const cover = useRemote('cover', (signal) => api.insuranceDashboard(signal))
  const reminders = useRemote('reminders', (signal) => api.reminders(signal))

  if (!plan) {
    return (
      <Panel>
        <h2 className="font-display text-[24px] font-bold">{d.setupTitle}</h2>
        <p className="text-muted">{d.setupBody}</p>
        <button type="button" onClick={() => navigate('onboarding')} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white">
          {m.common.startSetup}
        </button>
      </Panel>
    )
  }

  const result = projection.data
  const row = result ? usualRow(result) : undefined
  const emergency = plan.goals.find((goal) => goal.type === 'emergency_fund')
  const have = emergency?.current_savings ?? '0.00'
  const shortBy = emergency ? atLeastZero(subMoney(emergency.target_amount_today, have)) : '0.00'
  const onTime = result ? result.goals.filter((goal) => goal.status === 'on_track').length : 0
  const open = reminders.data?.filter((item) => !item.is_acknowledged) ?? []

  return (
    <>
      <PageActions>
        <SectionNavigator label={d.jump} sections={SECTIONS.map((id) => ({ id: `dash-${id}`, label: d.sections[id] }))} />
      </PageActions>
      {isBlankPlan(plan) ? <GettingStarted navigate={navigate} /> : null}

      <div className="grid gap-5 lg:grid-cols-12">
        <section id="dash-summary" aria-labelledby="dash-summary-title" className="water-card relative flex min-w-0 scroll-mt-24 flex-col justify-between gap-6 overflow-hidden rounded-3xl p-6 text-white lg:col-span-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="dash-summary-title" className="font-display text-[20px] font-bold tracking-tight">
              {d.sections.summary}
            </h2>
            <span className="text-[13px] text-white/70">{m.common.typedByYou}</span>
          </div>
          <Loaded remote={worth}>
            {(w) => (
              <>
                <div>
                  <p className="text-[14px] text-white/75">{d.netWorth}</p>
                  <p className="font-figures text-[34px] leading-tight font-semibold sm:text-[40px]">
                    <Money amount={w.net_worth} tone="light" />
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-[15px]">
                  <div className="rounded-2xl bg-white/15 p-3">
                    <p className="text-white/75">{d.assets}</p>
                    <p className="font-figures text-[20px] font-semibold">{formatMoney(w.total_assets)}</p>
                    <p className="text-[13px] text-white/70">
                      {m.common.liquid}: {formatMoney(w.liquid_assets)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/15 p-3">
                    <p className="text-white/75">{d.liabilities}</p>
                    <p className="font-figures text-[20px] font-semibold">{formatMoney(w.total_liabilities)}</p>
                  </div>
                </div>
                <p className="text-[13px] text-white/80">{m.assets.netNote}</p>
              </>
            )}
          </Loaded>
        </section>

        <div className="flex min-w-0 flex-col gap-5 lg:col-span-7">
          {result ? (
            <Charts result={result} />
          ) : (
            <Panel id="dash-cashflow" title={d.barsTitle}>
              <Loaded remote={projection}>{() => null}</Loaded>
            </Panel>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <Panel title={d.sections.cashflow} aside={<span className="text-[13px] text-muted">{m.common.fromEngine}</span>}>
            {row ? (
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat label={d.income} value={formatMoney(row.income)} />
                <Stat label={d.spending} value={formatMoney(row.expenses)} />
                <Stat label={d.loanPayments} value={formatMoney(row.commitments)} />
                <Stat
                  label={isNegative(row.surplus) ? d.deficit : d.surplus}
                  value={formatMoney(isNegative(row.surplus) ? subMoney('0.00', row.surplus) : row.surplus)}
                  tone={isNegative(row.surplus) ? 'late' : 'good'}
                />
              </div>
            ) : (
              <Loaded remote={projection}>{() => null}</Loaded>
            )}
          </Panel>

          <Panel
            id="dash-goals"
            title={d.sections.goals}
            aside={
              <button type="button" onClick={() => navigate('outlook-feasibility')} className={link}>
                {shell.nav.outlookItems.feasibility}
              </button>
            }
          >
            <Loaded remote={projection}>
              {(r) => (
                <>
                  <p className="font-semibold">{d.goalsOnTime(onTime, r.goals.length)}</p>
                  <Notice tone={onTime === r.goals.length ? undefined : 'warn'}>{onTime === r.goals.length ? d.allOnTime : d.someLate}</Notice>
                  <Table
                    caption={d.sections.goals}
                    head={[d.table.goal, d.table.date, d.table.status]}
                    rows={r.goals.map((goal) => [
                      goalNameById(text, plan, goal.goal_id),
                      monthLabelLong(goal.target_date, language),
                      <Pill key={goal.goal_id} tone={toneOf(goal)}>
                        {statusText(text, goal)}
                      </Pill>,
                    ])}
                  />
                </>
              )}
            </Loaded>
          </Panel>

          <Panel id="dash-investments" title={d.sections.investments} aside={<button type="button" onClick={() => navigate('equities')} className={link}>{m.common.open}</button>}>
            <Loaded remote={holdings}>
              {(list) =>
                list.length === 0 ? (
                  <p className="text-muted">{d.noInvestments}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {list.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {h.asset_name} <span className="text-[13px] text-muted">{h.last_valuation_date ? d.valuedOn(h.last_valuation_date) : d.noDate}</span>
                        </span>
                        <Money amount={h.current_value} className="font-figures font-semibold" />
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>

          <Loaded remote={projection}>{(r) => <MonthlyBars plan={plan} result={r} />}</Loaded>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <Panel id="dash-debt" title={d.sections.debt} aside={<button type="button" onClick={() => navigate('debts')} className={link}>{m.common.open}</button>}>
            <Loaded remote={loans}>
              {(list) =>
                list.length === 0 ? (
                  <p className="text-muted">{d.noLoans}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {list.map((loan) => (
                      <li key={loan.id} className="flex flex-col gap-0.5">
                        <span className="font-semibold">{loan.liability_name}</span>
                        <span className="font-figures text-[15px]">
                          {d.owed}: <Money amount={loan.current_balance} />
                        </span>
                        <span className="font-figures text-[14px] text-muted">
                          {d.monthlyPayment}: {formatMoney(loan.monthly_emi)}
                        </span>
                      </li>
                    ))}
                    <li className="border-t border-line pt-2 font-semibold">
                      {m.common.total}: <Money amount={addMoney('0.00', ...list.map((loan) => loan.current_balance))} />
                    </li>
                  </ul>
                )
              }
            </Loaded>
          </Panel>

          <Panel id="dash-emergency" title={d.sections.emergency} aside={<span className="text-[13px] text-muted">{m.common.typedByYou}</span>}>
            {emergency ? (
              <div className="grid gap-4">
                <Stat label={d.emergencyHave} value={formatMoney(have)} />
                <Stat label={d.emergencyTarget} value={formatMoney(emergency.target_amount_today)} />
                <Stat label={d.emergencyShort} value={formatMoney(shortBy)} tone={shortBy === '0.00' ? 'good' : 'late'} />
              </div>
            ) : (
              <Notice>{d.noEmergencyGoal}</Notice>
            )}
          </Panel>

          <Panel id="dash-insurance" title={d.sections.insurance} aside={<button type="button" onClick={() => navigate('insurance')} className={link}>{m.common.open}</button>}>
            <Loaded remote={cover}>
              {(c) => (
                <div className="grid gap-4">
                  <Stat label={d.coverNow} value={formatMoney(c.total_effective_cover)} />
                  <Stat label={d.nextIncrease} value={c.next_increase_date ?? '–'} note={c.next_increase_amount ? formatMoney(c.next_increase_amount) : undefined} />
                  <Stat label={shell.nav.alerts} value={String(c.upcoming_alerts_count)} />
                </div>
              )}
            </Loaded>
          </Panel>

          <Panel id="dash-scenario" title={d.sections.scenario}>
            <p>
              {d.scenarioNow}: <strong>{shell.header.scenarios[activeChoice]}</strong>. {d.scenarioHow}
            </p>
          </Panel>

          <Panel id="dash-alerts" title={d.sections.alerts} aside={<button type="button" onClick={() => navigate('alerts')} className={link}>{m.common.open}</button>}>
            <Loaded remote={reminders}>
              {() =>
                open.length === 0 ? (
                  <p className="text-muted">{d.nothingDue}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {open.slice(0, 5).map((item) => (
                      <li key={item.id} className="flex flex-wrap justify-between gap-2">
                        <span>{item.message}</span>
                        <span className="font-figures text-muted">{item.due_date}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Panel>
        </div>
      </div>
    </>
  )
}
