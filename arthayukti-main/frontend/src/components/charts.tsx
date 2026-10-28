import { useId, useState } from 'react'
import { formatMoney, toPaise } from '../lib/money'

export interface Point {
  label: string
  value: string
}

// Heights and positions are only for drawing. Every figure that is read out comes from the
// decimal string the engine returned, never from these numbers.
const px = (amount: string) => Number(toPaise(amount))

/** Bars for each month. The tallest one is solid and carries its amount in a chip. */
export function HatchedBars({ points, summary }: { points: Point[]; summary: string }) {
  const [active, setActive] = useState<number | null>(null)
  const heights = points.map((point) => Math.abs(px(point.value)))
  const biggest = Math.max(1, ...heights)
  const top = heights.indexOf(Math.max(...heights, 0))
  const shown = active ?? top

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div role="img" aria-label={summary} className="flex h-44 items-end gap-1.5 pt-10">
        {points.map((point, index) => {
          const negative = point.value.startsWith('-')
          const height = Math.max(4, (heights[index] / biggest) * 100)
          const solid = index === shown
          return (
            <div key={point.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
              {solid ? (
                <span className="font-figures absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-ink px-3 py-1 text-[13px] whitespace-nowrap text-white shadow-lg" aria-hidden="true">
                  {formatMoney(point.value)}
                </span>
              ) : null}
              <div
                aria-hidden="true"
                style={{ height: `${height}%` }}
                className={`w-full rounded-lg ${negative ? 'bg-late/70' : solid ? 'bg-brand' : 'bg-brand/25'}`}
              />
            </div>
          )
        })}
      </div>
      <figcaption className="flex justify-between text-[13px] text-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>{summary}</caption>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatMoney(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

/** A filled line across the months, scaled to its own highest and lowest point. */
export function AreaLine({ points, summary }: { points: Point[]; summary: string }) {
  const gradient = useId()
  if (points.length < 2) return null
  const values = points.map((point) => px(point.value))
  const low = Math.min(...values, 0)
  const high = Math.max(...values, 1)
  const width = 420
  const height = 150
  const x = (index: number) => (index / (points.length - 1)) * width
  const y = (value: number) => height - 8 - ((value - low) / (high - low || 1)) * (height - 24)
  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="h-40 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between text-[13px] text-muted">
        <span>
          {points[0].label} · <span className="font-figures">{formatMoney(points[0].value)}</span>
        </span>
        <span>
          {points[points.length - 1].label} · <span className="font-figures">{formatMoney(points[points.length - 1].value)}</span>
        </span>
      </figcaption>
    </figure>
  )
}
