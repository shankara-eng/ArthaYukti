import { useState } from 'react'
import { api } from '../../api/client'
import type { AIExplanation, RecoveryInput, SituationDraft } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { currentMonth, type PlanBDraft } from '../../lib/planb'
import { applyDraft, failureText } from './useAIHelp'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { useStore } from '../../state/useStore'
import { Notice, Panel } from '../panel'

const show = (value: string | null | undefined) => (value === null || value === undefined ? '' : formatMoney(Number(value).toFixed(2), { paise: false }))

export function DescribeWithAI({ status, draft, onApply }: { status: 'unknown' | 'on' | 'off'; draft: PlanBDraft; onApply: (next: PlanBDraft) => void }) {
  const t = usePlanBCopy()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<SituationDraft | null>(null)

  if (status === 'unknown') return null
  if (status === 'off') {
    return (
      <Panel id="planb-ai" title={t.ai.title}>
        <p className="text-muted">{t.ai.off}</p>
      </Panel>
    )
  }

  async function read() {
    setBusy(true)
    setError(null)
    setFound(null)
    try {
      const result = await api.aiSituationDraft(text.trim(), currentMonth())
      onApply(applyDraft(draft, result))
      setFound(result)
    } catch (e) {
      setError(failureText(e, t.ai.errors))
    } finally {
      setBusy(false)
    }
  }

  const filled: [string, string][] = found
    ? ([
        [t.ai.kind, found.disruption ? t.s1[found.disruption] : ''],
        [t.s2.begins, found.start_month ?? ''],
        [t.s2.duration, found.duration_months ? String(found.duration_months) : ''],
        [t.s2.before, show(found.income_before)],
        [t.s2.reduced, show(found.income_during)],
        [t.s2.newCost, show(found.new_monthly_cost)],
        [t.s2.cash, show(found.cash_available)],
      ] as [string, string][]).filter(([, v]) => v !== '')
    : []

  return (
    <Panel id="planb-ai" title={t.ai.title}>
      <p className="text-muted">{t.ai.hint}</p>
      <label htmlFor="planb-ai-text" className="text-[15px] font-semibold">
        {t.ai.label}
      </label>
      <textarea
        id="planb-ai-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1500}
        rows={3}
        placeholder={t.ai.placeholder}
        className="min-h-24 w-full rounded-xl border border-line bg-paper p-3 text-[16px] text-ink placeholder:text-muted/70 focus-visible:border-ink"
      />
      <button
        type="button"
        disabled={busy || text.trim() === ''}
        onClick={() => void read()}
        className="min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60"
      >
        {busy ? t.ai.reading : t.ai.read}
      </button>
      {error ? <p role="alert" className="text-[14px] font-semibold text-late">{error}</p> : null}
      {found ? (
        <div role="status" className="flex flex-col gap-2">
          <Notice>{found.notice}</Notice>
          {filled.length > 0 ? (
            <div>
              <p className="text-[13px] font-semibold text-muted">{t.ai.filled}</p>
              <ul className="list-disc pl-5 text-[15px]">
                {filled.map(([label, value]) => (
                  <li key={label}>
                    {label}: <strong>{value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted">{t.ai.nothing}</p>
          )}
          {found.clarifications.length > 0 ? (
            <div>
              <p className="text-[13px] font-semibold text-muted">{t.ai.questions}</p>
              <ul className="list-disc pl-5 text-[15px]">
                {found.clarifications.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {found.cannot_change.length > 0 ? (
            <div>
              <p className="text-[13px] font-semibold text-muted">{t.ai.protect}</p>
              <ul className="list-disc pl-5 text-[15px]">
                {found.cannot_change.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" onClick={() => setFound(null)} className="min-h-10 self-start rounded-xl border border-line px-4 font-semibold">
            {t.ai.dismiss}
          </button>
        </div>
      ) : null}
    </Panel>
  )
}

/** Words for one plan. The server evaluates the plan itself and refuses wording that uses an uncalculated figure. */
export function ExplainPlan({ input, enabled }: { input: RecoveryInput; enabled: boolean }) {
  const t = usePlanBCopy()
  const { language } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AIExplanation | null>(null)

  if (!enabled) return null

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.aiExplainRecovery(input, language))
    } catch (e) {
      setResult(null)
      setError(failureText(e, t.ai.errors))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" disabled={busy} onClick={() => void run()} className="min-h-10 self-start rounded-xl border border-line px-4 font-semibold disabled:opacity-60">
        {busy ? t.ai.explaining : t.ai.explain}
      </button>
      {error ? <p role="alert" className="text-[14px] font-semibold text-late">{error}</p> : null}
      {result ? (
        <div role="region" aria-label={t.ai.explainTitle} className="flex flex-col gap-2 rounded-xl bg-sand p-4 text-[15px]">
          <p>{result.summary}</p>
          {result.kept_as_is.length > 0 ? (
            <div>
              <p className="text-[13px] font-semibold text-muted">{t.ai.kept}</p>
              <ul className="list-disc pl-5">
                {result.kept_as_is.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.changed.length > 0 ? (
            <div>
              <p className="text-[13px] font-semibold text-muted">{t.ai.changes}</p>
              <ul className="list-disc pl-5">
                {result.changed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.returns_to_plan ? (
            <p>
              <strong>{t.ai.returns}:</strong> {result.returns_to_plan}
            </p>
          ) : null}
          {result.caution ? <p className="text-muted">{result.caution}</p> : null}
          <p className="text-[13px] text-muted">{result.notice}</p>
        </div>
      ) : null}
    </div>
  )
}
