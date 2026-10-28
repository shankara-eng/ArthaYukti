import type { RecoveryPlanOption, RecoverySearchRequest, RecoverySearchResponse } from '../../api/types'
import { addMoney, formatMoney } from '../../lib/money'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { Notice, Panel, Stat, Table } from '../panel'
import { agreementDraft } from '../../lib/planb'
import { ExplainPlan } from './AIHelp'
import { CashChart } from './CashChart'

const money = (amount: string) => formatMoney(amount, { paise: true })

function Lines({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">{title}</p>
      <ul className="list-disc pl-5 text-[15px]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

interface OptionProps {
  option: RecoveryPlanOption
  request: RecoverySearchRequest
  chosen: boolean
  busy: boolean
  stale: boolean
  ai: boolean
  onChoose: () => void
  onReject: (itemId: string) => void
}

function OptionCard({ option, request, chosen, busy, stale, ai, onChoose, onReject }: OptionProps) {
  const t = usePlanBCopy().results
  const m = option.metrics
  const labels = new Map(request.input.items.map((i) => [i.id, i.label]))
  const changed = [...new Set(option.adjustments.map((a) => a.adjustment.item_id))]
  return (
    <article aria-labelledby={`${option.id}-title`} className={`flex flex-col gap-4 rounded-2xl border p-4 ${chosen ? 'border-brand bg-brand/10' : 'border-line'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${option.id}-title`} className="font-display text-[18px] font-bold">
          {option.rank}. {option.label}
        </h3>
        <button type="button" aria-pressed={chosen} disabled={stale} onClick={onChoose} className={`min-h-10 rounded-xl px-4 font-semibold disabled:opacity-60 ${chosen ? 'bg-brand text-white' : 'border border-line'}`}>
          {chosen ? t.chosen : t.choose}
        </button>
      </div>
      <ul className="flex flex-col gap-1 text-[15px] font-semibold">
        {option.adjustments.map((a) => (
          <li key={a.text}>{a.text}</li>
        ))}
        {option.adjustments.length === 0 ? <li>—</li> : null}
      </ul>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={t.metrics.lowest} value={money(m.minimum_liquid)} />
        <Stat label={t.metrics.headroom} value={money(m.floor_headroom)} />
        <Stat label={t.metrics.final} value={money(m.final_liquid)} />
        <Stat label={t.metrics.flex} value={money(m.flexible_reduction_total)} />
        <Stat label={t.metrics.deferred} value={money(m.goal_contributions_deferred)} />
        <Stat label={t.metrics.made} value={money(m.goal_contributions_made)} />
        <Stat label={t.metrics.paused} value={String(m.paused_months)} />
        <Stat label={t.metrics.reduced} value={String(m.reduced_months)} />
        <Stat label={t.metrics.back} value={m.restoration_complete_month ?? t.metrics.never} />
      </div>
      <CashChart months={option.evaluation.months} floor={request.input.reserve_floor} />
      <Lines title={t.why} lines={option.why_it_works} />
      <Lines title={t.gives} lines={option.what_you_give_up} />
      <Lines title={t.breaks} lines={option.what_would_break_it} />
      <Lines title={t.assumptions} lines={option.key_assumptions} />
      <p className="text-[13px] text-muted">
        <strong>{t.goalDelay}:</strong> {m.goal_delay}
      </p>
      <ExplainPlan
        enabled={ai && !stale}
        input={agreementDraft(request, option.adjustments.map((a) => a.adjustment), { selectedLabel: null, rationale: '', fallback: '' }).input}
      />
      {changed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">{t.rejectHint}</p>
          <div className="flex flex-wrap gap-2">
            {changed.map((id) => (
              <button key={id} type="button" disabled={busy || stale} onClick={() => onReject(id)} className="min-h-10 rounded-xl border border-line px-3 text-[14px] font-semibold disabled:opacity-60">
                {t.reject(labels.get(id) ?? id)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <details>
        <summary className="min-h-10 cursor-pointer py-2 font-semibold">{t.table}</summary>
        <Table
          caption={`${option.label}: ${t.table}`}
          head={[t.month, t.income, t.outflow, t.transfers, t.cash]}
          rows={option.evaluation.months.map((row) => [
            row.month,
            money(row.income),
            money(addMoney(row.mandatory_outflow, row.flexible_outflow)),
            money(row.goal_transfers),
            money(row.liquid_end),
          ])}
        />
      </details>
    </article>
  )
}

interface ResultsProps {
  response: RecoverySearchResponse
  request: RecoverySearchRequest
  chosenId: string | null
  busy: boolean
  stale: boolean
  ai: boolean
  onChoose: (option: RecoveryPlanOption) => void
  onReject: (itemId: string) => void
}

export function Results({ response, request, chosenId, busy, stale, ai, onChoose, onReject }: ResultsProps) {
  const t = usePlanBCopy().results
  const s = response.search
  const statusLine = s.status === 'found' ? t.found(response.options.length) : s.status === 'infeasible' ? t.infeasible : t.incomplete
  return (
    <Panel id="planb-results" title={t.title}>
      {stale ? (
        <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-[14px] font-semibold text-late">
          {t.stale}
        </p>
      ) : null}
      <Notice tone={s.status === 'found' ? undefined : 'warn'}>{statusLine}</Notice>
      <p className="text-[14px] text-muted">{t.space(s.evaluated + s.duplicates_skipped, s.space_size)}</p>
      {s.best_not_proven ? <Notice tone="warn">{t.notProven}</Notice> : null}
      {s.notes.map((note) => (
        <p key={note} className="text-[14px] text-muted">
          {note}
        </p>
      ))}
      <Lines title={t.ignored} lines={s.ignored_permissions} />
      {response.trade_off_note ? <Notice>{response.trade_off_note}</Notice> : null}

      <div className="flex flex-col gap-4">
        {response.options.map((option) => (
          <OptionCard key={option.id} option={option} request={request} chosen={chosenId === option.id} busy={busy} stale={stale} ai={ai} onChoose={() => onChoose(option)} onReject={onReject} />
        ))}
      </div>

      {response.infeasibility ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-late/60 p-4">
          <h3 className="font-display text-[18px] font-bold">{t.strongest}</h3>
          <ul className="list-disc pl-5 text-[15px]">
            {response.infeasibility.strongest_plan.map((a) => (
              <li key={a.text}>{a.text}</li>
            ))}
          </ul>
          <Stat label={t.shortfall} value={money(response.infeasibility.shortfall)} tone="late" />
          <Lines title="" lines={response.infeasibility.conflicts} />
          <Lines title={t.consider} lines={response.infeasibility.you_could_consider} />
        </div>
      ) : null}

      {response.rejected.length > 0 ? (
        <details>
          <summary className="min-h-10 cursor-pointer py-2 font-semibold">{t.rejectedTitle}</summary>
          <p className="text-[14px] text-muted">{t.rejectedBody}</p>
          <ul className="mt-2 flex flex-col gap-2 text-[14px]">
            {response.rejected.map((r, index) => (
              <li key={index} className="rounded-xl bg-sand px-3 py-2">
                <span className="font-semibold">{r.adjustments.map((a) => a.text).join('; ') || '—'}</span>
                <br />
                {r.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-[14px] text-muted">
        <strong>{t.policy}:</strong> {response.ranking_policy}
      </p>
    </Panel>
  )
}
