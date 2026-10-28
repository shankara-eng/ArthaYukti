import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { ApiFailure, api } from '../api/client'
import { FormError } from '../components/forms'
import { OrbitScene } from '../components/OrbitScene'
import { Wordmark } from '../components/Wordmark'
import { LanguageControl } from '../components/Controls'
import { onboardingCopy, type OnboardingCopy } from '../i18n/onboarding'
import { formatMoney, isNegative } from '../lib/money'
import { monthLabelLong } from '../lib/months'
import {
  buildPlan,
  emptyDraft,
  expenseIssues,
  goalIssues,
  incomeIssues,
  percentToRate,
  preview,
  type Draft,
} from '../lib/onboarding'
import { isBlankPlan } from '../lib/blank'
import { goalNameById, statusText, toneOf, usualRow } from '../lib/outcome'
import { useAuth } from '../state/useAuth'
import { useStore } from '../state/useStore'
import {
  AssetsStep,
  CashStep,
  DebtsStep,
  ExpensesStep,
  GoalsStep,
  IncomeStep,
  InsuranceStep,
  WelcomeStep,
} from './onboarding/Steps'
import type { PageProps } from './types'

const STEPS = ['welcome', 'income', 'expenses', 'cash', 'assets', 'debts', 'goals', 'insurance', 'review', 'outlook'] as const
type StepId = (typeof STEPS)[number]
const OPTIONAL: StepId[] = ['cash', 'assets', 'debts', 'insurance']
const filled = (value: string) => value.trim() !== ''

function stepValid(step: StepId, draft: Draft): boolean {
  switch (step) {
    case 'income':
      return draft.income.every((row) => incomeIssues(row, draft.asOf).length === 0)
    case 'expenses':
      return draft.expenses.every((row) => row.amount === '' || expenseIssues(row).length === 0)
    case 'cash':
      return (
        draft.accounts.every((row) => filled(row.name) && filled(row.balance)) &&
        /^\d{1,2}$/.test(draft.emergencyMonths) &&
        Number(draft.emergencyMonths) > 0
      )
    case 'assets':
      return draft.investments.every((row) => filled(row.name) && filled(row.currentValue))
    case 'debts':
      return draft.liabilities.every(
        (row) =>
          filled(row.name) &&
          filled(row.balance) &&
          filled(row.payment) &&
          (row.ratePercent.trim() === '' || percentToRate(row.ratePercent) !== null) &&
          (row.remainingMonths === '' || /^[1-9]\d{0,3}$/.test(row.remainingMonths)),
      )
    case 'goals':
      return (
        draft.goals.length > 0 &&
        draft.goals.every((row) => goalIssues(row, draft.asOf).length === 0) &&
        percentToRate(draft.inflationPercent) !== null
      )
    case 'insurance':
      return draft.policies.every((row) => filled(row.insurer) && filled(row.cover) && filled(row.premium) && filled(row.startDate))
    default:
      return true
  }
}

/** Rows that are complete enough to save. Anything partly filled and skipped is left out, not guessed. */
function completeRecords(draft: Draft) {
  return {
    accounts: draft.accounts.filter((row) => filled(row.name) && filled(row.balance)),
    investments: draft.investments.filter((row) => filled(row.name) && filled(row.currentValue)),
    liabilities: draft.liabilities.filter((row) => filled(row.name) && filled(row.balance) && filled(row.payment)),
    policies: draft.policies.filter((row) => filled(row.insurer) && filled(row.cover) && filled(row.premium) && filled(row.startDate)),
  }
}

const safeCode = (value: string, fallback: string) => {
  const cleaned = value.replace(/[^A-Za-z0-9._/\- ]/g, '-').trim().slice(0, 40)
  return cleaned || fallback
}

