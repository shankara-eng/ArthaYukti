import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import type { PortfolioPosition } from '../../api/types'
import type { PortfolioCopy } from '../../i18n/portfolio'
import { formatMoney } from '../../lib/money'
import type { Language } from '../../lib/months'
import { blankForm, formIssues, signedPercent, trimQuantity, whenText, type HoldingForm } from '../../lib/portfolio'
import { useAction } from '../../state/useAction'
import { FormError, TextField } from '../forms'

const money = (amount: string) => formatMoney(amount, { paise: true })

interface Props {
  holdings: PortfolioPosition[]
  copy: PortfolioCopy
  language: Language
  onChanged: () => void
}

/** One card per holding: money in, latest price and how fresh it is, value, profit or loss. Nothing unknown is shown as 0. */
export function HoldingsList({ holdings, copy, language, onChanged }: Props) {
  return (
    <ul className="flex flex-col gap-4">
      {holdings.map((holding) => (
        <HoldingCard key={holding.id} holding={holding} copy={copy} language={language} onChanged={onChanged} />
      ))}
    </ul>
  )
}

function HoldingCard({ holding, copy, language, onChanged }: Omit<Props, 'holdings'> & { holding: PortfolioPosition }) {
  const t = copy.holdings
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const removal = useAction()
  const when = whenText(holding.price_fetched_at, language)
  const loss = holding.unrealised !== null && holding.unrealised.startsWith('-')

  async function remove() {
    if (await removal.run(() => api.portfolioDelete(holding.id))) onChanged()
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words">{holding.company_name}</p>
          <p className="font-figures text-[13px] text-muted">
            {holding.symbol} · {holding.exchange}
          </p>
        </div>
        <p className="text-[14px] font-semibold" data-status={holding.price_status}>
          {holding.closed ? t.closed : t.statuses[holding.price_status]}
        </p>
      </div>
      <p className="text-[13px] text-muted">{holding.purchase_date ? (holding.purchase_date_entered ? t.purchased(holding.purchase_date) : t.purchasedNoDate(holding.purchase_date)) : ''}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] sm:grid-cols-4">
        {!holding.closed ? (
          <>
            <Figure label={t.quantity} value={trimQuantity(holding.quantity)} />
            <Figure label={t.average} value={holding.average_cost ? money(holding.average_cost) : '–'} />
          </>
        ) : null}
        <Figure label={t.invested} value={money(holding.invested)} />
        {!holding.closed ? (
          <>
            <Figure label={t.price} value={holding.price ? money(holding.price) : '–'} note={holding.price ? (holding.price_status === 'stale' ? `${t.statuses.stale}: ${t.priceAt(when)}` : t.priceAt(when)) : undefined} />
            <Figure label={t.value} value={holding.market_value ? money(holding.market_value) : '–'} />
            <Figure
              label={t.profit}
              value={holding.unrealised !== null ? `${money(holding.unrealised)} (${signedPercent(holding.unrealised_pct)})` : '–'}
              tone={holding.unrealised === null ? undefined : loss ? 'late' : 'good'}
            />
            <Figure label={t.weight} value={holding.weight_pct ? `${holding.weight_pct}%` : '–'} />
          </>
        ) : null}
        {Number(holding.realised) !== 0 || holding.closed ? <Figure label={t.realised} value={money(holding.realised)} /> : null}
      </dl>
      {!holding.closed && holding.price === null ? <p className="text-[13px] text-muted">{t.noPrice}</p> : null}

      {editing ? (
        <EditForm holding={holding} copy={copy} onDone={() => setEditing(false)} onSaved={onChanged} />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {asking ? (
            <>
              <span role="alert" className="mr-auto text-[14px] font-semibold">
                {t.removeAsk}
              </span>
              <button type="button" disabled={removal.busy} onClick={() => void remove()} className="min-h-10 rounded-lg bg-late px-3 font-semibold text-white disabled:opacity-60">
                {t.yes}
              </button>
              <button type="button" onClick={() => setAsking(false)} className="min-h-10 rounded-lg border border-line px-3 font-semibold">
                {t.keep}
              </button>
            </>
          ) : (
            <>
              {holding.editable ? (
                <button type="button" aria-label={`${t.edit} ${holding.symbol}`} onClick={() => setEditing(true)} className="flex min-h-10 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold">
                  <Pencil size={16} aria-hidden="true" />
                  {t.edit}
                </button>
              ) : (
                <p className="mr-auto text-[13px] text-muted">{t.several}</p>
              )}
              <button type="button" aria-label={`${t.remove} ${holding.symbol}`} onClick={() => setAsking(true)} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-[14px] font-semibold">
                <Trash2 size={16} aria-hidden="true" />
                {t.remove}
              </button>
            </>
          )}
        </div>
      )}
      {removal.failure ? <FormError>{copy.add.failed}</FormError> : null}
    </li>
  )
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'late' }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-figures font-semibold ${tone === 'late' ? 'text-late' : tone === 'good' ? 'text-ontime' : ''}`}>{value}</dd>
      {note ? <dd className="text-[12px] text-muted">{note}</dd> : null}
    </div>
  )
}

function EditForm({ holding, copy, onDone, onSaved }: { holding: PortfolioPosition; copy: PortfolioCopy; onDone: () => void; onSaved: () => void }) {
  const t = copy.holdings
  const a = copy.add
  const [form, setForm] = useState<HoldingForm>({
    ...blankForm(),
    quantity: trimQuantity(holding.quantity),
    price: holding.average_cost ? holding.average_cost.replace(/\.?0+$/, '') : '',
    date: holding.purchase_date_entered && holding.purchase_date ? holding.purchase_date : '',
  })
  const [attempted, setAttempted] = useState(false)
  const action = useAction()
  const issues = formIssues(form, { symbol: false })
  const show = (issue: (typeof issues)[number]) => (attempted && issues.includes(issue) ? a.issues[issue] : null)

  async function save() {
    setAttempted(true)
    if (issues.length > 0) return
    const ok = await action.run(() =>
      api.portfolioEdit(holding.id, {
        quantity: form.quantity.trim(),
        average_price: form.price.trim(),
        ...(form.date.trim() ? { purchase_date: form.date.trim() } : {}),
      }),
    )
    if (ok) {
      onSaved()
      onDone()
    }
  }

  return (
    <form
      noValidate
      aria-label={`${t.edit} ${holding.symbol}`}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="flex flex-col gap-3 rounded-xl bg-sand/50 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={`${a.quantity} (${holding.symbol})`} value={form.quantity} onChange={(quantity) => setForm({ ...form, quantity })} inputMode="numeric" maxLength={10} error={show('quantity')} />
        <TextField label={`${a.price} (${holding.symbol})`} value={form.price} onChange={(price) => setForm({ ...form, price })} inputMode="decimal" maxLength={13} error={show('price')} />
        <TextField label={`${a.date} (${holding.symbol})`} value={form.date} onChange={(date) => setForm({ ...form, date })} maxLength={10} placeholder="YYYY-MM-DD" error={show('date')} />
      </div>
      {action.failure ? <FormError>{a.failed}</FormError> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={action.busy} aria-busy={action.busy} className="min-h-10 rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-60">
          {action.busy ? t.saving : t.save}
        </button>
        <button type="button" disabled={action.busy} onClick={onDone} className="min-h-10 rounded-lg border border-line px-4 font-semibold disabled:opacity-60">
          {t.cancel}
        </button>
      </div>
    </form>
  )
}
