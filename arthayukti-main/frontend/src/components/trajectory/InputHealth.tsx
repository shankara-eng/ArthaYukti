import { useState } from 'react'
import type { TrajectoryResult, TrajectoryWarning } from '../../api/types'
import type { TrajectoryCopy } from '../../i18n/trajectory'
import { editRoute } from '../../lib/trajectory'

const ORDER = { critical: 0, warning: 1, info: 2 } as const

interface Props {
  result: TrajectoryResult
  copy: TrajectoryCopy
  links: Record<string, string>
  onLink: (commitmentId: string, debtId: string) => void
}

function EditLink({ route, label }: { route: string | null; label: string }) {
  const target = editRoute(route)
  return target ? (
    <a href={`#/${target}`} className="font-semibold underline">
      {label}
    </a>
  ) : null
}

/**
 * What is missing, stale, assumed or unknown, with the short list first and the reasoning on request. Each item links
 * to the page where its record is edited: this tab never collects the data again.
 */
export function InputHealth({ result, copy, links, onLink }: Props) {
  const t = copy.health
  const [open, setOpen] = useState(false)
  const warnings = [...result.warnings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
  const needsReview = warnings.filter((w) => w.severity !== 'info')
  const status = result.completeness.status
  const count = result.completeness.missing.length + needsReview.length
  const tone = !result.summary.reconciles || status === 'insufficient' ? 'bg-blush' : 'bg-sand'

  const item = (w: TrajectoryWarning, index: number) => {
    const linkable = w.code === 'possible_duplicate_debt' && w.related_id && w.record_id
    const linked = linkable && links[w.related_id as string] === w.record_id
    return (
      <li key={`${w.code}-${w.record_id ?? index}-${index}`} className="flex flex-col gap-1 text-[14px]">
        <p>
          <strong>{t.severity[w.severity]}</strong>: {w.message}
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <EditLink route={w.edit_route} label={t.editAt} />
          {linkable ? (
            linked ? (
              <span className="font-semibold">{t.linked}</span>
            ) : (
              <button type="button" onClick={() => onLink(w.related_id as string, w.record_id as string)} className="min-h-9 rounded-lg border border-ink px-3 font-semibold">
                {t.link}
              </button>
            )
          ) : null}
        </p>
      </li>
    )
  }

  return (
    <section aria-labelledby="trajectory-health" className={`flex flex-col gap-3 rounded-2xl p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trajectory-health" className="font-display text-[18px] font-bold">
          {t.title}
        </h2>
        <span className="text-[14px] font-semibold">{status === 'complete' && count === 0 ? t.complete : t[status === 'insufficient' ? 'insufficient' : 'partial']}</span>
      </div>
      {!result.summary.reconciles ? <p role="alert" className="font-semibold text-late">{t.ledgerBad}</p> : null}
      {count > 0 || warnings.length > 0 ? (
        <>
          <p className="text-[14px]">
            {t.review(count)}
            {' · '}
            <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="min-h-9 font-semibold underline">
              {open ? t.hide : t.show}
            </button>
          </p>
          {!open && needsReview.length > 0 ? <ul className="flex flex-col gap-2">{needsReview.slice(0, 2).map(item)}</ul> : null}
          {open ? (
            <div className="flex flex-col gap-4">
              {result.completeness.missing.length > 0 ? (
                <div>
                  <h3 className="font-semibold">{t.missing}</h3>
                  <ul className="mt-1 flex flex-col gap-1 text-[14px]">
                    {result.completeness.missing.map((m, index) => (
                      <li key={`${m.record}-${m.record_id ?? ''}-${m.field}-${index}`}>
                        {m.reason} <EditLink route={m.edit_route} label={t.editAt} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ul className="flex flex-col gap-3">{warnings.map(item)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