export function OnboardingPage({ navigate }: PageProps) {
  const { language, text, plan, savePlan, replacePlan } = useStore()
  // Someone who already has a plan is not asked to start again, which would duplicate their records.
  const [hadPlan] = useState(() => plan !== null && !isBlankPlan(plan))
  useEffect(() => {
    if (hadPlan) navigate('dashboard')
  }, [hadPlan, navigate])
  const auth = useAuth()
  const c = onboardingCopy[language]
  const [draft, setDraftState] = useState<Draft>(() => emptyDraft())
  const [step, setStep] = useState(0)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const created = useRef(new Set<string>())
  const current = STEPS[step]

  const setDraft = (change: (value: Draft) => Draft) => {
    setDirty(true)
    setDraftState(change)
  }

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function go(next: number) {
    setTried(false)
    setFailure(null)
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)))
    window.scrollTo({ top: 0 })
  }

  function advance() {
    if (!stepValid(current, draft)) {
      setTried(true)
      return
    }
    go(step + 1)
  }

  async function commit(thenOutlook: boolean) {
    const built = buildPlan(draft, auth.user?.full_name || 'My household')
    if (!built.plan) {
      setFailure(built.problems.includes('no_goal') ? c.errors.needGoal : c.errors.limits)
      if (built.problems.includes('no_goal')) go(STEPS.indexOf('goals'))
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      const records = completeRecords(draft)
      for (const row of records.accounts) {
        if (created.current.has(row.id)) continue
        await api.createAccount({ account_name: row.name.trim(), account_type: row.kind, balance: row.balance, currency: 'INR', is_liquid: row.liquid })
        created.current.add(row.id)
      }
      for (const row of records.investments) {
        if (created.current.has(row.id)) continue
        await api.createInvestment({
          asset_name: row.name.trim(),
          asset_type: row.kind,
          quantity: '1.0000',
          purchase_price: filled(row.costBasis) ? row.costBasis : row.currentValue,
          current_value: row.currentValue,
          is_liquid: row.liquid,
          last_valuation_date: row.valuationDate || null,
        })
        created.current.add(row.id)
      }
      for (const row of records.liabilities) {
        if (created.current.has(row.id)) continue
        const rate = percentToRate(row.ratePercent)
        await api.createLiability({
          liability_name: row.name.trim(),
          liability_type: row.kind,
          principal_amount: row.balance,
          current_balance: row.balance,
          interest_rate: rate ?? '0.000000',
          monthly_emi: row.payment,
          remaining_months: /^[1-9]\d*$/.test(row.remainingMonths) ? Number(row.remainingMonths) : 0,
        })
        created.current.add(row.id)
      }
      for (const [index, row] of records.policies.entries()) {
        if (created.current.has(row.id)) continue
        await api.createPolicy({
          policy_number: safeCode(row.reference, `POLICY-${index + 1}`),
          policy_type: row.kind,
          insurer_name: row.insurer.trim(),
          plan_name: (row.label.trim() || row.insurer.trim()).slice(0, 120),
          start_date: row.startDate,
          base_sum_assured: row.cover,
          premium_amount: row.premium,
          premium_frequency: 'annual',
          status: 'active',
        })
        created.current.add(row.id)
      }
      replacePlan(built.plan)
      const saved = await savePlan(built.plan)
      if (!saved) {
        setFailure(c.review.saveFailed)
        return
      }
      setDirty(false)
      if (thenOutlook) go(STEPS.indexOf('outlook'))
      else navigate('dashboard')
    } catch (error) {
      setFailure(error instanceof ApiFailure && error.code === 'offline' ? text.common.offline : c.review.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const props = { draft, setDraft, tried, c }
  const last = current === 'outlook'
  if (hadPlan) return null

  return (
    <div className="min-h-screen p-2 sm:p-4">
      <div className="mx-auto grid max-w-[1500px] gap-3 sm:gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="stage relative flex flex-col gap-6 overflow-hidden rounded-[19px] px-6 py-6 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:px-8 lg:py-10">
        <Wordmark size="lg" surface="dark" />
        <ol className="hidden flex-col gap-2 lg:flex" aria-label={c.stepOf(step + 1, STEPS.length)}>
          {STEPS.map((id, index) => (
            <li key={id} className={`flex items-center gap-3 text-[15px] ${index === step ? 'font-semibold text-ink' : index < step ? 'text-muted' : 'text-muted/60'}`} aria-current={index === step ? 'step' : undefined}>
              <span className={`flex size-6 items-center justify-center rounded-full border text-[12px] ${index < step ? 'border-glow bg-glow text-night' : index === step ? 'border-ink' : 'border-night-line'}`}>
                {index < step ? <Check size={14} aria-hidden="true" /> : index + 1}
              </span>
              {c.steps[id]}
            </li>
          ))}
        </ol>
        <OrbitScene revealed={Math.ceil((step / (STEPS.length - 1)) * 6)} className="absolute -right-24 -bottom-24 hidden w-[420px] opacity-70 lg:block" />
        <div className="flex items-center justify-between gap-3 lg:hidden">
          <span className="font-semibold">{c.steps[current]}</span>
          <span className="text-[14px] text-muted">{c.stepOf(step + 1, STEPS.length)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-night-line lg:hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-glow transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </aside>

      <main className="glass flex flex-col rounded-[19px] px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-[14px] text-muted">{c.stepOf(step + 1, STEPS.length)}</p>
          <LanguageControl />
        </div>
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6">
          {current === 'welcome' ? <WelcomeStep c={c} /> : null}
          {current === 'income' ? <IncomeStep {...props} /> : null}
          {current === 'expenses' ? <ExpensesStep {...props} /> : null}
          {current === 'cash' ? <CashStep {...props} /> : null}
          {current === 'assets' ? <AssetsStep {...props} /> : null}
          {current === 'debts' ? <DebtsStep {...props} /> : null}
          {current === 'goals' ? <GoalsStep {...props} /> : null}
          {current === 'insurance' ? <InsuranceStep {...props} /> : null}
          {current === 'review' ? <ReviewStep draft={draft} c={c} go={(id) => go(STEPS.indexOf(id))} /> : null}
          {current === 'outlook' ? <OutlookStep c={c} onDone={() => navigate('dashboard')} /> : null}

          {tried && !stepValid(current, draft) ? <FormError>{current === 'goals' && draft.goals.length === 0 ? c.errors.needGoal : c.errors.amount}</FormError> : null}
          {failure ? (
            <FormError>
              {failure}{' '}
              {current === 'review' ? (
                <button type="button" onClick={() => void commit(true)} className="underline">
                  {c.review.retry}
                </button>
              ) : null}
            </FormError>
          ) : null}

          {last ? null : (
            <div className="glass-bar sticky bottom-2 mt-auto flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 sm:px-6">
              {step > 0 ? (
                <button type="button" onClick={() => go(step - 1)} className="min-h-12 rounded-xl border border-line bg-paper px-5 font-semibold">
                  {c.back}
                </button>
              ) : null}
              <span className="mr-auto" />
              {OPTIONAL.includes(current) ? (
                <button type="button" onClick={() => go(step + 1)} className="min-h-12 px-3 font-semibold underline underline-offset-4">
                  {c.skip}
                </button>
              ) : null}
              {current === 'review' ? (
                <button type="button" disabled={saving} onClick={() => void commit(true)} className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
                  {saving ? c.review.building : c.review.build}
                </button>
              ) : (
                <button type="button" onClick={advance} className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-white">
                  {current === 'welcome' ? c.welcome.start : c.next}
                </button>
              )}
              {draft.goals.length > 0 && current !== 'welcome' && current !== 'review' ? (
                <button type="button" disabled={saving} onClick={() => void commit(false)} className="min-h-12 px-3 text-[14px] font-semibold underline underline-offset-4 disabled:opacity-60">
                  {c.save}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </main>
      </div>
    </div>
  )
}

function ReviewStep({ draft, c, go }: { draft: Draft; c: OnboardingCopy; go: (id: StepId) => void }) {
  const t = c.review
  const totals = preview(draft)
  const deficit = isNegative(totals.surplus)
  const records = completeRecords(draft)
  const sorted = [...draft.goals].sort((a, b) => a.tier - b.tier)
  const missing: string[] = []
  if (draft.income.filter((row) => row.include && filled(row.amount)).length === 0) missing.push(`${c.steps.income}: ${c.income.none}`)
  if (draft.expenses.filter((row) => row.include && filled(row.amount)).length === 0) missing.push(`${c.steps.expenses}: ${c.expenses.empty}`)
  for (const row of draft.liabilities) if (filled(row.payment) && !/^[1-9]\d*$/.test(row.remainingMonths)) missing.push(`${row.name || c.steps.debts}: ${c.debts.unknownNote}`)
  const incompleteRows =
    draft.accounts.length - records.accounts.length + (draft.investments.length - records.investments.length) + (draft.liabilities.length - records.liabilities.length) + (draft.policies.length - records.policies.length)
  if (incompleteRows > 0) missing.push(`${incompleteRows}: ${c.errors.amount}`)
  if (!draft.goals.some((row) => row.kind === 'emergency_fund')) missing.push(`${c.steps.goals}: ${c.goals.kinds.emergency_fund}`)

  const edit = (id: StepId) => (
    <button type="button" onClick={() => go(id)} className="text-[14px] font-semibold underline underline-offset-4">
      {t.edit}
    </button>
  )
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[28px] leading-tight font-bold tracking-tight">{t.title}</h2>
        <p className="text-muted">{t.why}</p>
      </div>
      <div className="rounded-2xl glass p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">{t.yourNumbers}</h3>
          {edit('income')}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {([[t.income, totals.income], [t.essential, totals.essential], [t.discretionary, totals.discretionary], [t.loans, totals.loanPayments]] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[14px] text-muted">
                {label} <span className="rounded-xl bg-sand px-2 text-[12px]">{t.entered}</span>
              </dt>
              <dd className="font-figures text-[20px] font-semibold">{formatMoney(value)}</dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className={`text-[14px] font-semibold ${deficit ? 'text-late' : 'text-ontime'}`}>
              {deficit ? t.deficit : t.surplus} <span className="rounded-xl bg-sand px-2 text-[12px] font-normal text-ink">{t.estimate}</span>
            </dt>
            <dd className="font-figures text-[26px] font-semibold">{formatMoney(deficit ? totals.surplus.replace('-', '') : totals.surplus)}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-2xl glass p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">{t.goals}</h3>
          {edit('goals')}
        </div>
        {sorted.length === 0 ? (
          <p className="text-muted">{t.none}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {sorted.map((goal, index) => (
              <li key={goal.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {index + 1}. {goal.label || c.goals.kinds[goal.kind]} <span className="text-[13px] text-muted">({c.goals.tiers[goal.tier]})</span>
                </span>
                <span className="font-figures font-semibold">
                  {filled(goal.amount) ? formatMoney(goal.amount) : '–'} · {goal.date}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[13px] text-muted">
          {c.goals.inflation}: {draft.inflationPercent}% <span className="rounded-xl bg-sand px-2 text-[12px] text-ink">{draft.inflationPercent === '5' ? t.defaultValue : t.entered}</span>
        </p>
      </div>
      <div className="grid gap-3 rounded-2xl glass p-4 text-[15px] sm:grid-cols-2">
        {([['cash', records.accounts.length], ['assets', records.investments.length], ['debts', records.liabilities.length], ['insurance', records.policies.length]] as const).map(([id, count]) => (
          <p key={id} className="flex items-center justify-between gap-2">
            <span>
              {c.steps[id]}: <strong>{count}</strong>
            </span>
            {edit(id)}
          </p>
        ))}
        <p className="text-[13px] text-muted sm:col-span-2">{t.records}</p>
      </div>
      {missing.length > 0 ? (
        <div className="rounded-2xl bg-sand p-4">
          <h3 className="mb-1 font-semibold">{t.incomplete}</h3>
          <ul className="list-disc pl-5 text-[14px]">
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 className="mb-1 font-semibold">{t.assumptionsTitle}</h3>
        <ul className="list-disc pl-5 text-[14px] text-muted">
          {t.assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-[14px] text-muted">{t.notCollected}</p>
      </div>
    </section>
  )
}

function OutlookStep({ c, onDone }: { c: OnboardingCopy; onDone: () => void }) {
  const t = c.outlook
  const { plan, projection, text, language } = useStore()
  const row = projection.data ? usualRow(projection.data) : undefined
  return (
    <section className="flex flex-col gap-5" aria-live="polite">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[28px] leading-tight font-bold tracking-tight">{t.title}</h2>
        <p className="text-[14px] text-muted">{t.disclaimer}</p>
      </div>
      {projection.error ? (
        <FormError>
          {t.failed}{' '}
          <button type="button" onClick={projection.reload} className="underline">
            {t.retry}
          </button>
        </FormError>
      ) : !projection.data || !plan ? (
        <p role="status" className="text-muted">
          {t.building}
        </p>
      ) : (
        <>
          {row ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl glass p-4">
                <p className="text-[14px] text-muted">{t.position}</p>
                <p className="font-figures text-[26px] font-semibold">{formatMoney(row.income)}</p>
              </div>
              <div className="rounded-2xl glass p-4">
                <p className="text-[14px] text-muted">{t.surplus}</p>
                <p className="font-figures text-[26px] font-semibold">{formatMoney(isNegative(row.surplus) ? '0.00' : row.surplus)}</p>
              </div>
            </div>
          ) : null}
          <h3 className="font-semibold">{t.goalsTitle}</h3>
          <ul className="flex flex-col gap-2">
            {projection.data.goals.map((goal) => (
              <li key={goal.goal_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl glass px-4 py-3">
                <span>
                  {goalNameById(text, plan, goal.goal_id)} <span className="text-[13px] text-muted">{monthLabelLong(goal.target_date, language)}</span>
                </span>
                <span className={`font-semibold ${toneOf(goal) === 'late' ? 'text-late' : 'text-ontime'}`}>
                  {statusText(text, goal)}
                </span>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="font-semibold">{t.next}</h3>
            <p className="text-muted">{t.nextBody}</p>
          </div>
          <button type="button" onClick={onDone} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white">
            {t.toDashboard}
          </button>
        </>
      )}
    </section>
  )
}
