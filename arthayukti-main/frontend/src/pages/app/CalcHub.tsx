import { useState } from 'react'
import { Notice } from '../../components/panel'
import { useRestructureCopy } from '../../state/useRestructureCopy'
import { CalculatorsPage } from './Calculators'
import { DebtCalculator } from './DebtCalc'
import { HoldingLedger } from './HoldingLedger'
import { AssetsPage, DebtsPage, InsurancePage } from './Records'
import { StockPortfolioPage } from './StockPortfolio'

/** Insurance is its own area: policies, premiums and renewal reminders. */
export function InsuranceModule() {
  const t = useRestructureCopy().insurance
  return (
    <>
      <Notice>{t.note}</Notice>
      <InsurancePage />
    </>
  )
}

/** Debts is its own area: the loan calculator and the debts you record. */
export function DebtsModule() {
  return (
    <>
      <DebtCalculator />
      <DebtsPage />
    </>
  )
}

/** Equities: the investment calculator (growth, tax, inflation, saved scenarios) and the holdings it relates to. */
export function EquitiesModule() {
  const t = useRestructureCopy().equities
  const [view, setView] = useState<'calculator' | 'holdings' | 'portfolio'>('calculator')
  return (
    <>
      <div role="group" aria-label={t.tabs} className="flex w-fit gap-1 rounded-xl bg-surface/60 p-1 text-[14px]">
        {(['calculator', 'holdings', 'portfolio'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={`min-h-10 rounded-xl px-4 ${view === id ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'}`}
          >
            {t[id]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand/30 bg-brand/5 p-3.5 text-[14px]">
        <span>Model multiple independent Lump-Sum &amp; SIP investments with side-by-side comparison.</span>
        <a href="#/calculators" className="font-semibold text-brand underline underline-offset-4 hover:text-brand/80">
          Open Investment Calculator &rarr;
        </a>
      </div>
      {view === 'portfolio' ? null : <Notice>{t.note}</Notice>}
      {view === 'calculator' ? (
        <CalculatorsPage />
      ) : view === 'portfolio' ? (
        <StockPortfolioPage />
      ) : (
        <>
          <AssetsPage />
          <HoldingLedger />
        </>
      )}
    </>
  )
}
