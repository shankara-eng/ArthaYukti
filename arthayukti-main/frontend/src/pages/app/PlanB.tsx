import { useMemo, useRef, useState } from 'react'
import { ApiFailure, api } from '../../api/client'
import type { RecoveryPlanOption, RecoverySearchRequest, RecoverySearchResponse } from '../../api/types'
import { AgreementList, AgreementView } from '../../components/planb/Agreements'
import { DescribeWithAI } from '../../components/planb/AIHelp'
import { useAIStatus } from '../../components/planb/useAIHelp'
import { Results } from '../../components/planb/Results'
import { StepAllow, StepChange, StepDescribe, StepProtect } from '../../components/planb/Steps'
import { TextField } from '../../components/forms'
import { Notice, Panel } from '../../components/panel'
import { agreementDraft, blankPlanB, buildSearch, newId, prefillFromPlan, type PlanBDraft } from '../../lib/planb'
import { useAction } from '../../state/useAction'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { useStore } from '../../state/useStore'

const STEP_FIELDS: string[][] = [
  [],
  ['startMonth', 'months', 'liquidCash', 'floor', 'incomeBefore', 'reducedIncome', 'newCost', 'disruptionStart', 'durationMonths', 'incomeAfter'],
  ['items'],
  ['restore.', 'reviewMonth', 'maxCandidates'],
]

