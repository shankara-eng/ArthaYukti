import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { ApiFailure, api } from '../../api/client'
import type { HoldingTransactionCreate } from '../../api/types'
import { DateField, FormError, SelectField, TextField } from '../../components/forms'
import { Loaded, Notice, Panel, Stat, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { useAction } from '../../state/useAction'
import { useRemote } from '../../state/useRemote'
import { useRestructureCopy } from '../../state/useRestructureCopy'

type Kind = 'buy' | 'sell' | 'split' | 'bonus' | 'dividend'
const KINDS: Kind[] = ['buy', 'sell', 'split', 'bonus', 'dividend']
const submit = 'min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60'

const money = (value: string) => formatMoney(value, { paise: true })
const units = (value: string) => String(Number(value))
const today = () => new Date().toISOString().slice(0, 10)

/** Recorded transactions on a holding, the position they give, and what that position is worth and where that figure comes from. */
export function HoldingLedger() {
  const t = useRestructureCopy().holdings
  const holdings = useRemote('ledger-holdings', (signal) => api.investments(signal))
  const [picked, setPicked] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const id = picked ?? holdings.data?.[0]?.id ?? null

  const position = useRemote(id ? `position:${id}:${version}` : null, (signal) => api.holdingPosition(id as string, signal))
  const transactions = useRemote(id ? `transactions:${id}:${version}` : null, (signal) => api.holdingTransactions(id as string, signal))

  const [kind, setKind] = useState<Kind>('buy')
  const [date, setDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('')
  const [ratioNew, setRatioNew] = useState('')
  const [ratioOld, setRatioOld] = useState('')
  const [notes, setNotes] = useState('')
  const [tried, setTried] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)
  const save = useAction()
  const remove = useAction()
  const apply = useAction()
  const exporter = useAction()

  const reload = () => {
    setVersion((v) => v + 1)
    holdings.reload()
  }

  const needsUnits = kind === 'buy' || kind === 'sell'
  const needsRatio = kind === 'split' || kind === 'bonus'
  const hasPrice = kind !== 'split' && kind !== 'bonus'
  const okNumber = (value: string, places: number) => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(value.trim()) && Number(value) > 0
  const okFees = fees.trim() === '' || /^\d+(\.\d{1,2})?$/.test(fees.trim())
  const okRatio = (value: string) => /^[1-9]\d{0,2}$|^1000$/.test(value.trim())
  const dateBad = date === '' || date > today()
  const problems = {
    date: dateBad,
    quantity: needsUnits && !okNumber(quantity, 6),
    price: hasPrice && !okNumber(price, 4),
    fees: hasPrice && !okFees,
    ratio: needsRatio && !(okRatio(ratioNew) && okRatio(ratioOld)),
  }
  const invalid = Object.values(problems).some(Boolean)

  async function add() {
    setTried(true)
    setApplied(null)
    if (!id || invalid) return
    const body: HoldingTransactionCreate = {
      transaction_type: kind,
      trade_date: date,
      fees: hasPrice && fees.trim() !== '' ? fees.trim() : '0.00',
      ...(needsUnits ? { quantity: quantity.trim() } : {}),
      ...(hasPrice ? { price: price.trim() } : {}),
      ...(needsRatio ? { ratio_new: Number(ratioNew), ratio_old: Number(ratioOld) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    const ok = await save.run(() => api.addHoldingTransaction(id, body))
    if (ok) {
      setQuantity('')
      setPrice('')
      setFees('')
      setRatioNew('')
      setRatioOld('')
      setNotes('')
      setTried(false)
      reload()
    }
  }

  async function csv() {
    if (!id) return
    await exporter.run(async () => {
      const blob = await api.holdingLedgerCsv(id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'arthayukti_holding_ledger.csv'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  const failureText = (failure: unknown) =>
    failure instanceof ApiFailure && (failure.code === 'ledger_invalid' || failure.code === 'ledger_conflict') ? failure.message : t.errors.generic

  return (
    <Panel id="holding-ledger" title={t.ledgerTitle}>
      <p className="text-muted">{t.ledgerIntro}</p>
      <Loaded remote={holdings}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-muted">{t.none}</p>
          ) : (
            <div className="flex flex-col gap-5">
              <SelectField label={t.choose} value={id ?? ''} onChange={(value) => { setPicked(value); setApplied(null) }} options={list.map((h) => ({ value: h.id, label: h.asset_name }))} />

              <Loaded remote={position}>
                {(p) => (
                  <div className="flex flex-col gap-4" aria-label={t.position} role="region">
                    <h3 className="font-semibold">{t.position}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Stat label={t.units} value={units(p.quantity)} />
                      <Stat label={t.cost} value={money(p.cost_basis)} />
                      <Stat label={t.average} value={p.average_cost ? money(p.average_cost) : '–'} />
                      <Stat label={t.realised} value={money(p.realised_gain)} tone={Number(p.realised_gain) < 0 ? 'late' : undefined} />
                      <Stat label={t.dividends} value={money(p.dividends_net)} />
                      <Stat label={t.fees} value={money(p.fees_paid)} />
                    </div>
                    <div className="rounded-2xl border border-line p-4">
                      <p className="font-semibold">
                        {t.value}: {p.valuation.value ? money(p.valuation.value) : '–'}{' '}
                        {p.valuation.basis !== 'none' ? (
                          <span className="font-normal text-muted">
                            ({t.valuation[p.valuation.basis]}, {t.status[p.valuation.status]}
                            {p.valuation.as_of ? `, ${t.asOf} ${p.valuation.as_of.slice(0, 10)}` : ''})
                          </span>
                        ) : null}
                      </p>
                      {p.valuation.unrealised_gain ? (
                        <p>
                          {t.unrealised}: <strong className="font-figures">{money(p.valuation.unrealised_gain)}</strong>
                        </p>
                      ) : null}
                      <p className="text-[14px] text-muted">{p.valuation.message}</p>
                    </div>
                    <div className="rounded-2xl border border-line p-4">
                      <h4 className="font-semibold">{t.reconcileTitle}</h4>
                      <p>
                        {!p.reconciliation.has_ledger
                          ? t.noLedger
                          : p.reconciliation.matches
                            ? t.matches
                            : t.differs(units(p.reconciliation.record_quantity), units(p.reconciliation.ledger_quantity))}
                      </p>
                      {p.reconciliation.has_ledger && !p.reconciliation.matches ? (
                        <>
                          <p className="text-[14px] text-muted">{t.applyNote}</p>
                          <button
                            type="button"
                            disabled={apply.busy}
                            onClick={async () => {
                              const ok = await apply.run(() => api.applyHoldingLedger(p.holding_id))
                              if (ok) {
                                setApplied(t.applied)
                                reload()
                              }
                            }}
                            className={submit}
                          >
                            {apply.busy ? t.applying : t.apply}
                          </button>
                        </>
                      ) : null}
                      {apply.failure ? <FormError>{t.errors.generic}</FormError> : null}
                      {applied ? <p role="status" className="rounded-xl bg-sage px-4 py-3 font-semibold">{applied}</p> : null}
                    </div>
                    <Notice>{t.taxNote}</Notice>
                  </div>
                )}
              </Loaded>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{t.transactions}</h3>
                  <button type="button" disabled={exporter.busy || !(transactions.data && transactions.data.length)} onClick={() => void csv()} className="flex min-h-9 items-center gap-2 rounded-lg border border-ink px-3 text-[14px] font-semibold disabled:opacity-50">
                    <Download size={16} aria-hidden="true" />
                    {t.csv}
                  </button>
                </div>
                {exporter.failure ? <FormError>{t.errors.generic}</FormError> : null}
                {remove.failure ? <FormError>{failureText(remove.failure)}</FormError> : null}
                <Loaded remote={transactions}>
                  {(rows) =>
                    rows.length === 0 ? (
                      <p className="text-muted">{t.noLedger}</p>
                    ) : (
                      <Table
                        caption={t.transactions}
                        head={t.head}
                        rows={rows.map((row) => [
                          row.trade_date,
                          t.types[row.transaction_type],
                          row.quantity ? units(row.quantity) : '–',
                          row.price ? money(row.price) : '–',
                          Number(row.fees) ? money(row.fees) : '–',
                          row.ratio_new ? `${row.ratio_new}:${row.ratio_old}` : '–',
                          units(row.quantity_after),
                          money(row.cost_basis_after),
                          row.transaction_type === 'sell' ? money(row.realised_gain) : '–',
                          <button
                            key={row.id}
                            type="button"
                            disabled={remove.busy}
                            aria-label={t.removeLabel(`${t.types[row.transaction_type]} ${row.trade_date}`)}
                            onClick={async () => {
                              const ok = await remove.run(() => api.deleteHoldingTransaction(row.holding_id, row.id))
                              if (ok) reload()
                            }}
                            className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-late"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>,
                        ])}
                      />
                    )
                  }
                </Loaded>
              </div>

              <form
                noValidate
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void add()
                }}
              >
                <h3 className="font-semibold sm:col-span-2">{t.add}</h3>
                <SelectField<Kind> label={t.type} value={kind} onChange={setKind} options={KINDS.map((value) => ({ value, label: t.types[value] }))} />
                <DateField label={t.date} value={date} onChange={setDate} error={tried && problems.date ? t.badDate : null} />
                {needsUnits ? <TextField label={t.quantity} value={quantity} onChange={setQuantity} inputMode="decimal" error={tried && problems.quantity ? t.badNumber : null} /> : null}
                {hasPrice ? <TextField label={kind === 'dividend' ? t.priceDividend : t.price} value={price} onChange={setPrice} inputMode="decimal" error={tried && problems.price ? t.badNumber : null} /> : null}
                {hasPrice ? <TextField label={t.feesLabel} value={fees} onChange={setFees} inputMode="decimal" error={tried && problems.fees ? t.badNumber : null} /> : null}
                {needsRatio ? (
                  <>
                    <TextField label={t.ratioNew} value={ratioNew} onChange={setRatioNew} inputMode="numeric" hint={t.ratioHint} error={tried && problems.ratio ? t.badRatio : null} />
                    <TextField label={t.ratioOld} value={ratioOld} onChange={setRatioOld} inputMode="numeric" error={tried && problems.ratio ? t.badRatio : null} />
                  </>
                ) : null}
                <TextField label={t.notes} value={notes} onChange={setNotes} maxLength={255} />
                {save.failure ? (
                  <div className="sm:col-span-2">
                    <FormError>{failureText(save.failure)}</FormError>
                  </div>
                ) : null}
                <button type="submit" disabled={save.busy} className={submit}>
                  {save.busy ? t.saving : t.save}
                </button>
              </form>
            </div>
          )
        }
      </Loaded>
    </Panel>
  )
}
