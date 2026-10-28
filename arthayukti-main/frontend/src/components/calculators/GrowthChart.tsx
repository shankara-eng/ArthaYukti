import { useState } from 'react'
import { useCalculatorsCopy } from '../../state/useCalculatorsCopy'
import { formatMoney, toPaise } from '../../lib/money'

export interface GrowthPoint {
  label: string
  invested: string
  closing: string
}

// Heights are only for drawing. Every figure read out comes from the decimal strings the engine returned.
const px = (amount: string) => Math.max(0, Number(toPaise(amount)))

/**
 * One bar per year: the money put in, with the gain stacked above it. When the balance has fallen below what
 * was put in, the missing part is drawn as a dashed outline so a loss is never hidden.
 */
export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const t = useCalculatorsCopy().chart
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return null
  const tallest = Math.max(1, ...points.map((p) => Math.max(px(p.invested), px(p.closing))))
  const last = points[points.length - 1]
  const shown = active ?? points.length - 1
  const focus = points[shown]
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <figcaption className="font-display text-[16px] font-bold">{t.title}</figcaption>
        <p className="font-figures text-[14px]" aria-hidden="true">
          {focus.label}: {formatMoney(focus.closing, { paise: true })}
        </p>
      </div>
      <div role="img" aria-label={t.summary(`${last.label}: ${formatMoney(last.closing, { paise: true })}`)} className="flex h-44 items-end gap-1 sm:gap-1.5">
        {points.map((point, index) => {
          const invested = px(point.invested)
          const closing = px(point.closing)
          const base = Math.min(invested, closing)
          const gain = Math.max(0, closing - invested)
          const lost = Math.max(0, invested - closing)
          const pct = (value: number) => `${(value / tallest) * 100}%`
          return (
            <div
              key={point.label}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <div aria-hidden="true" style={{ height: pct(gain) }} className={`w-full rounded-t-md transition-[height] duration-300 motion-reduce:transition-none ${index === shown ? 'bg-ontime' : 'bg-ontime/55'}`} />
              <div aria-hidden="true" style={{ height: pct(lost) }} className="w-full rounded-t-md border border-dashed border-late/70" />
              <div aria-hidden="true" style={{ height: pct(base) }} className={`w-full transition-[height] duration-300 motion-reduce:transition-none ${gain === 0 && lost === 0 ? 'rounded-t-md' : ''} ${index === shown ? 'bg-brand' : 'bg-brand/45'}`} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[13px] text-muted" aria-hidden="true">
        <span>{points[0].label}</span>
        <span>{last.label}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-brand" /> {t.invested}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-ontime" /> {t.gain}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-dashed border-late" /> {t.loss}
        </span>
      </div>
      <div className="sr-only">
        <table>
          <caption>{t.title}</caption>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatMoney(point.invested, { paise: true })}</td>
                <td>{formatMoney(point.closing, { paise: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
