import { useState } from 'react'
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Edit2,
  Repeat,
  Trash2,
  Check,
  X,
} from 'lucide-react'
import type {
  CalculatorType,
  IndividualCalculatorState,
  LumpSumInputs,
  SipInputs,
} from '../../lib/investmentEngine'
import { calculateLumpSum, calculateSip } from '../../lib/investmentEngine'
import { LumpSumForm } from './LumpSumForm'
import { SipForm } from './SipForm'
import { CalculatorResultsView } from './CalculatorResultsView'

interface CalculatorCardProps {
  calc: IndividualCalculatorState
  canDelete: boolean
  onUpdate: (updated: IndividualCalculatorState) => void
  onDelete: (id: string) => void
}

export function CalculatorCard({
  calc,
  canDelete,
  onUpdate,
  onDelete,
}: CalculatorCardProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempName, setTempName] = useState(calc.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [switchWarning, setSwitchWarning] = useState<CalculatorType | null>(null)

  const handleNameSave = () => {
    const trimmed = tempName.trim()
    if (trimmed) {
      onUpdate({ ...calc, name: trimmed, isCustomName: true })
    }
    setIsEditingName(false)
  }

  const handleSelectType = (newType: CalculatorType) => {
    // Preserve compatible fields when switching
    if (calc.type && calc.type !== newType) {
      // Prompt warning or preserve directly
      setSwitchWarning(newType)
      return
    }
    applyTypeChange(newType)
  }

  const applyTypeChange = (newType: CalculatorType) => {
    let nextLump = { ...calc.lumpSumInputs }
    let nextSip = { ...calc.sipInputs }

    if (newType === 'lump_sum' && calc.type === 'sip') {
      // transfer compatible fields
      nextLump.investmentName = calc.sipInputs.investmentName
      nextLump.expectedReturnPercent = calc.sipInputs.expectedReturnPercent
      nextLump.durationYears = calc.sipInputs.durationYears
      nextLump.inflationRatePercent = calc.sipInputs.inflationRatePercent
      nextLump.taxMethod = calc.sipInputs.taxMethod
      nextLump.taxRatePercent = calc.sipInputs.taxRatePercent
      nextLump.taxExemptionAmount = calc.sipInputs.taxExemptionAmount
      if (parseFloat(calc.sipInputs.initialAmount) > 0) {
        nextLump.initialAmount = calc.sipInputs.initialAmount
      }
    } else if (newType === 'sip' && calc.type === 'lump_sum') {
      nextSip.investmentName = calc.lumpSumInputs.investmentName
      nextSip.expectedReturnPercent = calc.lumpSumInputs.expectedReturnPercent
      nextSip.durationYears = calc.lumpSumInputs.durationYears
      nextSip.inflationRatePercent = calc.lumpSumInputs.inflationRatePercent
      nextSip.taxMethod = calc.lumpSumInputs.taxMethod
      nextSip.taxRatePercent = calc.lumpSumInputs.taxRatePercent
      nextSip.taxExemptionAmount = calc.lumpSumInputs.taxExemptionAmount
    }

    onUpdate({
      ...calc,
      type: newType,
      lumpSumInputs: nextLump,
      sipInputs: nextSip,
      isCalculated: false,
      isOutdated: false,
      result: null,
    })
    setSwitchWarning(null)
  }

  const handleLumpSumChange = (inputs: LumpSumInputs) => {
    onUpdate({
      ...calc,
      lumpSumInputs: inputs,
      isOutdated: calc.isCalculated, // mark outdated if already calculated
    })
  }

  const handleSipChange = (inputs: SipInputs) => {
    onUpdate({
      ...calc,
      sipInputs: inputs,
      isOutdated: calc.isCalculated,
    })
  }

  const handleCalculate = () => {
    if (calc.type === 'lump_sum') {
      const res = calculateLumpSum(calc.lumpSumInputs)
      onUpdate({
        ...calc,
        result: res,
        isCalculated: true,
        isOutdated: false,
      })
    } else if (calc.type === 'sip') {
      const res = calculateSip(calc.sipInputs)
      onUpdate({
        ...calc,
        result: res,
        isCalculated: true,
        isOutdated: false,
      })
    }
  }

  const toggleCollapse = () => {
    onUpdate({ ...calc, isCollapsed: !calc.isCollapsed })
  }

  return (
    <div
      id={`calculator-card-${calc.id}`}
      className={`glass flex flex-col gap-5 rounded-3xl border transition-all duration-200 ${
        calc.isCalculated ? 'border-brand/30 shadow-card' : 'border-line/70'
      } p-6`}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-4">
        {/* Left: Name and Badges */}
        <div className="flex flex-wrap items-center gap-3">
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSave()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                autoFocus
                className="min-h-9 rounded-xl border border-brand bg-paper px-2.5 text-[17px] font-bold text-ink"
              />
              <button
                type="button"
                onClick={handleNameSave}
                aria-label="Confirm name"
                className="flex size-8 items-center justify-center rounded-lg bg-brand text-white"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingName(false)}
                aria-label="Cancel"
                className="flex size-8 items-center justify-center rounded-lg border border-line text-muted"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[19px] font-bold tracking-tight text-ink">
                {calc.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setTempName(calc.name)
                  setIsEditingName(true)
                }}
                aria-label={`Rename ${calc.name}`}
                className="flex size-7 items-center justify-center rounded-md text-muted/70 transition hover:bg-surface hover:text-ink"
              >
                <Edit2 size={13} />
              </button>
            </div>
          )}

          {/* Type Badge */}
          {calc.type ? (
            <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[12px] font-semibold text-brand">
              {calc.type === 'lump_sum' ? 'Lump-Sum Calculator' : 'SIP Calculator'}
            </span>
          ) : (
            <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium text-muted">
              Unconfigured
            </span>
          )}

          {/* Status Badge */}
          {calc.isCalculated && !calc.isOutdated && (
            <span className="rounded-full bg-ontime/10 px-2.5 py-0.5 text-[12px] font-semibold text-ontime">
              Calculated
            </span>
          )}
          {calc.isOutdated && (
            <span className="rounded-full bg-late/10 px-2.5 py-0.5 text-[12px] font-semibold text-late">
              Needs Recalculation
            </span>
          )}
        </div>

        {/* Right: Actions (Collapse, Delete) */}
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-xl bg-late/10 p-1 text-[13px]">
              <span className="pl-2 font-medium text-late">Confirm remove?</span>
              <button
                type="button"
                onClick={() => onDelete(calc.id)}
                className="rounded-lg bg-late px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-late/90"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-line bg-paper px-2 py-1 text-[12px] text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            canDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={`Delete ${calc.name}`}
                className="flex size-9 items-center justify-center rounded-xl text-muted/70 transition hover:bg-late/10 hover:text-late"
              >
                <Trash2 size={16} />
              </button>
            )
          )}

          <button
            type="button"
            onClick={toggleCollapse}
            aria-label={calc.isCollapsed ? `Expand ${calc.name}` : `Collapse ${calc.name}`}
            className="flex size-9 items-center justify-center rounded-xl border border-line/60 bg-paper/60 text-muted transition hover:bg-surface hover:text-ink"
          >
            {calc.isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>

      {/* Card Content (if not collapsed) */}
      {!calc.isCollapsed && (
        <div className="flex flex-col gap-6">
          {/* Step 1: Type Selection (if not selected yet) */}
          {calc.type === null ? (
            <div className="flex flex-col gap-4 py-2">
              <div>
                <p className="text-[15px] font-bold text-ink">Choose Calculator Type</p>
                <p className="text-[13px] text-muted">
                  Select how you want to invest in this scenario. You can configure multiple calculators of any type and compare them together.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Lump-Sum Option Card */}
                <button
                  type="button"
                  onClick={() => handleSelectType('lump_sum')}
                  className="flex flex-col gap-2 rounded-2xl border-2 border-line/80 bg-paper/40 p-5 text-left transition hover:border-brand hover:bg-brand/5 hover:shadow-sm"
                >
                  <div className="flex items-center gap-2 text-brand">
                    <CircleDollarSign size={22} />
                    <span className="font-display text-[17px] font-bold">Lump-Sum Calculator</span>
                  </div>
                  <p className="text-[13px] text-muted leading-relaxed">
                    Calculates the future growth and maturity value of a <strong>single initial deposit</strong> made on day one, compounded periodically over your target duration.
                  </p>
                  <div className="mt-2 text-[12px] font-semibold text-brand">
                    Configure Lump-Sum &rarr;
                  </div>
                </button>

                {/* SIP Option Card */}
                <button
                  type="button"
                  onClick={() => handleSelectType('sip')}
                  className="flex flex-col gap-2 rounded-2xl border-2 border-line/80 bg-paper/40 p-5 text-left transition hover:border-brand hover:bg-brand/5 hover:shadow-sm"
                >
                  <div className="flex items-center gap-2 text-brand">
                    <Repeat size={22} />
                    <span className="font-display text-[17px] font-bold">SIP Calculator</span>
                  </div>
                  <p className="text-[13px] text-muted leading-relaxed">
                    Calculates the future value of <strong>regular recurring contributions</strong> (monthly, quarterly or annual) with support for periodic annual step-ups and optional initial lump sum.
                  </p>
                  <div className="mt-2 text-[12px] font-semibold text-brand">
                    Configure SIP &rarr;
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Type Switch Header with Warning */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-paper/40 px-4 py-2.5 text-[13px]">
                <span className="text-muted">
                  Currently configured as:{' '}
                  <strong className="text-ink">
                    {calc.type === 'lump_sum' ? 'Lump-Sum Investment' : 'SIP Investment'}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleSelectType(calc.type === 'lump_sum' ? 'sip' : 'lump_sum')
                  }
                  className="font-semibold text-brand underline underline-offset-4 hover:text-brand/80"
                >
                  Switch to {calc.type === 'lump_sum' ? 'SIP Calculator' : 'Lump-Sum Calculator'}
                </button>
              </div>

              {/* Warning Modal/Banner when switching types */}
              {switchWarning && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-turmeric/50 bg-turmeric/10 p-4 text-[13px] text-ink">
                  <div>
                    <strong className="font-semibold text-turmeric">Switch Calculator Type?</strong>
                    <p className="text-muted">
                      Common settings (name, tenure, return rate, inflation, and tax) will be preserved. Incompatible fields will be reset.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => applyTypeChange(switchWarning)}
                      className="rounded-xl bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand/90"
                    >
                      Confirm Switch
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwitchWarning(null)}
                      className="rounded-xl border border-line bg-paper px-3 py-1.5 text-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Specific Form Inputs */}
              {calc.type === 'lump_sum' && (
                <LumpSumForm inputs={calc.lumpSumInputs} onChange={handleLumpSumChange} />
              )}
              {calc.type === 'sip' && (
                <SipForm inputs={calc.sipInputs} onChange={handleSipChange} />
              )}

              {/* Prominent Calculate Button */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCalculate}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-6 text-[15px] font-bold text-white shadow-xs transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <Calculator size={18} />
                  Calculate {calc.type === 'lump_sum' ? 'Lump-Sum' : 'SIP'} Outcomes
                </button>
                {calc.isOutdated && (
                  <span className="text-[13px] font-medium text-late">
                    * Click Calculate to update your results
                  </span>
                )}
              </div>

              {/* Results View */}
              {calc.result && (
                <CalculatorResultsView
                  result={calc.result}
                  isOutdated={calc.isOutdated}
                  onRecalculate={handleCalculate}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
