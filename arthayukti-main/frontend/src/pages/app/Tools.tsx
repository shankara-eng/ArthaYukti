import { useRef, useState } from 'react'
import { ExpenditureSection } from './Expenditure'
import { IncomeSection } from './Income'
import { IncomeTrajectorySection } from './IncomeTrajectory'
import { api } from '../../api/client'
import type { AIConsultResponse, CSVImportResponse, IntentSuggestions } from '../../api/types'
import { AmountField, CheckField, DateField, FormError, SelectField, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import type { Route } from '../../lib/route'
import { monthLabelLong } from '../../lib/months'
import { goalNameById, statusText, toneOf } from '../../lib/outcome'
import { useAction } from '../../state/useAction'
import { useAuth } from '../../state/useAuth'
import { useExtrasCopy } from '../../state/useExtrasCopy'
import { usePlanBCopy } from '../../state/usePlanBCopy'
import { useModulesCopy } from '../../state/useModulesCopy'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { rateToPercent } from '../../lib/inflation'
import { percentToRate } from '../../lib/onboarding'
import { useShellCopy } from '../../state/useShellCopy'
import { useStore } from '../../state/useStore'
import type { PageProps } from '../types'

const MAX_BYTES = 1_000_000

function TransactionForm({ onSaved }: { onSaved: () => void }) {
  const t = useExtrasCopy().ledger
  const accounts = useRemote('ledger-accounts', (signal) => api.accounts(signal))
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState<'credit' | 'debit'>('debit')
  const [account, setAccount] = useState('')
  const [note, setNote] = useState('')
  const [essential, setEssential] = useState(false)
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(false)
  const save = useAction()
  const zero = amount === '' || /^0+(\.0+)?$/.test(amount)

  async function add() {
    setTried(true)
    setDone(false)
    if (date === '' || zero || category.trim() === '') return
    const ok = await save.run(() =>
      api.createTransaction({
        transaction_date: date,
        amount,
        transaction_type: kind,
        category: category.trim(),
        account_id: account || null,
        description: note.trim() || null,
        is_essential: kind === 'debit' && essential,
      }),
    )
    if (ok) {
      setDate('')
      setAmount('')
      setCategory('')
      setNote('')
      setEssential(false)
      setTried(false)
      setDone(true)
      onSaved()
    }
  }

  return (
    <Panel title={t.addTitle}>
      <p className="text-muted">{t.addBody}</p>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <DateField label={t.date} value={date} onChange={setDate} error={tried && date === '' ? t.needDate : null} />
        <AmountField label={t.amount} value={amount} onChange={setAmount} error={tried && zero ? t.needAmount : null} />
        <TextField label={t.category} value={category} onChange={setCategory} maxLength={60} error={tried && category.trim() === '' ? t.needCategory : null} />
        <SelectField
          label={t.kind}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'debit', label: t.debit },
            { value: 'credit', label: t.credit },
          ]}
        />
        <SelectField
          label={t.account}
          value={account}
          onChange={setAccount}
          options={[{ value: '', label: t.noAccount }, ...(accounts.data ?? []).map((item) => ({ value: item.id, label: item.account_name }))]}
        />
        <TextField label={t.note} value={note} onChange={setNote} maxLength={200} />
        {kind === 'debit' ? <CheckField label={t.essential} checked={essential} onChange={setEssential} /> : null}
        {save.failure ? (
          <div className="sm:col-span-2">
            <FormError>{t.failed}</FormError>
          </div>
        ) : null}
        {done ? (
          <p role="status" className="font-semibold text-ontime sm:col-span-2">
            {t.saved}
          </p>
        ) : null}
        <button type="submit" disabled={save.busy} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
          {save.busy ? t.saving : t.save}
        </button>
      </form>
    </Panel>
  )
}

