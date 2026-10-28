import { api } from '../../api/client'
import { Loaded, Notice, Panel, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { monthLabelLong } from '../../lib/months'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { useStore } from '../../state/useStore'

const money = (value: string) => formatMoney(value, { paise: true })

/** The debts the person recorded, each run to payoff on the debt engine and added up by calendar year. */
export function RecordedDebts() {
  const t = useRestructureCopy().debtTrajectory
  const { language } = useStore()
  const trajectory = useRemote('debt-trajectory', (signal) => api.debtTrajectory(signal))

  return (
    <Panel id="debt-trajectory" title={t.title}>
      <p className="text-muted">{t.intro}</p>
      <Loaded remote={trajectory}>
        {(data) =>
          data.loans.length === 0 ? (
            <p className="text-muted">{t.empty}</p>
          ) : (
            <>
              <Table
                caption={t.title}
                head={[t.loan, t.balance, t.payment, t.rate, t.months, t.freeBy, t.interest]}
                rows={data.loans.map((loan) => [
                  loan.name,
                  money(loan.opening_balance),
                  money(loan.monthly_payment),
                  `${(Number(loan.annual_rate) * 100).toFixed(2)}%`,
                  loan.months_to_payoff ? String(loan.months_to_payoff) : '–',
                  loan.debt_free_month ? monthLabelLong(loan.debt_free_month, language) : t.limited,
                  loan.total_interest ? money(loan.total_interest) : '–',
                ])}
              />
              <ul className="list-disc space-y-1 pl-6 text-[14px]">
                {data.loans
                  .filter((loan) => loan.status === 'limited' || loan.paid_later_than_recorded)
                  .map((loan) => (
                    <li key={loan.id}>
                      <strong>{loan.name}:</strong> {loan.status === 'limited' ? loan.reason : t.later}
                    </li>
                  ))}
              </ul>
              {data.years.length > 0 ? (
                <>
                  <h3 className="font-semibold">{t.yearTitle}</h3>
                  <Table
                    caption={t.yearTitle}
                    head={[t.year, t.monthsIn, t.payments, t.principal, t.interestCol, t.closing]}
                    rows={data.years.map((row) => [String(row.year), String(row.months_included), money(row.payments), money(row.principal), money(row.interest), money(row.closing_balance)])}
                  />
                  {data.years.some((row) => row.months_included < 12) ? <p className="text-[13px] text-muted">{t.partial}</p> : null}
                  <p className="text-[14px]">
                    {t.totalInterest}: <strong className="font-figures">{money(data.total_interest)}</strong>
                    {data.debt_free_month ? (
                      <>
                        {' · '}
                        {t.free} <strong>{monthLabelLong(data.debt_free_month, language)}</strong>
                      </>
                    ) : null}
                  </p>
                </>
              ) : null}
              <Notice tone={data.complete ? undefined : 'warn'}>{data.complete ? t.complete : t.incomplete}</Notice>
            </>
          )
        }
      </Loaded>
      <Notice>{t.separate}</Notice>
    </Panel>
  )
}
