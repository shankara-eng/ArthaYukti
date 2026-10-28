import { Fragment, useState } from 'react'
import type { TrajectoryLedgerMonth } from '../../api/types'
import type { TrajectoryCopy } from '../../i18n/trajectory'
import { allEvents } from '../../lib/trajectory'
import { formatMoney } from '../../lib/money'
import { monthLabel, type Language } from '../../lib/months'

const PAGE = 24

/**
 * The monthly detail: opening and closing figures per month, and on request every event that month with its effect on
 * cash, assets, debts and net worth. Long tables collapse to one row per month with details on demand.
 */
export function TrajectoryLedger({ rows, copy, language }: { rows: TrajectoryLedgerMonth[]; copy: TrajectoryCopy; language: Language }) {
  const t = copy.ledger
  const [shown, setShown] = useState(PAGE)
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())
  const toggle = (month: string) =>
    setOpenMonths((current) => {
      const next = new Set(current)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-[15px]">
          <caption className="sr-only">{t.title}</caption>
          <thead className="text-[13px] text-muted">
            <tr>
              {[t.month, t.opening, t.closing, t.cash, ''].map((label, index) => (
                <th key={index} scope="col" aria-label={label ? undefined : t.expand} className="border-b border-line py-2 pr-4 font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => {
              const open = openMonths.has(row.month)
              const events = allEvents(row)
              return (
                <Fragment key={row.month}>
                  <tr className="border-b border-line/60">
                    <th scope="row" className="py-2 pr-4 font-semibold">
                      {monthLabel(row.month, language)}
                    </th>
                    <td className="font-figures py-2 pr-4">{formatMoney(row.opening_balances.net_worth)}</td>
                    <td className="font-figures py-2 pr-4">{formatMoney(row.closing_balances.net_worth)}</td>
                    <td className="font-figures py-2 pr-4">{formatMoney(row.closing_balances.cash)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? t.collapse : t.expand} ${monthLabel(row.month, language)}`}
                        onClick={() => toggle(row.month)}
                        className="min-h-9 rounded-lg border border-line px-3 text-[14px] font-semibold"
                      >
                        {open ? t.collapse : t.expand}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b border-line/60 bg-sand/40">
                      <td colSpan={5} className="p-3">
                        <div className="flex flex-col gap-3">
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-4">
                            <div>
                              <dt className="text-muted">{t.openingBalances}</dt>
                              <dd className="font-figures">{formatMoney(row.opening_balances.total_assets)} / {formatMoney(row.opening_balances.total_liabilities)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted">{t.closingBalances}</dt>
                              <dd className="font-figures">{formatMoney(row.closing_balances.total_assets)} / {formatMoney(row.closing_balances.total_liabilities)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted">{t.cash}</dt>
                              <dd className="font-figures">{formatMoney(row.closing_balances.cash)}</dd>
                            </div>
                            {Number(row.uncovered_cash_deficit) > 0 ? (
                              <div>
                                <dt className="text-late">{t.shortfall}</dt>
                                <dd className="font-figures font-semibold">{formatMoney(row.uncovered_cash_deficit)}</dd>
                              </div>
                            ) : null}
                          </dl>
                          {events.length === 0 ? (
                            <p className="text-muted">{t.nothing}</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[560px] text-left text-[14px]">
                                <caption className="sr-only">{monthLabel(row.month, language)}</caption>
                                <thead className="text-[13px] text-muted">
                                  <tr>
                                    {[t.what, t.cashDelta, t.assetDelta, t.liabilityDelta, t.effect].map((label) => (
                                      <th key={label} scope="col" className="py-1 pr-3 font-normal">
                                        {label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {events.map((event, index) => (
                                    <tr key={`${event.kind}-${event.source_id ?? ''}-${index}`} className="align-top">
                                      <th scope="row" className="py-1 pr-3 font-normal">
                                        <span className="font-semibold">{event.label}</span>
                                        {event.principal !== null && event.interest !== null ? (
                                          <span className="block text-muted">
                                            {t.principal} {formatMoney(event.principal)} · {t.interest} {formatMoney(event.interest)}
                                          </span>
                                        ) : null}
                                        <span className="block text-muted">{event.note}</span>
                                      </th>
                                      <td className="font-figures py-1 pr-3">{formatMoney(event.cash_delta)}</td>
                                      <td className="font-figures py-1 pr-3">{formatMoney(event.asset_delta)}</td>
                                      <td className="font-figures py-1 pr-3">{formatMoney(event.liability_delta)}</td>
                                      <td className="font-figures py-1 pr-3 font-semibold">{formatMoney(event.net_worth_effect)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {shown < rows.length ? (
        <button type="button" onClick={() => setShown((count) => count + PAGE)} className="min-h-11 self-start rounded-xl border border-ink px-4 font-semibold">
          {t.more}
        </button>
      ) : null}
    </div>
  )
}