function LedgerSection() {
  const m = useModulesCopy()
  const extras = useExtrasCopy()
  const t = m.importPage
  const recent = useRemote('transactions', (signal) => api.transactions(signal))
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [result, setResult] = useState<CSVImportResponse | null>(null)
  const upload = useAction()

  function choose(next: File | null) {
    setResult(null)
    setProblem(null)
    if (next && !next.name.toLowerCase().endsWith('.csv')) {
      setProblem(t.notCsv)
      setFile(null)
      return
    }
    if (next && next.size > MAX_BYTES) {
      setProblem(t.tooBig)
      setFile(null)
      return
    }
    setFile(next)
  }

  async function send() {
    if (!file) return
    const ok = await upload.run(async () => setResult(await api.importTransactions(file)))
    if (ok) {
      setFile(null)
      if (input.current) input.current.value = ''
      recent.reload()
    }
  }

  return (
    <>
      <Panel title={t.title}>
        <p className="text-muted">{t.body}</p>
        <label className="flex flex-col gap-2 text-[15px] font-semibold">
          {t.choose}
          <input ref={input} type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0] ?? null)} className="rounded-xl border border-line bg-paper p-3 font-normal" />
        </label>
        {problem ? <FormError>{problem}</FormError> : null}
        {upload.failure ? <FormError>{m.common.saveFailed}</FormError> : null}
        <button type="button" disabled={!file || upload.busy} onClick={() => void send()} className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
          {upload.busy ? t.uploading : t.upload}
        </button>
        {result ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl bg-sand p-4 text-[15px]">
            <p className="font-semibold">
              {t.imported(result.imported_count)} · {t.failed(result.failed_count)} · {t.duplicates(result.duplicate_count ?? 0)}
            </p>
            {result.errors.length > 0 ? (
              <ul className="list-disc pl-5 text-[14px]">
                {result.errors.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <Panel title={extras.ledger.committedTitle}>
        <p>{extras.ledger.committed}</p>
        <p className="text-muted">
          <strong>{extras.ledger.wishTitle}.</strong> {extras.ledger.wish}
        </p>
      </Panel>
      <TransactionForm onSaved={recent.reload} />
      <Panel title={t.recent}>
        <Loaded remote={recent}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-muted">{m.common.none}</p>
            ) : (
              <Table
                caption={t.recent}
                head={[m.outlook.month, m.common.name, m.common.value, m.common.kind]}
                rows={list.slice(0, 25).map((tx) => [tx.transaction_date, tx.category, formatMoney(tx.amount), tx.transaction_type === 'credit' ? t.credit : t.debit])}
              />
            )
          }
        </Loaded>
      </Panel>
    </>
  )
}

