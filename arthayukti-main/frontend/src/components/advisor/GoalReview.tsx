import type { AdvisorGoalAssessment, AdvisorGoalRow } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { TONE_CLASS, money, statusTone } from '../../lib/advisor'
import { monthLabelLong, type Language } from '../../lib/months'
import { Notice, Panel } from '../panel'

function Column({ a, t, language }: { a: AdvisorGoalAssessment; t: AdvisorCopy; language: Language }) {
  const rows = t.goals.rows
  const tone = TONE_CLASS[statusTone(a.status)]
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
      <dt className="text-muted">{rows.date}</dt>
      <dd className="font-figures">{monthLabelLong(a.target_date, language)}</dd>
      <dt className="text-muted">{rows.target}</dt>
      <dd className="font-figures">{money(a.target_at_date)}</dd>
      <dt className="text-muted">{rows.funding}</dt>
      <dd className="font-figures">{money(a.available_funding)}</dd>
      <dt className="text-muted">{rows.gap}</dt>
      <dd className="font-figures">{money(a.funding_gap)}</dd>
      <dt className="text-muted">{rows.monthly}</dt>
      <dd className="font-figures">{money(a.required_monthly)}</dd>
      <dt className="text-muted">{rows.completion}</dt>
      <dd className="font-figures">{a.projected_completion ? monthLabelLong(a.projected_completion, language) : t.goals.never}</dd>
      <dt className="text-muted">{rows.status}</dt>
      <dd className={`font-semibold ${tone}`}>{t.goals.status[a.status]}</dd>
    </dl>
  )
}

/**
 * Every goal at the date the person saved and at exactly three years later, side by side. The saved date is
 * never changed here; the later date is only something to consider.
 */
export function GoalReview({ rows, t, language }: { rows: AdvisorGoalRow[]; t: AdvisorCopy; language: Language }) {
  return (
    <Panel id="advisor-goals" title={t.goals.title}>
      <p className="text-muted">{t.goals.lead}</p>
      <Notice>{t.goals.criteria}</Notice>
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.goal_id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-[18px] font-bold">{row.label}</h3>
              <span className="text-[13px] text-muted">{t.goals.saved(monthLabelLong(row.saved_target_date, language))}</span>
            </div>
            <p className="text-[13px] text-muted">{t.goals.definition[row.target_definition]}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-label={`${row.label}: ${t.goals.original}`} className="flex flex-col gap-2">
                <h4 className="text-[14px] font-semibold tracking-wide text-muted uppercase">{t.goals.original}</h4>
                <Column a={row.original} t={t} language={language} />
                {row.original.reasons.map((reason) => (
                  <p key={reason} className="text-[13px] text-muted">
                    {reason}
                  </p>
                ))}
              </section>
              <section aria-label={`${row.label}: ${t.goals.later}`} className="flex flex-col gap-2">
                <h4 className="text-[14px] font-semibold tracking-wide text-muted uppercase">{t.goals.later}</h4>
                <Column a={row.plus_3_years} t={t} language={language} />
                {row.plus_3_years.reasons.map((reason) => (
                  <p key={reason} className="text-[13px] text-muted">
                    {reason}
                  </p>
                ))}
                {row.plus_3_years.effects_on_others.length > 0 ? (
                  <div className="text-[13px]">
                    <p className="font-semibold">{t.goals.effects}</p>
                    <ul className="list-disc pl-5">
                      {row.plus_3_years.effects_on_others.map((e) => (
                        <li key={e.goal_id}>{t.goals.effect(e.label, t.goals.status[e.status_before], t.goals.status[e.status_after])}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            </div>
            {row.time_sensitive ? <p className="text-[14px] font-semibold text-late">{t.goals.timeSensitive}</p> : null}
            {row.caveats.map((caveat) => (
              <p key={caveat} className="text-[13px] text-muted">
                {caveat}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
