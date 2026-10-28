import { useState } from 'react'
import { ApiFailure, api } from '../../api/client'
import type { AgreementOut, RecoveryEvaluation, ReviewResult } from '../../api/types'
import { formatMoney } from '../../lib/money'
import { reviseInput, thresholdsOf, type Thresholds } from '../../lib/planb'
import { useAction } from '../../state/useAction'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { useRemote } from '../../state/useRemote'
import { CheckField, TextField } from '../forms'
import { Loaded, Notice, Panel, Stat } from '../panel'
import { CashChart } from './CashChart'

const money = (amount: string) => formatMoney(amount, { paise: true })

/** The saved agreements, newest first. Opening one shows it as it was saved, recomputed by the service. */
export function AgreementList({ onOpen, reloadKey }: { onOpen: (id: string) => void; reloadKey: number }) {
  const t = usePlanBCopy().agree
  const list = useRemote(`agreements-${reloadKey}`, (signal) => api.agreements(signal))
  return (
    <Panel id="planb-agreements" title={t.listTitle}>
      <Loaded remote={list}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-muted">{t.none}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                  <div>
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-[13px] text-muted">
                      {t.version(a.version)} · {a.feasible ? t.fits : t.breaks}
                      {a.review_month ? ` · ${t.reviewDue(a.review_month)}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => onOpen(a.id)} className="min-h-10 rounded-xl border border-line px-4 font-semibold">
                    {t.open}
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Panel>
  )
}

function Evaluation({ ev, floor }: { ev: RecoveryEvaluation; floor: string }) {
  const t = usePlanBCopy().results
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t.metrics.lowest} value={money(ev.minimum_liquid)} tone={ev.feasible ? undefined : 'late'} />
        <Stat label={t.metrics.final} value={money(ev.final_liquid)} />
      </div>
      <CashChart months={ev.months} floor={floor} />
      {ev.violations.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-[14px] font-semibold text-late">
          {ev.violations.slice(0, 4).map((v) => (
            <li key={`${v.kind}-${v.month}`}>{v.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function describeAdjustments(a: AgreementOut): string[] {
  const labels = new Map(a.draft.input.items.map((i) => [i.id, i.label]))
  return a.draft.input.adjustments?.map((adj) => {
    const span = adj.to_month ? `${adj.from_month} to ${adj.to_month}` : `${adj.from_month}, until restored`
    return adj.action === 'pause' ? `Pause ${labels.get(adj.item_id)} (${span})` : `Reduce ${labels.get(adj.item_id)} to ${money(adj.monthly ?? '0.00')} (${span})`
  }) ?? []
}

export function AgreementView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const t = usePlanBCopy().agree
  const [nonce, setNonce] = useState(0)
  const [versionShown, setVersionShown] = useState<number | null>(null)
  const current = useRemote(`agreement-${id}-${nonce}`, (signal) => api.agreement(id, signal))
  const shown = useRemote(versionShown === null ? null : `agreement-${id}-v${versionShown}`, (signal) => api.agreementVersion(id, versionShown as number, signal))
  const mine = current.data
  const view = versionShown !== null && shown.data ? shown.data : mine
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remover = useAction()

  if (!mine || !view) {
    return (
      <Panel title={t.title}>
        <Loaded remote={current}>{() => null}</Loaded>
        <button type="button" onClick={onBack} className="min-h-10 self-start rounded-xl border border-line px-4 font-semibold">
          {t.back}
        </button>
      </Panel>
    )
  }
  const readOnly = versionShown !== null && versionShown !== mine.version

  return (
    <div className="flex flex-col gap-5">
      <Panel
        id="planb-agreement"
        title={view.name}
        aside={
          <button type="button" onClick={onBack} className="min-h-10 rounded-xl border border-line px-4 text-[14px] font-semibold">
            {t.back}
          </button>
        }
      >
        <p className="text-[14px] text-muted">
          {t.version(view.version)} · {view.evaluation.feasible ? t.fits : t.breaks}
          {view.draft.input.review_month ? ` · ${t.reviewDue(view.draft.input.review_month)}` : ''}
        </p>
        {readOnly ? <Notice tone="warn">{t.version(view.version)}</Notice> : null}
        <ul className="list-disc pl-5 text-[15px] font-semibold">
          {describeAdjustments(view).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {view.draft.rationale ? <p>{view.draft.rationale}</p> : null}
        {view.draft.fallback_note ? <p className="text-muted">{view.draft.fallback_note}</p> : null}
        <Evaluation ev={view.evaluation} floor={view.draft.input.reserve_floor} />
        {(view.evaluation.restorations ?? []).length > 0 ? (
          <ul className="text-[14px]">
            {(view.evaluation.restorations ?? []).map((r) => (
              <li key={r.item_id}>
                {view.draft.input.items.find((i) => i.id === r.item_id)?.label}: {r.status.replace('_', ' ')}
                {r.triggered_month ? ` (${r.triggered_month})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {view.evaluation.review ? (
          <p className="text-[13px] text-muted">
            {view.evaluation.review.month}: {view.evaluation.review.items.map((i) => i.status.replace('_', ' ')).join(', ')}
          </p>
        ) : null}
        <div>
          <p className="text-[13px] font-semibold text-muted">{t.limitations}</p>
          <ul className="list-disc pl-5 text-[14px] text-muted">
            {view.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel id="planb-versions" title={t.versions}>
        <ul className="flex flex-col gap-2">
          {view.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
              <span>
                {t.version(v.version)} · {v.created_at.slice(0, 10)} {v.change_note ? `· ${v.change_note}` : ''}
              </span>
              <button type="button" onClick={() => setVersionShown(v.version === mine.version ? null : v.version)} className="min-h-9 rounded-lg border border-line px-3 text-[14px] font-semibold">
                {t.open}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[13px] font-semibold text-muted">{t.changes}</p>
        {view.changes_from_previous.length === 0 ? (
          <p className="text-[14px] text-muted">{t.nothingChanged}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[14px]">
            {view.changes_from_previous.map((c) => (
              <li key={c.field}>
                <strong>{c.field}:</strong> {t.before} “{c.before}” → {t.after} “{c.after}”
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {readOnly ? null : (
        <>
          <EditPanel agreement={mine} onSaved={() => { setVersionShown(null); setNonce((n) => n + 1); onChanged() }} />
          <ReviewPanel agreement={mine} />
          <Panel title={t.delete}>
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-3">
                <p>{t.confirmDelete}</p>
                <button type="button" disabled={remover.busy} onClick={() => void remover.run(async () => { await api.deleteAgreement(id); onChanged(); onBack() })} className="min-h-10 rounded-xl bg-late px-4 font-semibold text-white">
                  {t.delete}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-xl border border-line px-4 font-semibold">
                  ×
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-10 self-start rounded-xl border border-line px-4 font-semibold">
                {t.delete}
              </button>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

function EditPanel({ agreement, onSaved }: { agreement: AgreementOut; onSaved: () => void }) {
  const copy = usePlanBCopy()
  const t = copy.agree
  const words = copy.problems
  const input = agreement.draft.input
  const initial = thresholdsOf(input)
  const [floor, setFloor] = useState(input.reserve_floor.replace(/\.00$/, ''))
  const [review, setReview] = useState(input.review_month ?? '')
  const [th, setTh] = useState<Thresholds>(initial)
  const [rationale, setRationale] = useState(agreement.draft.rationale)
  const [fallback, setFallback] = useState(agreement.draft.fallback_note)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [calc, setCalc] = useState<RecoveryEvaluation | null>(null)
  const calcAction = useAction()
  const save = useAction()
  const [conflict, setConflict] = useState(false)

  const revised = () => {
    const r = reviseInput(input, { ...th, floor, reviewMonth: review })
    if (r.input === null) {
      setProblem(words[r.problem])
      return null
    }
    setProblem(null)
    return r.input
  }

  return (
    <Panel id="planb-edit" title={t.edit}>
      <p className="text-muted">{t.editBody}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={copy.s2.floor} value={floor} onChange={setFloor} inputMode="numeric" />
        <TextField label={copy.s4.review} type="month" value={review} onChange={setReview} />
        <TextField label={copy.s4.incomeAtLeast} value={th.incomeAtLeast} onChange={(v) => setTh({ ...th, incomeAtLeast: v })} inputMode="numeric" />
        <TextField label={copy.s4.cashAtLeast} value={th.cashAtLeast} onChange={(v) => setTh({ ...th, cashAtLeast: v })} inputMode="numeric" />
      </div>
      <CheckField label={copy.s4.confirm} checked={th.confirm} onChange={(v) => setTh({ ...th, confirm: v })} />
      <TextField label={t.rationale} value={rationale} onChange={setRationale} />
      <TextField label={t.fallback} value={fallback} onChange={setFallback} />
      <TextField label={t.changeNote} value={note} onChange={setNote} />
      {problem ? <p role="alert" className="text-[14px] font-semibold text-late">{problem}</p> : null}
      {calc ? <Evaluation ev={calc} floor={reviseInput(input, { ...th, floor, reviewMonth: review }).input?.reserve_floor ?? input.reserve_floor} /> : null}
      {save.failure ? (
        <p role="alert" className="text-[14px] font-semibold text-late">
          {conflict ? t.conflict : save.failure instanceof ApiFailure && save.failure.code === 'plan_not_feasible' ? t.notFeasible : save.failure instanceof ApiFailure ? save.failure.message : t.loadFailed}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={calcAction.busy}
          onClick={() => {
            const next = revised()
            if (next) void calcAction.run(async () => setCalc(await api.recoveryEvaluate(next)))
          }}
          className="min-h-11 rounded-xl border border-line px-4 font-semibold disabled:opacity-60"
        >
          {calcAction.busy ? t.recalculating : t.recalc}
        </button>
        <button
          type="button"
          disabled={save.busy}
          onClick={() => {
            const next = revised()
            if (!next) return
            setConflict(false)
            void save.run(async () => {
              try {
                await api.reviseAgreement(agreement.id, { ...agreement.draft, input: next, rationale, fallback_note: fallback }, agreement.version, note)
              } catch (error) {
                if (error instanceof ApiFailure && error.code === 'version_conflict') setConflict(true)
                throw error
              }
              onSaved()
            })
          }}
          className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60"
        >
          {save.busy ? t.saving : t.saveRevision}
        </button>
      </div>
    </Panel>
  )
}

function ReviewPanel({ agreement }: { agreement: AgreementOut }) {
  const t = usePlanBCopy().agree
  const [month, setMonth] = useState(agreement.draft.input.review_month ?? agreement.draft.input.start_month)
  const [cash, setCash] = useState('')
  const [income, setIncome] = useState('')
  const [recovered, setRecovered] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const run = useAction()
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && /^[\d,]+$/.test(cash.trim()) && /^[\d,]+$/.test(income.trim())
  const whole = (v: string) => `${v.replace(/,/g, '').replace(/^0+(?=\d)/, '')}.00`
  return (
    <Panel id="planb-review" title={t.reviewTitle}>
      <p className="text-muted">{t.reviewBody}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t.asOf} type="month" value={month} onChange={setMonth} />
        <TextField label={t.cashNow} value={cash} onChange={setCash} inputMode="numeric" />
        <TextField label={t.incomeNow} value={income} onChange={setIncome} inputMode="numeric" />
      </div>
      <CheckField label={t.recovered} checked={recovered} onChange={setRecovered} />
      {run.failure ? <p role="alert" className="text-[14px] font-semibold text-late">{run.failure instanceof ApiFailure ? run.failure.message : t.loadFailed}</p> : null}
      <button
        type="button"
        disabled={!ok || run.busy}
        onClick={() => void run.run(async () => setResult(await api.reviewAgreement(agreement.id, { as_of_month: month, liquid_cash: whole(cash.trim()), monthly_income: whole(income.trim()), recovery_confirmed: recovered })))}
        className="min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60"
      >
        {t.runReview}
      </button>
      {result ? (
        <div className="flex flex-col gap-2">
          <Notice tone={result.fits ? undefined : 'warn'}>{result.fits ? t.stillFits : t.needsRecalc}</Notice>
          <ul className="list-disc pl-5 text-[15px]">
            {result.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