export function AlertsPage() {
  const m = useModulesCopy()
  const t = m.alerts
  const reminders = useRemote('all-reminders', (signal) => api.reminders(signal))
  const ack = useAction()
  return (
    <Panel title={t.reminders}>
      <Loaded remote={reminders}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-muted">{t.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                  <span>
                    <span className="font-figures font-semibold">{item.due_date}</span> · {item.message}
                  </span>
                  {item.is_acknowledged ? (
                    <span className="text-[14px] text-muted">{t.acked}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={ack.busy}
                      onClick={() => void ack.run(() => api.acknowledgeReminder(item.id)).then((ok) => ok && reminders.reload())}
                      className="min-h-10 rounded-lg border border-line px-3 text-[14px] font-semibold disabled:opacity-60"
                    >
                      {t.ack}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <Notice>{t.note}</Notice>
    </Panel>
  )
}

/** The person's default annual inflation. It starts new plans and new investments; saved work keeps its own rate. */
function InflationSettings() {
  const t = useRestructureCopy().inflation
  const { inflation, setInflation, applyInflationToPlan, plan } = useStore()
  const [text, setText] = useState('')
  const [edited, setEdited] = useState(false)
  const [tried, setTried] = useState(false)
  const [saved, setSaved] = useState(false)
  const [applied, setApplied] = useState(false)
  const save = useAction()

  // The saved rate is shown once it arrives; after the person types, their text is theirs.
  const shown = edited ? text : inflation ? rateToPercent(inflation.rate) : ''
  const rate = percentToRate(shown)

  async function submit() {
    setTried(true)
    setSaved(false)
    setApplied(false)
    if (rate === null) return
    const ok = await save.run(async () => {
      if (!(await setInflation(rate))) throw new Error('not saved')
    })
    if (ok) setSaved(true)
  }

  return (
    <Panel id="settings-inflation" title={t.title}>
      <p className="text-muted">{t.help}</p>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField
          label={t.label}
          hint={inflation ? (inflation.isDefault ? `${t.hint} ${t.startValue}` : `${t.hint} ${t.own}`) : t.hint}
          value={shown}
          onChange={(value) => {
            setEdited(true)
            setSaved(false)
            setText(value)
          }}
          inputMode="decimal"
          error={tried && rate === null ? t.bad : null}
        />
        <div className="flex items-end">
          <button type="submit" disabled={save.busy} className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60">
            {save.busy ? t.saving : t.save}
          </button>
        </div>
        {save.failure ? (
          <div className="sm:col-span-2">
            <FormError>{t.failed}</FormError>
          </div>
        ) : null}
        {saved ? (
          <p role="status" className="rounded-xl bg-sage px-4 py-3 font-semibold sm:col-span-2">
            {t.saved}
          </p>
        ) : null}
      </form>
      {plan ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
          <h3 className="font-semibold">{t.applyTitle}</h3>
          <p className="text-[14px] text-muted">{t.applyBody}</p>
          <p className="text-[14px]">
            {t.planNow}: <strong>{rateToPercent(plan.assumptions.general_inflation_annual)}% {t.perYear}</strong>
          </p>
          <button
            type="button"
            disabled={!inflation}
            onClick={() => {
              applyInflationToPlan()
              setApplied(true)
            }}
            className="min-h-11 self-start rounded-xl border border-line px-4 font-semibold disabled:opacity-60"
          >
            {t.apply}
          </button>
          {applied ? <p role="status" className="rounded-xl bg-sage px-4 py-3 font-semibold">{t.applied}</p> : null}
        </div>
      ) : null}
    </Panel>
  )
}

export function SettingsPage() {
  const m = useModulesCopy()
  const t = m.settings
  const auth = useAuth()
  const { language, setLanguage } = useStore()
  const exporting = useAction()
  const deleting = useAction()
  const [word, setWord] = useState('')

  async function download() {
    await exporting.run(async () => {
      const data = await api.exportData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'arthayukti-data.json'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  async function remove() {
    const ok = await deleting.run(() => api.deleteAccount())
    if (ok) await auth.logout()
  }

  return (
    <>
      <Panel title={t.language}>
        <div className="flex gap-2" role="group" aria-label={t.language}>
          {(['en', 'hi'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)} className={`min-h-11 rounded-xl border px-4 font-semibold ${language === value ? 'border-ink bg-brand text-white' : 'border-line bg-paper'}`}>
              {value === 'en' ? 'English' : 'हिन्दी'}
            </button>
          ))}
        </div>
      </Panel>
      <InflationSettings />
      <Panel title={t.account}>
        <p className="text-muted">{auth.user?.email}</p>
        <h3 className="font-semibold">{t.privacy}</h3>
        <p className="text-muted">{t.privacyBody}</p>
        <button type="button" disabled={exporting.busy} onClick={() => void download()} className="min-h-12 self-start rounded-xl border border-line bg-paper px-5 font-semibold disabled:opacity-60">
          {exporting.busy ? t.exporting : t.export}
        </button>
        {exporting.failure ? <FormError>{t.exportFailed}</FormError> : null}
        <button type="button" onClick={() => void auth.logout()} className="min-h-12 self-start rounded-xl bg-brand px-5 font-semibold text-white">
          {t.signOut}
        </button>
      </Panel>
      <Panel title={t.deleteTitle}>
        <p className="text-muted">{t.deleteBody}</p>
        <label className="flex max-w-xs flex-col gap-1 text-[15px] font-semibold">
          {t.deleteConfirm}
          <input value={word} onChange={(event) => setWord(event.target.value)} className="min-h-12 rounded-xl border border-line bg-paper px-3 font-normal" autoComplete="off" />
        </label>
        {deleting.failure ? <FormError>{t.deleteFailed}</FormError> : null}
        <button type="button" disabled={word !== t.deleteWord || deleting.busy} onClick={() => void remove()} className="min-h-12 self-start rounded-xl bg-late px-5 font-semibold text-paper disabled:opacity-50">
          {deleting.busy ? t.deleting : t.deleteButton}
        </button>
      </Panel>
    </>
  )
}

export { ProfilePage } from './Profile'

/** The older "describe a situation" reader, kept under the advisor's Ask tab. */
export function SituationReader() {
  const m = useModulesCopy()
  const t = m.advisor
  const [question, setQuestion] = useState('')
  const x = useExtrasCopy()
  const [answer, setAnswer] = useState<IntentSuggestions | null>(null)
  const [analysis, setAnalysis] = useState<AIConsultResponse | null>(null)
  const read = useAction()
  const analyse = useAction()
  const { language, plan, scenario } = useStore()
  return (
    <>
    <Panel title={t.title}>
      <p className="text-muted">{t.body}</p>
      <label className="flex flex-col gap-2 text-[15px] font-semibold">
        {t.ask}
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t.placeholder} maxLength={1000} rows={3} className="rounded-xl border border-line bg-paper p-3 font-normal" />
      </label>
      <button
        type="button"
        disabled={question.trim() === '' || read.busy}
        onClick={() => void read.run(async () => setAnswer(await api.parseIntent(question.trim())))}
        className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white disabled:opacity-60"
      >
        {read.busy ? t.reading : t.read}
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={question.trim() === '' || !plan || analyse.busy}
          onClick={() => plan && void analyse.run(async () => setAnalysis(await api.consult(plan, scenario, question.trim())))}
          className="min-h-12 rounded-xl border border-brand px-6 font-semibold text-brand disabled:opacity-60"
        >
          {analyse.busy ? x.advisor.analysing : x.advisor.analyse}
        </button>
        {plan ? null : <span className="text-[14px] text-muted">{x.advisor.needsPlan}</span>}
      </div>
      {analyse.failure ? <FormError>{x.rescue.failed}</FormError> : null}
      {read.failure ? <FormError>{m.common.failed}</FormError> : null}
      {answer ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">{t.method}</p>
          <h3 className="font-semibold">{t.found}</h3>
          {answer.identified_goals.length === 0 ? (
            <p className="text-muted">{t.nothing}</p>
          ) : (
            <ul className="list-disc pl-5">
              {answer.identified_goals.map((goal) => (
                <li key={goal.label}>
                  {goal.label}: <span className="font-figures">{formatMoney(goal.target_amount_today)}</span>
                </li>
              ))}
            </ul>
          )}
          {answer.detected_constraints.length > 0 ? (
            <>
              <h3 className="font-semibold">{t.constraints}</h3>
              <ul className="list-disc pl-5">
                {answer.detected_constraints.map((line) => (
                  <li key={line}>{line.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </>
          ) : null}
          <h3 className="font-semibold">{t.missing}</h3>
          <ul className="list-disc pl-5">
            {answer.missing_critical_info.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Notice>{language === 'hi' ? answer.plain_hindi_summary : answer.plain_english_summary}</Notice>
        </div>
      ) : null}
    </Panel>
    {analysis ? (
      <Panel title={x.advisor.analysisTitle} aside={<span className="text-[13px] text-muted">{m.common.fromEngine}</span>}>
        <Notice>{x.advisor.analysisNote}</Notice>
        <Notice tone={analysis.is_baseline_feasible ? undefined : 'warn'}>{analysis.is_baseline_feasible ? x.rescue.baselineOk : x.rescue.baselineNot}</Notice>
        {analysis.unresolved_gap ? <p>{x.rescue.gap}: <strong className="font-figures">{formatMoney(analysis.unresolved_gap)}</strong></p> : null}
        {analysis.binding_constraint ? <p>{x.rescue.binding}: <strong>{analysis.binding_constraint.replace(/_/g, ' ')}</strong></p> : null}
        <ul className="flex flex-col gap-3">
          {analysis.alternatives.map((item) => (
            <li key={item.alternative_id} className={`flex flex-col gap-2 rounded-2xl border p-4 ${item.alternative_id === analysis.recommended_alternative_id ? 'border-brand bg-sage/60' : 'border-line bg-surface/60'}`}>
              <p className="font-semibold">
                {item.title}
                {item.alternative_id === analysis.recommended_alternative_id ? <span className="ml-2 rounded-xl bg-brand px-3 py-1 text-[13px] text-white">{x.rescue.recommended}</span> : null}
              </p>
              <p>{item.description}</p>
              <p className="font-figures text-[15px]">
                {x.rescue.monthly}: {formatMoney(item.monthly_savings_change)} · {x.rescue.shortfall}: {formatMoney(item.total_shortfall_today)}
              </p>
              {item.tradeoffs.length > 0 ? (
                <ul className="list-disc pl-5 text-[15px]">
                  {item.tradeoffs.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {analysis.missing_information.length > 0 ? (
          <ul className="list-disc pl-5 text-[15px]">
            {analysis.missing_information.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-[14px] text-muted">{analysis.ranking_criteria}</p>
      </Panel>
    ) : null}
    </>
  )
}

export function GoalsPage({ navigate }: PageProps) {
  const m = useModulesCopy()
  const t = m.goals
  const shell = useShellCopy()
  const extras = useExtrasCopy()
  const planB = usePlanBCopy().entry
  const { text, language, plan, projection } = useStore()
  if (!plan) return <Notice>{m.common.needsPlan}</Notice>
  const ordered = [...plan.goals].sort((a, b) => a.priority - b.priority)
  const link = (route: Route, label: string) => (
    <button key={label} type="button" onClick={() => navigate(route)} className="min-h-11 rounded-xl border border-line bg-paper px-4 font-semibold hover:bg-sand">
      {label}
    </button>
  )
  return (
    <>
      <Panel title={t.list}>
        {ordered.length === 0 ? <p className="text-muted">{text.needGoals.body}</p> : null}
        <Loaded remote={projection}>
          {(result) => (
            <Table
              caption={t.list}
              head={['#', m.outlook.feasibility.goal, t.needed, t.status]}
              rows={ordered.map((goal, index) => {
                const outcome = result.goals.find((item) => item.goal_id === goal.id)
                return [
                  String(index + 1),
                  goalNameById(text, plan, goal.id),
                  monthLabelLong(goal.target_date, language),
                  outcome ? <span key={goal.id} className={`font-semibold ${toneOf(outcome) === 'late' ? 'text-late' : 'text-ontime'}`}>{statusText(text, outcome)}</span> : '–',
                ]
              })}
            />
          )}
        </Loaded>
        <div className="flex flex-wrap gap-2">{link('dreams', t.manage)}</div>
      </Panel>
      <section aria-labelledby="plan-b-feature" className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-brand to-sky-500 p-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-1">
          <span className="w-fit rounded-full bg-white/20 px-3 py-0.5 text-[12px] font-bold uppercase tracking-wider">{planB.badge}</span>
          <h2 id="plan-b-feature" className="text-2xl font-bold">{planB.title}</h2>
          <p className="text-[15px] text-white/90">{planB.body}</p>
        </div>
        <button type="button" onClick={() => navigate('plan-b')} className="min-h-12 shrink-0 rounded-xl bg-white px-6 font-bold text-brand-ink shadow-md hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {planB.open}
        </button>
      </section>
      <Panel title={t.explore}>
        <div className="flex flex-wrap gap-2">
          {link('tradeoffs', t.tradeoffs)}
          {link('what-if', t.whatIf)}
          {link('fixes', t.fixes)}
          {link('compare', t.compare)}
          {link('rescue', extras.rescue.title)}
          {link('outlook-feasibility', shell.nav.outlookItems.feasibility)}
        </div>
      </Panel>
    </>
  )
}

export function FinancesPage() {
  const m = useModulesCopy()
  const t = m.finances
  const { plan } = useStore()
  if (!plan) return <Notice>{m.common.needsPlan}</Notice>
  return (
    <>
      <IncomeSection />
      <IncomeTrajectorySection />
      <ExpenditureSection />
      <Panel title={t.commitments}>
        {(plan.commitments ?? []).length === 0 ? (
          <p className="text-muted">{t.empty}</p>
        ) : (
          <Table caption={t.commitments} head={[m.common.name, m.common.value, m.debts.months]} rows={(plan.commitments ?? []).map((c) => [c.label, `${formatMoney(c.monthly_payment)} ${m.common.perMonth}`, String(c.remaining_months)])} />
        )}
      </Panel>
      <Notice>{t.note}</Notice>
      <LedgerSection />
    </>
  )
}
