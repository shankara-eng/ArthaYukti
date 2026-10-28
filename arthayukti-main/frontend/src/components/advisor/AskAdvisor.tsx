import { useState } from 'react'
import { api } from '../../api/client'
import type { AdvisorAnalysis, AdvisorChat } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { money, signedMoney } from '../../lib/advisor'
import type { Language } from '../../lib/months'
import { useAction } from '../../state/useAction'
import { FormError } from '../forms'
import { Notice, Panel } from '../panel'

interface Turn {
  question: string
  reply: AdvisorChat
}

/** Follow-up questions. The server runs approved scenarios and explains them; nothing here calculates. */
export function AskAdvisor({ analysis, t, language, onScenarios }: { analysis: AdvisorAnalysis; t: AdvisorCopy; language: Language; onScenarios: (scenarios: AdvisorChat['scenarios']) => void }) {
  const a = t.ask
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const action = useAction()

  async function ask(question: string) {
    const message = question.trim()
    if (message === '') return
    const ok = await action.run(async () => {
      const reply = await api.advisorChat(analysis.id, message, language)
      setTurns((current) => [...current, { question: message, reply }])
      onScenarios(reply.scenarios)
    })
    if (ok) setText('')
  }

  return (
    <Panel id="advisor-ask" title={a.title}>
      <p className="text-muted">{a.lead}</p>
      {analysis.stale ? <Notice tone="warn">{a.staleBlock}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        {a.examples.map((example) => (
          <button key={example} type="button" disabled={analysis.stale || action.busy} onClick={() => void ask(example)} className="min-h-11 rounded-xl border border-line bg-paper px-4 text-left hover:bg-sand disabled:opacity-50">
            {example}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-2 text-[15px] font-semibold">
        {a.label}
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={a.placeholder} maxLength={500} rows={3} className="rounded-xl border border-line bg-paper p-3 font-normal" />
      </label>
      <button type="button" disabled={text.trim() === '' || analysis.stale || action.busy} onClick={() => void ask(text)} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
        {action.busy ? a.sending : a.send}
      </button>
      {action.failure ? <FormError>{a.failed}</FormError> : null}
      <ol className="flex flex-col gap-4" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/60 p-4">
            <p className="text-[14px] text-muted">
              {a.you}: {turn.question}
            </p>
            <p>
              <strong>{a.answer}: </strong>
              {turn.reply.answer}
            </p>
            <p className="text-[13px] text-muted">{turn.reply.ai_used ? a.ai : a.plain}</p>
            {turn.reply.scenarios.map((s) => (
              <p key={s.id} className="font-figures text-[14px]">
                {s.title}: {t.compare.goals} {s.metrics.goals_achievable}/{s.metrics.goals_total} · {t.compare.minCash} {money(s.metrics.minimum_cash)} · {t.compare.netWorth} {signedMoney(s.deltas.horizon_net_worth)}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </Panel>
  )
}
