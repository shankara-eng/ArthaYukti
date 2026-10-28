import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { ApiFailure, api } from '../../api/client'
import type { CalculatorResult, MaturityDecisionNeeded } from '../../api/types'
import { ComparePanel } from '../../components/calculators/ComparePanel'
import { InvestmentCard } from '../../components/calculators/InvestmentCard'
import { ResultsView } from '../../components/calculators/ResultsView'
import { TextField } from '../../components/forms'
import { Panel } from '../../components/panel'
import { Select } from '../../components/Select'
import {
  MAX_INVESTMENTS,
  blankCalculator,
  blankInvestment,
  buildConfig,
  draftFromConfig,
  percentToFraction,
  type CalculatorDraft,
  type InvestmentDraft,
} from '../../lib/calculators'
import { useAction } from '../../state/useAction'
import { useCalculatorsCopy } from '../../state/useCalculatorsCopy'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import { rateToPercent } from '../../lib/inflation'

const LAST_KEY = 'arthayukti.calculator'

interface Answer {
  needed: MaturityDecisionNeeded[]
  result: CalculatorResult | null
}

function remember(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_KEY, id)
    else window.localStorage.removeItem(LAST_KEY)
  } catch {
    // a remembered choice is only a convenience
  }
}

function lastOpened(): string | null {
  try {
    return window.localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function CalculatorsPage() {
  const copy = useCalculatorsCopy()
  const t = copy.saved
  const { inflation } = useStore()
  // New investments start from the person's default inflation; each one can still be changed on its own.
  const inflationPercent = inflation ? rateToPercent(inflation.rate) : '0'
  const [draft, setDraft] = useState<CalculatorDraft>(() => blankCalculator(inflationPercent))
  const [touched, setTouched] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saver = useAction()
  const exporter = useAction()
  const scenarios = useRemote('calc-scenarios', (signal) => api.calcScenarios(signal))
  const [restored, setRestored] = useState(false)

  const built = useMemo(() => buildConfig(draft), [draft])
  const configKey = built.config ? JSON.stringify(built.config) : null

  // One call checks whether any investment needs an after-maturity decision and, if not, values everything.
  const calculation = useRemote<Answer>(
    configKey,
    async (signal) => {
      const config = built.config
      if (!config) return { needed: [], result: null }
      const needed = await api.calcMaturityCheck(config, signal)
      if (needed.length > 0) return { needed, result: null }
      return { needed: [], result: await api.calcRun(config, signal) }
    },
    400,
  )
  const answer = configKey ? calculation.data : null

  // Come back to the calculator that was open last time.
  useEffect(() => {
    if (restored || !scenarios.data) return
    setRestored(true)
    const id = lastOpened()
    if (id && scenarios.data.some((item) => item.id === id)) void open(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios.data, restored])

  const change = (next: CalculatorDraft) => {
    setTouched(true)
    setSaveNote(null)
    setDraft(next)
  }
  const updateInvestment = (id: string, next: InvestmentDraft) => change({ ...draft, investments: draft.investments.map((item) => (item.id === id ? next : item)) })
  const dirty = built.config ? snapshot !== configKey : true

  async function open(id: string) {
    const scenario = await api.calcScenario(id)
    setDraft(draftFromConfig(scenario.config))
    setActiveId(scenario.id)
    setName(scenario.name)
    setSnapshot(JSON.stringify(buildConfig(draftFromConfig(scenario.config)).config))
    setTouched(false)
    setSaveNote(null)
    setConfirmDelete(false)
    remember(scenario.id)
  }

  function startNew() {
    setDraft(blankCalculator(inflationPercent))
    setActiveId(null)
    setName('')
    setSnapshot(null)
    setTouched(false)
    setSaveNote(null)
    setConfirmDelete(false)
    remember(null)
  }

  async function save(asNew: boolean) {
    setTouched(true)
    setSaveNote(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setSaveNote(t.needName)
      return
    }
    if (!built.config) return
    const config = built.config
    const ok = await saver.run(async () => {
      const saved = activeId && !asNew ? await api.calcUpdateScenario(activeId, trimmed, config) : await api.calcCreateScenario(trimmed, config)
      setActiveId(saved.id)
      setSnapshot(JSON.stringify(config))
      remember(saved.id)
    })
    if (ok) {
      setSaveNote(t.savedOk)
      scenarios.reload()
    }
  }

  async function remove() {
    if (!activeId) return
    const id = activeId
    const ok = await saver.run(() => api.calcDeleteScenario(id))
    if (ok) {
      startNew()
      scenarios.reload()
    }
  }

  async function download() {
    if (!built.config) return
    const config = built.config
    await exporter.run(async () => {
      const blob = await api.calcExport(config)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'arthayukti_calculator.csv'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  const saveError =
    saver.failure instanceof ApiFailure
      ? saver.failure.code === 'name_taken'
        ? t.nameTaken
        : saver.failure.code === 'limit_reached'
          ? t.limit
          : saver.failure.message
      : saver.failure
        ? copy.results.failed
        : null

  const decisionFor = (id: string) => draft.investments.find((item) => item.id === id)
  const problems = built.problems ?? {}
  const savedOptions = scenarios.data ?? []

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 px-1">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-brand uppercase">{copy.eyebrow}</p>
        <h2 className="font-display text-[26px] leading-tight font-bold tracking-tight">{copy.title}</h2>
        <p className="max-w-3xl text-muted">{copy.intro}</p>
      </section>

      <Panel id="calc-saved" title={t.title}>
        <div className="grid items-end gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[15px] font-semibold" id="calc-open-label">
              {t.pick}
            </span>
            <Select
              aria-label={t.pick}
              value={activeId ?? ''}
              onChange={(id) => (id ? void open(id) : startNew())}
              options={[{ value: '', label: activeId ? t.newOne : savedOptions.length ? t.pick : t.none }, ...savedOptions.map((item) => ({ value: item.id, label: item.name }))]}
              className="min-h-12 w-full rounded-xl border border-line bg-paper px-3 text-[16px]"
            />
          </div>
          <TextField label={t.name} value={name} onChange={(value) => { setName(value); setSaveNote(null) }} placeholder={t.namePlaceholder} maxLength={80} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={saver.busy || !built.config} onClick={() => void save(false)} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">
            {saver.busy ? t.saving : t.save}
          </button>
          {activeId ? (
            <button type="button" disabled={saver.busy || !built.config} onClick={() => void save(true)} className="min-h-11 rounded-xl border border-line px-4 font-semibold disabled:opacity-60">
              {t.saveAsNew}
            </button>
          ) : null}
          {activeId ? (
            confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2 text-[14px]">
                {t.confirmDelete}
                <button type="button" onClick={() => void remove()} className="min-h-10 rounded-xl bg-late px-4 font-semibold text-white">
                  {t.delete}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-xl border border-line px-4 font-semibold">
                  ×
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-xl border border-line px-4 font-semibold">
                {t.delete}
              </button>
            )
          ) : null}
          <span role="status" className="text-[14px] text-muted">
            {saveNote ?? (activeId ? (dirty ? t.unsaved : t.savedOk) : t.unsaved)}
          </span>
        </div>
        {saveError ? (
          <p role="alert" className="text-[14px] font-semibold text-late">
            {saveError}
          </p>
        ) : null}
      </Panel>

      <Panel id="calc-valuation" title={copy.valuation.title}>
        <div role="radiogroup" aria-label={copy.valuation.title} className="grid gap-3 sm:grid-cols-2">
          {(['individual', 'common_date'] as const).map((mode) => (
            <label key={mode} className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 ${draft.mode === mode ? 'border-brand bg-brand/10' : 'border-line'}`}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="valuation-mode" checked={draft.mode === mode} onChange={() => change({ ...draft, mode })} className="size-4 accent-[var(--color-brand)]" />
                {mode === 'individual' ? copy.valuation.individual : copy.valuation.common}
              </span>
              <span className="text-[14px] text-muted">{mode === 'individual' ? copy.valuation.individualHint : copy.valuation.commonHint}</span>
            </label>
          ))}
        </div>
        {draft.mode === 'common_date' ? (
          <div className="max-w-xs">
            <TextField label={copy.valuation.date} type="month" value={draft.commonDate} onChange={(value) => change({ ...draft, commonDate: value })} error={touched && problems.commonDate ? copy.problems.commonDate : null} />
          </div>
        ) : null}
      </Panel>

      {answer && answer.needed.length > 0 ? (
        <Panel id="calc-decisions" title={copy.decision.title}>
          <p className="text-muted">{copy.decision.body}</p>
          {answer.needed.map((item) => {
            const row = decisionFor(item.investment_id)
            if (!row) return null
            return (
              <fieldset key={item.investment_id} className="flex flex-col gap-2 rounded-2xl border border-line p-4">
                <legend className="px-1 font-semibold">
                  {item.name} · <span className="font-normal text-muted">{copy.decision.matures(item.matures)}</span>
                </legend>
                {(['hold', 'continue', 'reinvest'] as const).map((action) => (
                  <label key={action} className="flex min-h-10 items-center gap-2 text-[15px]">
                    <input type="radio" name={`after-${item.investment_id}`} checked={row.afterAction === action} onChange={() => updateInvestment(row.id, { ...row, afterAction: action })} className="size-4 accent-[var(--color-brand)]" />
                    {copy.decision[action]}
                  </label>
                ))}
                {row.afterAction === 'reinvest' ? (
                  <div className="max-w-xs">
                    <TextField label={copy.decision.rate} value={row.reinvestPercent} onChange={(value) => updateInvestment(row.id, { ...row, reinvestPercent: value })} inputMode="decimal" error={touched && percentToFraction(row.reinvestPercent, -100, 100, 2) === null ? copy.problems.rate : null} />
                  </div>
                ) : null}
              </fieldset>
            )
          })}
          <p role="status" className="text-[14px] font-semibold">
            {copy.decision.needed}
          </p>
        </Panel>
      ) : null}

      <div className="flex flex-col gap-5">
        {draft.investments.map((item, index) => (
          <InvestmentCard
            key={item.id}
            index={index}
            draft={item}
            problems={problems}
            showProblems={touched}
            canRemove={draft.investments.length > 1}
            onChange={(next) => updateInvestment(item.id, next)}
            onRemove={() => change({ ...draft, investments: draft.investments.filter((other) => other.id !== item.id) })}
          />
        ))}
        {draft.investments.length < MAX_INVESTMENTS ? (
          <button
            type="button"
            onClick={() => change({ ...draft, investments: [...draft.investments, { ...blankInvestment(undefined, inflationPercent), name: copy.investment.heading(draft.investments.length + 1) }] })}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 font-semibold"
          >
            <Plus size={18} aria-hidden="true" />
            {copy.investment.add}
          </button>
        ) : (
          <p className="text-[14px] text-muted">{copy.investment.max}</p>
        )}
      </div>

      {built.config === null ? (
        <p role="status" className="rounded-xl bg-sand px-4 py-3 text-[15px]">
          {copy.problems.fix}
        </p>
      ) : calculation.error && !answer?.result ? (
        <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-[15px] font-semibold text-late">
          {copy.results.failed}{' '}
          <button type="button" onClick={calculation.reload} className="underline">
            {copy.results.retry}
          </button>
        </p>
      ) : answer?.result ? (
        <div className={calculation.loading ? 'opacity-70 transition-opacity' : 'transition-opacity'} aria-busy={calculation.loading}>
          <ResultsView result={answer.result} onExport={() => void download()} exporting={exporter.busy} exportFailed={exporter.failure !== null} />
        </div>
      ) : answer && answer.needed.length > 0 ? null : (
        <p role="status" className="text-muted">
          {copy.results.loading}
        </p>
      )}

      <ComparePanel scenarios={savedOptions} current={built.config} />
    </div>
  )
}
