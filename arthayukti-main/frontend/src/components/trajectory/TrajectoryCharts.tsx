import type { TrajectoryBalances } from '../../api/types'
import { ALLOCATION_KEYS, type SeriesPoint } from '../../lib/trajectory'
import { formatMoney, share, toPaise } from '../../lib/money'
import { monthLabel, type Language } from '../../lib/months'
import type { TrajectoryCopy } from '../../i18n/trajectory'

// Positions are only for drawing. Every figure that is read out comes from the decimal string the server returned.
const px = (amount: string) => Number(toPaise(amount))

interface Line {
  id: string
  label: string
  values: number[]
  dashed?: boolean
  stroke: string
}

interface LineChartProps {
  title: string
  months: string[]
  lines: Line[]
  summary: string
  language: Language
  legend?: string[]
}

const W = 640
const H = 200

/** One or two lines over the months. Lines differ by dash as well as colour, and each is named in the legend. */
function LineChart({ title, months, lines, summary, language, legend }: LineChartProps) {
  const all = lines.flatMap((line) => line.values)
  const low = Math.min(...all, 0)
  const high = Math.max(...all, 1)
  const span = high - low || 1
  const x = (index: number) => 8 + (index / Math.max(months.length - 1, 1)) * (W - 16)
  const y = (value: number) => 10 + (1 - (value - low) / span) * (H - 24)
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="font-semibold">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none" className="h-44 w-full rounded-xl bg-cream">
        {low < 0 ? <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" /> : null}
        {lines.map((line) => (
          <polyline
            key={line.id}
            fill="none"
            stroke={line.stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeDasharray={line.dashed ? '7 5' : undefined}
            vectorEffect="non-scaling-stroke"
            points={line.values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="flex justify-between gap-2 text-[13px] text-muted">
        <span>{monthLabel(months[0], language)}</span>
        <span>{monthLabel(months[months.length - 1], language)}</span>
      </div>
      {legend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {legend.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </figure>
  )
}

interface ChartsProps {
  points: SeriesPoint[]
  copy: TrajectoryCopy
  language: Language
}

export function TrajectoryCharts({ points, copy, language }: ChartsProps) {
  if (points.length < 2) return null
  const months = points.map((p) => p.month)
  const first = points[0]
  const last = points[points.length - 1]
  const describe = (what: string, pick: (b: TrajectoryBalances) => string) =>
    copy.charts.summary(what, monthLabel(first.month, language), formatMoney(pick(first.balances)), monthLabel(last.month, language), formatMoney(pick(last.balances)))
  const values = (pick: (b: TrajectoryBalances) => string) => points.map((p) => px(pick(p.balances)))
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <LineChart
        title={copy.charts.netWorth}
        months={months}
        language={language}
        summary={describe(copy.charts.netWorth, (b) => b.net_worth)}
        lines={[{ id: 'nw', label: copy.charts.netWorth, values: values((b) => b.net_worth), stroke: 'var(--color-brand)' }]}
      />
      <LineChart
        title={copy.charts.assetsLiabilities}
        months={months}
        language={language}
        summary={`${describe(copy.charts.assets, (b) => b.total_assets)} ${describe(copy.charts.liabilities, (b) => b.total_liabilities)}`}
        lines={[
          { id: 'assets', label: copy.charts.assets, values: values((b) => b.total_assets), stroke: 'var(--color-ontime)' },
          { id: 'liabilities', label: copy.charts.liabilities, values: values((b) => b.total_liabilities), stroke: 'var(--color-late)', dashed: true },
        ]}
        legend={[copy.charts.assets, copy.charts.liabilities]}
      />
      <LineChart
        title={copy.charts.cash}
        months={months}
        language={language}
        summary={describe(copy.charts.cash, (b) => b.cash)}
        lines={[{ id: 'cash', label: copy.charts.cash, values: values((b) => b.cash), stroke: 'var(--color-ink)' }]}
      />
      <LineChart
        title={copy.charts.debt}
        months={months}
        language={language}
        summary={describe(copy.charts.debt, (b) => b.loans)}
        lines={[
          { id: 'loans', label: copy.charts.loans, values: values((b) => b.loans), stroke: 'var(--color-late)' },
          { id: 'short', label: copy.charts.shortfall, values: values((b) => b.unfunded_shortfall), stroke: 'var(--color-ink)', dashed: true },
        ]}
        legend={[copy.charts.loans, copy.charts.shortfall]}
      />
    </div>
  )
}

/** Where the assets are, now and at the end: amounts and shares written out, bars only to compare. */
export function AllocationBars({ now, end, copy }: { now: TrajectoryBalances; end: TrajectoryBalances; copy: TrajectoryCopy }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
      {[
        { title: copy.charts.now, balances: now },
        { title: copy.charts.end, balances: end },
      ].map(({ title, balances }) => {
        const rows = ALLOCATION_KEYS.filter((key) => toPaise(balances[key]) !== 0n)
        return (
          <section key={title} aria-label={`${copy.charts.allocation}: ${title}`} className="min-w-0">
            <h3 className="font-semibold">{title}</h3>
            {rows.length === 0 ? (
              <p className="text-muted">{copy.charts.none}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {rows.map((key) => {
                  const portion = share(balances[key], balances.total_assets)
                  return (
                    <li key={key} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                        <span>{copy.charts.keys[key]}</span>
                        <span className="font-figures">
                          {formatMoney(balances[key])} · {Math.round(portion * 100)}%
                        </span>
                      </div>
                      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-sand">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, portion * 100)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
