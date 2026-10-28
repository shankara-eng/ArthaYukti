import type { RecoveryMonth } from '../../api/types'
import { formatMoney, toPaise } from '../../lib/money'
import { usePlanBCopy } from '../../state/usePlanBCopy'

// Heights are only for drawing. Every figure read out comes from the decimal strings the service returned.
const px = (amount: string) => Math.max(0, Number(toPaise(amount)))

/** One bar per month for cash at the month's end, with the person's floor drawn across. A bar below the floor is flagged in text as well as colour. */
export function CashChart({ months, floor }: { months: RecoveryMonth[]; floor: string }) {
  const t = usePlanBCopy().results
  if (months.length === 0) return null
  const tallest = Math.max(1, px(floor), ...months.map((m) => px(m.liquid_end)))
  const floorPct = (px(floor) / tallest) * 100
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-[14px] font-semibold">{t.cashChart}</figcaption>
      <div className="relative">
        <div role="img" aria-label={`${t.cashChart}: ${months.map((m) => `${m.month} ${formatMoney(m.liquid_end)}`).join(', ')}`} className="flex h-40 items-end gap-1">
          {months.map((m) => (
            <div key={m.month} className="flex h-full min-w-0 flex-1 items-end" title={`${m.month}: ${formatMoney(m.liquid_end)}`}>
              <div
                aria-hidden="true"
                style={{ height: `${Math.max(2, (px(m.liquid_end) / tallest) * 100)}%` }}
                className={`w-full rounded-t-md ${m.floor_met ? 'bg-brand/70' : 'border border-dashed border-late bg-late/40'}`}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" style={{ bottom: `${floorPct}%` }} className="pointer-events-none absolute right-0 left-0 border-t-2 border-dashed border-ink/60">
          <span className="font-figures absolute -top-5 right-0 rounded bg-surface px-1 text-[12px]">
            {t.floorLine} {formatMoney(floor)}
          </span>
        </div>
      </div>
      <div className="flex justify-between text-[13px] text-muted" aria-hidden="true">
        <span>{months[0].month}</span>
        <span>{months[months.length - 1].month}</span>
      </div>
      {months.some((m) => !m.floor_met) ? (
        <p className="text-[13px] font-semibold text-late">
          {t.belowFloor}: {months.filter((m) => !m.floor_met).map((m) => m.month).join(', ')}
        </p>
      ) : null}
    </figure>
  )
}
