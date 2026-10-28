import { useEffect, useState } from 'react'
import { Calculator, Layers, Plus } from 'lucide-react'
import {
  createNewCalculator,
  type IndividualCalculatorState,
} from '../../lib/investmentEngine'
import { CalculatorCard } from '../../components/investment-calculator/CalculatorCard'
import { CompiledComparison } from '../../components/investment-calculator/CompiledComparison'
import { useAuth } from '../../state/useAuth'
import { useStore } from '../../state/useStore'
import { rateToPercent } from '../../lib/inflation'
import { CalculatorsPage } from './Calculators'

const STORAGE_PREFIX = 'arthayukti.investment_calculators'

function getStorageKey(userId?: string): string {
  return `${STORAGE_PREFIX}.${userId || 'guest'}`
}

function QuickCalculators() {
  const auth = useAuth()
  const { inflation } = useStore()
  const defaultInflation = inflation ? rateToPercent(inflation.rate) : '6.0'

  const storageKey = getStorageKey(auth.status === 'authenticated' ? auth.user?.id : undefined)

  // Initialize from storage or with Calculator 1
  const [calculators, setCalculators] = useState<IndividualCalculatorState[]>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as IndividualCalculatorState[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch {
      // storage unavailable or corrupt
    }
    return [createNewCalculator(1, defaultInflation)]
  })

  // Whether the consolidated comparison section is currently compiled/visible
  const [hasCompiled, setHasCompiled] = useState(false)

  // Persist collection on change
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(calculators))
    } catch {
      // ignore storage write failures
    }
  }, [calculators, storageKey])

  // Renumber unnamed calculators based on position when a deletion occurs
  const renumberUnnamed = (list: IndividualCalculatorState[]): IndividualCalculatorState[] => {
    return list.map((c, idx) => {
      if (!c.isCustomName) {
        return { ...c, name: `Calculator ${idx + 1}` }
      }
      return c
    })
  }

  const handleAddCalculator = () => {
    const nextIndex = calculators.length + 1
    const newCalc = createNewCalculator(nextIndex, defaultInflation)
    setCalculators((prev) => [...prev, newCalc])
  }

  const handleUpdateCalculator = (updated: IndividualCalculatorState) => {
    setCalculators((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  const handleDeleteCalculator = (id: string) => {
    setCalculators((prev) => {
      if (prev.length <= 1) return prev // keep at least 1
      const filtered = prev.filter((c) => c.id !== id)
      return renumberUnnamed(filtered)
    })
  }

  const handleCompileAll = () => {
    setHasCompiled(true)
    const element = document.getElementById('compiled-comparison')
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const calculatedCount = calculators.filter((c) => c.isCalculated && c.result !== null).length

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header section */}
      <section className="flex flex-col gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Calculator size={18} />
          </span>
          <p className="text-[13px] font-semibold tracking-[0.16em] text-brand uppercase">
            Financial Planning Tools
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] leading-tight font-bold tracking-tight text-ink sm:text-[32px]">
              Investment Calculator
            </h1>
            <p className="mt-1 max-w-3xl text-muted text-[15px] leading-relaxed">
              Model, calculate, and compare your <strong>Lump-Sum</strong> and <strong>SIP</strong> investments. Add multiple independent scenarios, retain every calculation, and compile them into a consolidated portfolio comparison.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCompileAll}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[14px] font-semibold text-white shadow-xs transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Layers size={16} />
              {hasCompiled ? 'Refresh Compiled Comparison' : 'Compile All Calculators'}
              <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[12px]">
                {calculatedCount}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Compiled Comparison View (if activated or any calculated) */}
      {(hasCompiled || calculatedCount > 0) && (
        <CompiledComparison calculators={calculators} />
      )}

      {/* Section Heading for Stacked Calculators */}
      <div className="flex items-center justify-between border-b border-line/60 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[18px] font-bold text-ink">
            Your Calculator Collection ({calculators.length})
          </h2>
          <span className="text-[13px] text-muted">
            · {calculatedCount} calculated
          </span>
        </div>
        <span className="text-[13px] text-muted">
          Calculators are independent and automatically preserved.
        </span>
      </div>

      {/* Vertically Stacked Calculator Cards */}
      <div className="flex flex-col gap-6">
        {calculators.map((calc) => (
          <CalculatorCard
            key={calc.id}
            calc={calc}
            canDelete={calculators.length > 1}
            onUpdate={handleUpdateCalculator}
            onDelete={handleDeleteCalculator}
          />
        ))}
      </div>

      {/* Prominent Add Calculator Button */}
      <button
        type="button"
        onClick={handleAddCalculator}
        className="flex min-h-16 items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-brand/40 bg-surface/40 p-4 text-[16px] font-bold text-brand transition hover:border-brand hover:bg-brand/5 hover:shadow-xs focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Plus size={20} />
        </span>
        Add Calculator
      </button>
    </div>
  )
}

/**
 * Two ways to the same idea. Quick calculators keep their own state in this browser. Detailed calculators are valued by the
 * server's one engine (tax on the gain or the whole value, effective or monthly-compounded rates, step-ups, valuation on a
 * common date, comparison) and can be saved to your account.
 */
export function InvestmentCalculatorPage() {
  const [view, setView] = useState<'quick' | 'detailed'>('quick')
  const tab = (value: 'quick' | 'detailed', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => setView(value)}
      className={`min-h-11 rounded-xl px-4 text-[15px] font-semibold ${view === value ? 'bg-ink text-white' : 'border border-line text-muted hover:text-ink'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Calculator type" className="flex flex-wrap gap-2">
        {tab('quick', 'Quick calculators')}
        {tab('detailed', 'Detailed calculators (saved to your account)')}
      </div>
      {view === 'quick' ? <QuickCalculators /> : <CalculatorsPage />}
    </div>
  )
}
