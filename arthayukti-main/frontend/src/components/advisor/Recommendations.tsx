import { useState } from 'react'
import { api } from '../../api/client'
import type { AdvisorAnalysis, AdvisorDecision, AdvisorRecommendation } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { useAction } from '../../state/useAction'
import { FormError } from '../forms'
import { Notice, Panel } from '../panel'

type Status = AdvisorRecommendation['status']

interface Props {
  analysis: AdvisorAnalysis
  t: AdvisorCopy
  /** Called when a decision was saved or a plan edit was applied, with the changed recommendation statuses. */
  onDecided: (id: string, status: Status, applied: boolean) => void
}

/** Recommendation cards. Accepting shows the exact edits; they are applied only on a second, explicit confirmation. */
export function Recommendations({ analysis, t, onDecided }: Props) {
  const { report } = analysis
  const [preview, setPreview] = useState<{ id: string; data: AdvisorDecision } | null>(null)
  const [applied, setApplied] = useState(false)
  const action = useAction()
  const locked = analysis.stale

  async function decide(id: string, status: Status) {
    setApplied(false)
    await action.run(async () => {
      const data = await api.advisorDecision(analysis.id, id, { status, apply_changes: false })
      onDecided(id, status, false)
      setPreview(status === 'accepted' && data.needs_confirmation ? { id, data } : null)
    })
  }

  async function confirm() {
    if (!preview) return
    const { id, data } = preview
    await action.run(async () => {
      await api.advisorDecision(analysis.id, id, { status: 'accepted', apply_changes: true, confirm_token: data.confirm_token })
      setPreview(null)
      setApplied(true)
      onDecided(id, 'accepted', true)
    })
  }

  return (
    <Panel id="advisor-recs" title={t.recs.title}>
      <p className="text-muted">{t.recs.lead}</p>
      {locked ? <Notice tone="warn">{t.recs.staleBlock}</Notice> : null}
      {applied ? <Notice>{t.recs.applied}</Notice> : null}
      {action.failure ? <FormError>{t.recs.failed}</FormError> : null}
      {report.recommendations.length === 0 ? <p className="text-muted">{t.recs.none}</p> : null}
      <ul className="flex flex-col gap-4">
        {report.recommendations.map((rec) => {
          const trade = report.tradeoffs.filter((x) => x.recommendation_id === rec.id)
          const scenario = analysis.scenarios.find((s) => s.id === rec.scenario_id)
          return (
            <li key={rec.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-[18px] font-bold">{rec.title}</h3>
                <span className="text-[13px] font-semibold">{t.recs.status[rec.status]}</span>
              </div>
              <p className="flex flex-wrap gap-x-3 text-[13px] text-muted">
                <span>{t.recs.priority[rec.priority]}</span>
                <span>{t.recs.confidence[rec.confidence]}</span>
                <span>{t.recs.source[rec.source]}</span>
              </p>
              {rec.calculated ? null : <p className="text-[13px] text-muted">{t.recs.uncalculated}</p>}
              <p>
                <strong>{t.recs.action}: </strong>
                {rec.action}
              </p>
              {rec.rationale ? (
                <p>
                  <strong>{t.recs.why}: </strong>
                  {rec.rationale}
                </p>
              ) : null}
              {rec.steps.length > 0 ? (
                <div>
                  <p className="font-semibold">{t.recs.steps}</p>
                  <ol className="list-decimal pl-5 text-[15px]">
                    {rec.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {rec.risks.length > 0 ? (
                <div>
                  <p className="font-semibold">{t.recs.risks}</p>
                  <ul className="list-disc pl-5 text-[15px]">
                    {rec.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {trade.map((x, index) => (
                <div key={index} className="grid gap-3 text-[15px] sm:grid-cols-2">
                  <div>
                    <p className="font-semibold">{t.recs.improves}</p>
                    <ul className="list-disc pl-5">
                      {x.improves.length === 0 ? <li>–</li> : x.improves.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold">{t.recs.worsens}</p>
                    <ul className="list-disc pl-5">
                      {x.worsens.length === 0 ? <li>{t.recs.nothingWorse}</li> : x.worsens.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
              {scenario ? (
                <details className="text-[14px]">
                  <summary className="cursor-pointer font-semibold">{t.recs.assumptions}</summary>
                  <ul className="list-disc pl-5 text-muted">
                    {scenario.assumptions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(['saved', 'accepted', 'dismissed', 'completed'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={locked || action.busy}
                    aria-pressed={rec.status === status}
                    onClick={() => void decide(rec.id, status)}
                    className={`min-h-11 rounded-xl border px-4 font-semibold disabled:opacity-50 ${rec.status === status ? 'border-brand bg-brand text-white' : 'border-line bg-paper hover:bg-sand'}`}
                  >
                    {status === 'saved' ? t.recs.save : status === 'accepted' ? t.recs.accept : status === 'dismissed' ? t.recs.dismiss : t.recs.complete}
                  </button>
                ))}
              </div>
              {preview && preview.id === rec.id ? (
                <div role="group" aria-label={t.recs.confirmTitle} className="flex flex-col gap-2 rounded-xl border border-ink bg-paper p-4">
                  <p className="font-semibold">{t.recs.confirmTitle}</p>
                  <p className="text-[14px] text-muted">{t.recs.confirmLead}</p>
                  <ul className="list-disc pl-5 text-[15px]">
                    {preview.data.proposed_changes.map((c) => (
                      <li key={`${c.id}-${c.field}`}>{t.recs.change(c.label, c.field.replace(/_/g, ' '), c.before, c.after)}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={action.busy} onClick={() => void confirm()} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-50">
                      {t.recs.confirm}
                    </button>
                    <button type="button" onClick={() => setPreview(null)} className="min-h-11 rounded-xl border border-line px-5 font-semibold">
                      {t.recs.cancel}
                    </button>
                  </div>
                </div>
              ) : rec.status === 'accepted' && !rec.has_source_changes ? (
                <p className="text-[14px] text-muted">{t.recs.onlyYou}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {report.action_plan.length > 0 ? (
        <div>
          <h3 className="font-semibold">
            {t.recs.actionPlan} <span className="text-[13px] font-normal text-muted">({t.recs.needsConfirmation})</span>
          </h3>
          <ol className="list-decimal pl-5 text-[15px]">
            {report.action_plan.map((step) => (
              <li key={step.step}>
                {step.step}
                {step.timing ? ` · ${step.timing}` : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  )
}
