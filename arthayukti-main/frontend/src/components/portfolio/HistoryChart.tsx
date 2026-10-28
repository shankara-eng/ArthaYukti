import type { PortfolioHistory } from '../../api/types'
import type { PortfolioCopy } from '../../i18n/portfolio'
import { formatMoney, toPaise } from '../../lib/money'
import { RANGES, type Range } from '../../lib/portfolio'

const W = 640
const H = 200
const money = (amount: string) => formatMoney(amount, { paise: true })
const px = (amount: string) => Number(toPaise(amount)) // positions only; every figure shown is the server's string
const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime()

interface Props {
  history: PortfolioHistory
  range: Range
  onRange: (range: Range) => void
  copy: PortfolioCopy
}

/**
 * Honest history. The amount invested over time is real (from the dated purchases). A value line is drawn only from
 * recorded value readings and only with at least two complete ones: there are no past prices to fill in with.
 */
export function HistoryChart({ history, range, onRange, copy }: Props) {
  const t = copy.history
  const invested = history.invested_timeline
  const readings = history.snapshots.filter((s) => s.complete)
  const hasValueLine = readings.length >= 2
  const allDates = [...invested.map((p) => day(p.date)), ...(hasValueLine ? readings.map((p) => day(p.date)) : [])]
  const lo = Math.min(...allDates)
  const hi = Math.max(...allDates)
  const values = [...invested.map((p) => px(p.invested)), ...(hasValueLine ? readings.map((p) => px(p.market_value)) : [])]
  const top = Math.max(...values, 1)
  const x = (date: string) => (hi === lo ? W / 2 : 8 + ((day(date) - lo) / (hi - lo)) * (W - 16))
  const y = (value: number) => 10 + (1 - value / top) * (H - 24)
  const line = (points: { date: string; value: number }[]) => points.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const drawable = invested.length >= 2 || hasValueLine
  const first = invested[0]
  const last = invested[invested.length - 1]

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t.rangeLabel} className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
        {RANGES.map((value) => (
          <button key={value} type="button" aria-pressed={range === value} onClick={() => onRange(value)} className={`min-h-10 rounded-lg px-3 ${range === value ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'}`}>
            {t.ranges[value]}
          </button>
        ))}
      </div>

      {invested.length === 0 ? <p className="text-muted">{t.noInvested}</p> : null}
      {invested.length > 0 && !drawable ? (
        <p className="text-[14px]">
          {money(invested[0].invested)} · {invested[0].date}
        </p>
      ) : null}
      {drawable ? (
        <figure className="m-0 flex flex-col gap-2">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={first && last ? t.summary(first.date, money(first.invested), last.date, money(last.invested)) : t.title}
            preserveAspectRatio="none"
            className="h-44 w-full rounded-xl bg-cream"
          >
            {invested.length >= 2 ? <polyline fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={line(invested.map((p) => ({ date: p.date, value: px(p.invested) })))} /> : null}
            {hasValueLine ? (
              <polyline fill="none" stroke="var(--color-ontime)" strokeWidth="2.5" strokeDasharray="7 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={line(readings.map((p) => ({ date: p.date, value: px(p.market_value) })))} />
            ) : null}
          </svg>
          <div className="flex justify-between text-[13px] text-muted">
            <span>{new Date(lo).toISOString().slice(0, 10)}</span>
            <span>{new Date(hi).toISOString().slice(0, 10)}</span>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <li>{t.invested}</li>
            {hasValueLine ? <li>{t.value}</li> : null}
          </ul>
        </figure>
      ) : null}
      <p className="text-[13px] text-muted">{t.investedNote}</p>

      {history.since === null ? <p className="text-[14px]">{t.noValue}</p> : <p className="text-[14px]">{t.since(history.since, history.snapshots.length)}</p>}
      {history.since !== null && readings.length === 1 ? <p className="text-[13px] text-muted">{t.onlyOne}</p> : null}
      {history.snapshots.some((s) => !s.complete) ? <p className="text-[13px] text-muted">{t.incompleteNote}</p> : null}
      {history.snapshots.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-[14px]">
            <caption className="sr-only">{t.table}</caption>
            <thead className="text-[13px] text-muted">
              <tr>
                {[t.date, t.investedCol, t.valueCol].map((label) => (
                  <th key={label} scope="col" className="border-b border-line py-2 pr-4 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.snapshots.slice(-8).map((s) => (
                <tr key={s.date} className="border-b border-line/60">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {s.date}
                  </th>
                  <td className="font-figures py-2 pr-4">{money(s.invested)}</td>
                  <td className="font-figures py-2 pr-4">{money(s.market_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
