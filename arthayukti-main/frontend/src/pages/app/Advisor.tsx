import { useCallback, useState } from 'react'
import { api, ApiFailure } from '../../api/client'
import type { AdvisorAnalysis, AdvisorScenario } from '../../api/types'
import { AskAdvisor } from '../../components/advisor/AskAdvisor'
import { ComparePaths } from '../../components/advisor/ComparePaths'
import { Drilldown } from '../../components/advisor/Drilldown'
import { GoalReview } from '../../components/advisor/GoalReview'
import { Overview } from '../../components/advisor/Overview'
import { Recommendations } from '../../components/advisor/Recommendations'
import { CheckField, FormError } from '../../components/forms'
import { Notice, Panel } from '../../components/panel'
import { useAction } from '../../state/useAction'
import { useAdvisorCopy } from '../../state/useAdvisorCopy'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import { SituationReader } from './Tools'

type Tab = 'overview' | 'goals' | 'recs' | 'compare' | 'drill' | 'ask'
const TABS: Tab[] = ['overview', 'goals', 'recs', 'compare', 'drill', 'ask']

/**
 * The AI Financial Advisor. The server reads the person's records, calculates every goal at its saved date and three
 * years later, tries alternative paths and (optionally) has Gemini word them. This page only asks and shows; it
 * calculates nothing, and it changes no record unless the person confirms exact edits.
 */
export function AdvisorPage() {
  const t = useAdvisorCopy()
  const { language, plan, planId, reloadPlan } = useStore()
  // The newest saved analysis, if there is one; a run or an edit made on this page replaces it.
  const latest = useRemote<AdvisorAnalysis | null>('advisor-latest', async (signal) => {
    try {
      return await api.advisorLatest(signal)
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return null // none yet is normal
      throw error
    }
  })
  const [current, setAnalysis] = useState<AdvisorAnalysis | null>(null)
  const analysis = current ?? latest.data
  const loading = latest.loading
  const loadFailed = latest.error !== null
  const [tab, setTab] = useState<Tab>('overview')
  const [useAi, setUseAi] = useState(true)
  const run = useAction()
  const loadLatest = latest.reload

  const refresh = useCallback(async (id: string) => {
    try {
      setAnalysis(await api.advisorAnalysis(id))
    } catch {
      // The next visit reads it again; the cards already show the decision.
    }
  }, [])

  async function analyse() {
    await run.run(async () => {
      setAnalysis(await api.advisorAnalyze({ ...(planId ? { plan_id: planId } : {}), language, use_ai: useAi }))
      setTab('overview')
    })
  }

  const addScenarios = useCallback((scenarios: AdvisorScenario[]) => {
    setAnalysis((previous) => {
      const base = previous ?? latest.data
      if (!base) return base
      const known = new Set(base.scenarios.map((s) => s.id))
      const added = scenarios.filter((s) => !known.has(s.id))
      return added.length === 0 ? base : { ...base, scenarios: [...base.scenarios, ...added] }
    })
  }, [latest.data])

  const decided = useCallback(
    (id: string, status: AdvisorAnalysis['report']['recommendations'][number]['status'], applied: boolean) => {
      setAnalysis((previous) => {
        const base = previous ?? latest.data
        return base ? { ...base, report: { ...base.report, recommendations: base.report.recommendations.map((r) => (r.id === id ? { ...r, status } : r)) } } : base
      })
      // A plan edit makes the analysis out of date: ask the server, which compares the records again.
      if (applied && analysis) {
        void refresh(analysis.id)
        void reloadPlan()
      }
    },
    [analysis, latest.data, refresh, reloadPlan],
  )

  return (
    <>
      <Panel
        id="advisor-header"
        title={t.title}
        aside={
          <button type="button" onClick={() => void analyse()} disabled={run.busy || !plan} aria-busy={run.busy} className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
            {run.busy ? t.analysing : analysis ? t.rerun : t.analyse}
          </button>
        }
      >
        <p className="text-muted">{t.lead}</p>
        <Notice>{t.safety}</Notice>
        <CheckField label={t.useAi} checked={useAi} onChange={setUseAi} />
        {plan ? null : <Notice tone="warn">{t.needsPlan}</Notice>}
        {run.failure ? <FormError>{t.analyseFailed}</FormError> : null}
        {loadFailed && !analysis ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{t.loadFailed}</FormError>
            <button type="button" onClick={loadLatest} className="min-h-11 rounded-xl border border-ink px-4 font-semibold">
              {t.retry}
            </button>
          </div>
        ) : null}
        {analysis ? (
          <>
            <p className="text-[13px] text-muted">{t.asOf(analysis.as_of, analysis.snapshot_id)}</p>
            <p className="text-[14px]" role="status">
              {t.aiStatus[analysis.ai_status]}
              {analysis.ai_message ? ` ${analysis.ai_message}` : ''}
            </p>
            {analysis.stale ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-blush px-4 py-3">
                <p className="font-semibold text-late">
                  {t.staleTitle}
                  {analysis.stale_reason ? `. ${analysis.stale_reason}` : ''}
                </p>
                <button type="button" onClick={() => void analyse()} disabled={run.busy} className="min-h-11 rounded-xl border border-ink px-4 font-semibold">
                  {t.staleAction}
                </button>
              </div>
            ) : null}
            {analysis.validation_notes.length > 0 ? (
              <details className="text-[14px]">
                <summary className="cursor-pointer font-semibold">{t.validationTitle}</summary>
                <ul className="list-disc pl-5 text-muted">
                  {analysis.validation_notes.map((n) => (
                    <li key={n.message}>{n.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : loading ? (
          <p role="status" className="text-muted">
            {t.analysing}
          </p>
        ) : loadFailed ? null : (
          <p className="text-muted">{t.noAnalysis}</p>
        )}
      </Panel>

      {analysis ? (
        <>
          <div role="group" aria-label={t.tabsLabel} className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-10 rounded-xl px-4 ${tab === id ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'}`}
              >
                {t.tabs[id]}
              </button>
            ))}
          </div>
          {tab === 'overview' ? <Overview analysis={analysis} t={t} language={language} /> : null}
          {tab === 'goals' ? <GoalReview rows={analysis.goal_date_comparison} t={t} language={language} /> : null}
          {tab === 'recs' ? <Recommendations analysis={analysis} t={t} onDecided={decided} /> : null}
          {tab === 'compare' ? <ComparePaths analysis={analysis} t={t} language={language} onScenario={(s) => addScenarios([s])} /> : null}
          {tab === 'drill' ? <Drilldown analysis={analysis} t={t} /> : null}
          {tab === 'ask' ? (
            <>
              <AskAdvisor analysis={analysis} t={t} language={language} onScenarios={addScenarios} />
              <SituationReader />
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}
