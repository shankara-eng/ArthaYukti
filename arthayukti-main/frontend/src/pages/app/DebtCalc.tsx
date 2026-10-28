import { useState } from 'react'
import { ApiFailure, api } from '../../api/client'
import type { AmortizationResponse, StrategyComparisonResponse } from '../../api/types'
import { AmountField, FormError, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { percentToRate } from '../../lib/onboarding'
import { useAction } from '../../state/useAction'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'

const submit = 'min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60'
const PREVIEW_ROWS = 12

function money(amount: string) {
  return formatMoney(amount, { paise: true })
}

/** A loan repayment calculation and a repayment-order comparison, both worked out by the backend's debt engine. */
export function DebtCalculator() {
  const t = useRestructureCopy().debt
  const [balance, setBalance] = useState('')
  const [rate, setRate] = useState('')
  const [months, setMonths] = useState('')
  const [payment, setPayment] = useState('')
  const [extra, setExtra] = useState('')
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<AmortizationResponse | null>(null)
  const [shown, setShown] = useState<{ balance: string; rate: string; months: string; payment: string; extra: string } | null>(null)
  const [all, setAll] = useState(false)
  const run = useAction()

  const rateOk = rate.trim() !== '' && percentToRate(rate) !== null
  const monthsOk = /^[1-9]\d{0,3}$/.test(months) && Number(months) <= 1200

  async function calculate() {
    setTried(true)
    if (balance === '' || !rateOk || !monthsOk) return
    setResult(null)
    setAll(false)
    const ok = await run.run(async () => {
      const answer = await api.debtAmortize({
        principal: balance,
        annual_interest_rate: percentToRate(rate) as string,
        tenure_months: Number(months),
        monthly_emi: payment === '' ? null : payment,
        extra_monthly_payment: extra === '' ? '0.00' : extra,
      })
      setResult(answer)
      setShown({ balance, rate, months, payment, extra })
    })
    if (!ok) setShown(null)
  }

  const failureText =
    run.failure instanceof ApiFailure ? (t.errors as Record<string, string>)[run.failure.code] ?? t.errors.generic : run.failure ? t.errors.generic : null
  const rows = result ? (all ? result.schedule : result.schedule.slice(0, PREVIEW_ROWS)) : []

  return (
    <>
      <Panel id="debt-calc" title={t.title}>
        <p className="text-muted">{t.intro}</p>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void calculate()
          }}
        >
          <AmountField label={t.balance} value={balance} onChange={setBalance} error={tried && balance === '' ? t.enterBalance : null} />
          <TextField label={t.rate} hint={t.rateHint} value={rate} onChange={setRate} inputMode="decimal" error={tried && !rateOk ? t.badRate : null} />
          <TextField label={t.months} value={months} onChange={setMonths} inputMode="numeric" error={tried && !monthsOk ? t.badMonths : null} />
          <AmountField label={t.payment} hint={t.paymentHint} value={payment} onChange={setPayment} />
          <AmountField label={t.extra} value={extra} onChange={setExtra} />
          {failureText ? (
            <div className="sm:col-span-2">
              <FormError>{failureText}</FormError>
            </div>
          ) : null}
          <button type="submit" disabled={run.busy} className={submit}>
            {run.busy ? t.calculating : t.calculate}
          </button>
        </form>

        {result && shown ? (
          <div role="region" aria-label={t.calculated} className="flex flex-col gap-4">
            <div className="rounded-xl bg-sand p-4 text-[14px]">
              <p className="font-semibold">{t.youEntered}</p>
              <p>
                {t.balance}: {formatMoney(shown.balance)} · {t.rate}: {shown.rate}% · {t.months}: {shown.months}
                {shown.payment ? ` · ${t.payment}: ${formatMoney(shown.payment)}` : ''}
                {shown.extra ? ` · ${t.extra}: ${formatMoney(shown.extra)}` : ''}
              </p>
            </div>
            <h3 className="font-semibold">{t.calculated}</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t.emi} value={money(result.monthly_emi)} />
              <Stat label={t.effective} value={String(result.effective_months)} />
              <Stat label={t.interest} value={money(result.total_interest_paid)} />
              <Stat label={t.paid} value={money(result.total_amount_paid)} />
              {result.months_saved > 0 ? <Stat label={t.monthsSaved} value={String(result.months_saved)} tone="good" /> : null}
              {Number(result.interest_saved) > 0 ? <Stat label={t.saved} value={money(result.interest_saved)} tone="good" /> : null}
            </div>
            <Table
              caption={t.schedule}
              head={t.scheduleHead}
              rows={rows.map((row) => [String(row.month), money(row.payment), money(row.principal_paid), money(row.interest_paid), money(row.remaining_balance)])}
            />
            {result.schedule.length > PREVIEW_ROWS ? (
              <button type="button" onClick={() => setAll((value) => !value)} className="min-h-10 self-start rounded-xl border border-line px-4 font-semibold">
                {all ? t.showLess : t.showAll}
              </button>
            ) : null}
          </div>
        ) : null}
        <Notice>{t.estimate}</Notice>
      </Panel>
      <Compare />
    </>
  )
}

function Compare() {
  const t = useRestructureCopy().debt
  const loans = useRemote('loans', (signal) => api.liabilities(signal))
  const [budget, setBudget] = useState('')
  const [answer, setAnswer] = useState<StrategyComparisonResponse | null>(null)
  const run = useAction()
  const none = (loans.data?.filter((loan) => Number(loan.current_balance) > 0).length ?? 0) === 0

  async function compare() {
    setAnswer(null)
    await run.run(async () => setAnswer(await api.debtCompare({ debts: null, extra_monthly_budget: budget === '' ? '0.00' : budget })))
  }

  return (
    <Panel id="debt-compare" title={t.compareTitle}>
      <p className="text-muted">{t.compareIntro}</p>
      <Loaded remote={loans}>
        {() =>
          none ? (
            <p className="text-muted">{t.noDebts}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <AmountField label={t.budget} value={budget} onChange={setBudget} />
              </div>
              {run.failure ? <FormError>{t.compareFailed}</FormError> : null}
              <button type="button" disabled={run.busy} onClick={() => void compare()} className={submit}>
                {run.busy ? t.comparing : t.compare}
              </button>
            </>
          )
        }
      </Loaded>
      {answer ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {([['avalanche', answer.avalanche], ['snowball', answer.snowball]] as const).map(([key, strategy]) => (
              <div key={key} className="rounded-2xl border border-line p-4">
                <h3 className="font-semibold">{t[key]}</h3>
                <Stat label={t.interest} value={money(strategy.total_interest_paid)} />
                <Stat label={t.monthsFree} value={String(strategy.months_to_debt_free)} />
                <p className="mt-2 text-[14px] text-muted">{t.order}</p>
                <ol className="list-decimal pl-5 text-[15px]">
                  {strategy.payoff_order.map((item) => (
                    <li key={item.id}>
                      {item.name} <span className="text-muted">(#{item.payoff_month})</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p>
            <strong>{t.difference}:</strong> {money(answer.interest_difference)}
          </p>
          <Notice>{answer.recommendation}</Notice>
        </div>
      ) : null}
    </Panel>
  )
}