export function PlanBPage() {
  const t = usePlanBCopy()
  const { plan, planId } = useStore()
  const [draft, setDraft] = useState<PlanBDraft>(() => (plan ? prefillFromPlan(plan) : blankPlanB()))
  const [step, setStep] = useState(0)
  const [tried, setTried] = useState(false)
  const [response, setResponse] = useState<RecoverySearchResponse | null>(null)
  const [request, setRequest] = useState<RecoverySearchRequest | null>(null)
  const [chosen, setChosen] = useState<RecoveryPlanOption | null>(null)
  // The inputs the shown results were computed from. If the form no longer matches, the results are stale.
  const [searchedKey, setSearchedKey] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [listKey, setListKey] = useState(0)
  const [name, setName] = useState('')
  const [rationale, setRationale] = useState('')
  const [fallback, setFallback] = useState('')
  const [savedNote, setSavedNote] = useState(false)
  const token = useRef(newId('tok'))
  const ai = useAIStatus()
  const search = useAction()
  const save = useAction()
  const built = useMemo(() => buildSearch(draft), [draft])
  const problems = built.problems ?? {}
  const stale = response !== null && searchedKey !== JSON.stringify(draft)

  const stepHasProblems = (n: number) => Object.keys(problems).some((k) => STEP_FIELDS[n].some((prefix) => k === prefix || k.startsWith(prefix.endsWith('.') ? prefix : `${prefix}.`)) || (n === 2 && /\.(label|monthly|balance)$/.test(k)) || (n === 3 && /\.(maxPause|minMonthly)$/.test(k)))

  const next = () => {
    setTried(true)
    if (step < 3 && stepHasProblems(step)) return
    setTried(false)
    setStep((s) => Math.min(3, s + 1))
  }

  async function find(source: PlanBDraft) {
    setTried(true)
    const b = buildSearch(source)
    if (b.request === null) return
    setChosen(null)
    setSavedNote(false)
    const ok = await search.run(async () => {
      const result = await api.recoverySearch(b.request)
      setRequest(b.request)
      setResponse(result)
      setSearchedKey(JSON.stringify(source))
    })
    if (ok) {
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      window.setTimeout(() => document.getElementById('planb-results')?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' }), 50)
    }
  }

  function reject(itemId: string) {
    const nextDraft = { ...draft, excluded: draft.excluded.includes(itemId) ? draft.excluded : [...draft.excluded, itemId] }
    setDraft(nextDraft)
    void find(nextDraft)
  }

  async function saveAgreement() {
    setSavedNote(false)
    if (!chosen || !request) return
    const ok = await save.run(async () => {
      const saved = await api.createAgreement(
        name.trim(),
        agreementDraft(request, chosen.adjustments.map((a) => a.adjustment), {
          selectedLabel: chosen.label,
          rationale,
          fallback,
          plan: plan && planId ? { id: planId, name: plan.name } : null,
        }),
        token.current,
      )
      token.current = newId('tok')
      setSavedNote(true)
      setListKey((k) => k + 1)
      setOpenId(saved.id)
    })
    return ok
  }

  const saveError =
    save.failure instanceof ApiFailure
      ? save.failure.code === 'name_taken'
        ? t.agree.taken
        : save.failure.code === 'limit_reached'
          ? t.agree.limit
          : save.failure.code === 'plan_not_feasible'
            ? t.agree.notFeasible
            : save.failure.message
      : save.failure
        ? t.results.failed
        : null

  if (openId) {
    return (
      <AgreementView
        id={openId}
        onBack={() => {
          setOpenId(null)
          setListKey((k) => k + 1)
        }}
        onChanged={() => setListKey((k) => k + 1)}
      />
    )
  }

  const stepProps = { draft, set: setDraft, problems, show: tried }
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 px-1">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-brand uppercase">{t.eyebrow}</p>
        <h2 className="font-display text-[26px] leading-tight font-bold tracking-tight">{t.title}</h2>
        <p className="max-w-3xl text-muted">{t.intro}</p>
      </section>

      <DescribeWithAI status={ai} draft={draft} onApply={(next) => { setDraft(next); setStep(0) }} />

      <Panel id="planb-form" title={t.steps[step]} aside={<span className="text-[13px] text-muted">{t.step(step + 1, 4)}</span>}>
        <ol className="flex flex-wrap gap-2 text-[13px]" aria-label={t.steps.join(', ')}>
          {t.steps.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
                className={`min-h-9 rounded-full px-3 font-semibold ${i === step ? 'bg-brand text-white' : 'border border-line text-muted'}`}
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>
        {step === 0 ? <StepChange {...stepProps} /> : null}
        {step === 1 ? <StepDescribe {...stepProps} /> : null}
        {step === 2 ? <StepProtect {...stepProps} /> : null}
        {step === 3 ? <StepAllow {...stepProps} /> : null}
        {tried && built.request === null && step === 3 ? <p role="alert" className="text-[14px] font-semibold text-late">{t.problems.fix}</p> : null}
        {search.failure ? (
          <p role="alert" className="text-[14px] font-semibold text-late">
            {search.failure instanceof ApiFailure && search.failure.code === 'validation_error' ? search.failure.message : t.results.failed}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className="min-h-11 rounded-xl border border-line px-5 font-semibold">
              {t.back}
            </button>
          ) : null}
          {step < 3 ? (
            <button type="button" onClick={next} className="min-h-11 rounded-xl bg-brand px-6 font-semibold text-white">
              {t.next}
            </button>
          ) : (
            <button type="button" disabled={search.busy} onClick={() => void find(draft)} className="min-h-11 rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
              {search.busy ? t.s4.finding : t.s4.find}
            </button>
          )}
        </div>
      </Panel>

      {search.busy && !response ? (
        <p role="status" className="text-muted">
          {t.results.searching}
        </p>
      ) : null}

      {response && request ? (
        <div aria-busy={search.busy} className={search.busy ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <Results response={response} request={request} chosenId={chosen?.id ?? null} busy={search.busy} stale={stale} ai={ai === 'on'} onChoose={setChosen} onReject={reject} />
        </div>
      ) : null}

      {response && response.options.length > 0 ? (
        <Panel id="planb-save" title={t.agree.title}>
          {stale ? (
            <p className="text-muted">{t.results.stale}</p>
          ) : chosen ? (
            <>
              <p className="font-semibold">{chosen.label}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t.agree.name} value={name} onChange={setName} maxLength={80} />
                <TextField label={t.agree.rationale} value={rationale} onChange={setRationale} />
                <TextField label={t.agree.fallback} value={fallback} onChange={setFallback} />
              </div>
              {saveError ? <p role="alert" className="text-[14px] font-semibold text-late">{saveError}</p> : null}
              {savedNote ? <Notice>{t.agree.saved}</Notice> : null}
              <button
                type="button"
                disabled={save.busy || name.trim() === ''}
                onClick={() => void saveAgreement()}
                className="min-h-11 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60"
              >
                {save.busy ? t.agree.saving : t.agree.save}
              </button>
              {name.trim() === '' ? <p className="text-[13px] text-muted">{t.agree.nameNeeded}</p> : null}
            </>
          ) : (
            <p className="text-muted">{t.agree.pickFirst}</p>
          )}
        </Panel>
      ) : null}

      <AgreementList onOpen={setOpenId} reloadKey={listKey} />
    </div>
  )
}
