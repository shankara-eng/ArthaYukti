import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, TrendingUp } from 'lucide-react'
import type { CalculationResult } from '../../lib/investmentEngine'
import { formatMoney } from '../../lib/money'

interface CalculatorResultsViewProps {
  result: CalculationResult
  isOutdated?: boolean
  onRecalculate?: () => void
}

export function CalculatorResultsView({
  result,
  isOutdated,
  onRecalculate,
}: CalculatorResultsViewProps) {
  const [showTable, setShowTable] = useState(false)

  const investedNum = parseFloat(result.totalInvested) || 0
  const gainsNum = parseFloat(result.estimatedGains) || 0
  const totalCorpusNum = parseFloat(result.preTaxMaturityValue) || 0

  // Multiplier
  const multiplier = investedNum > 0 ? (totalCorpusNum / investedNum).toFixed(2) : '1.00'

  // Donut chart calculations
  const totalPie = investedNum + gainsNum
  const investedPercent = totalPie > 0 ? Math.round((investedNum / totalPie) * 100) : 50
  const gainsPercent = totalPie > 0 ? 100 - investedPercent : 50

  // Circumference for r=50 is 2*PI*50 = 314.159
  const circumference = 314.159
  const investedStroke = (investedPercent / 100) * circumference
  const gainsStroke = (gainsPercent / 100) * circumference

  // Growth timeline coordinates
  const points = result.yearlyBreakdown
  const maxVal = Math.max(
    ...points.map((p) => Math.max(parseFloat(p.closingBalance), parseFloat(p.cumulativeInvested))),
    1,
  )

  // SVG dimensions for growth chart
  const chartWidth = 500
  const chartHeight = 180
  const padX = 40
  const padY = 20
  const usableW = chartWidth - padX * 2
  const usableH = chartHeight - padY * 2

  const getX = (index: number) => padX + (index / Math.max(points.length - 1, 1)) * usableW
  const getY = (val: number) => chartHeight - padY - (val / maxVal) * usableH

  // Build SVG path strings
  const investedPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(parseFloat(p.cumulativeInvested)).toFixed(1)}`)
    .join(' ')

  const closingPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(parseFloat(p.closingBalance)).toFixed(1)}`)
    .join(' ')

  const areaPath = `${closingPath} L ${getX(points.length - 1)} ${chartHeight - padY} L ${getX(0)} ${chartHeight - padY} Z`

  return (
    <div className="flex flex-col gap-5 border-t border-line/60 pt-5">
      {/* Outdated state banner */}
      {isOutdated && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-late/40 bg-late/10 px-4 py-3 text-late">
          <div className="flex items-center gap-2 text-[14px] font-medium">
            <AlertCircle size={18} className="shrink-0" />
            <span>Inputs have changed since this calculation. Displayed results may be outdated.</span>
          </div>
          {onRecalculate && (
            <button
              type="button"
              onClick={onRecalculate}
              className="flex items-center gap-1.5 rounded-xl bg-late px-3 py-1.5 text-[13px] font-semibold text-white shadow-xs hover:bg-late/90"
            >
              <RefreshCw size={14} />
              Recalculate Now
            </button>
          )}
        </div>
      )}

      {/* Primary Key Figures Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-line bg-paper/60 p-3.5">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Total Invested</p>
          <p className="font-figures text-[20px] font-bold text-ink sm:text-[22px]">
            {formatMoney(result.totalInvested)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {result.calculatorType === 'sip' && parseFloat(result.initialInvestment) > 0
              ? `₹${parseFloat(result.initialInvestment).toLocaleString('en-IN')} init + ₹${parseFloat(result.totalRecurringContributions).toLocaleString('en-IN')} SIP`
              : `${result.durationYears} yrs @ ${result.expectedReturnPercent}%`}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-paper/60 p-3.5">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Estimated Gains</p>
          <p className="font-figures text-[20px] font-bold text-ontime sm:text-[22px]">
            +{formatMoney(result.estimatedGains)}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-ontime/80">
            {multiplier}x Wealth Multiplier
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-paper/60 p-3.5">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Pre-Tax Maturity</p>
          <p className="font-figures text-[20px] font-bold text-ink sm:text-[22px]">
            {formatMoney(result.preTaxMaturityValue)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">Nominal value at Year {result.durationYears}</p>
        </div>

        <div className="rounded-2xl border border-line bg-paper/60 p-3.5">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Estimated Tax</p>
          <p className="font-figures text-[20px] font-bold text-ink sm:text-[22px]">
            {parseFloat(result.estimatedTax) > 0 ? `-${formatMoney(result.estimatedTax)}` : '₹0'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {result.taxMethod === 'none'
              ? 'Tax-exempt'
              : result.taxMethod === 'flat'
                ? `Flat ${result.taxRatePercent}%`
                : `LTCG (${result.taxRatePercent}% > ₹${parseFloat(result.taxExemptionAmount).toLocaleString('en-IN')})`}
          </p>
        </div>

        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-3.5">
          <p className="text-[12px] font-semibold text-brand uppercase tracking-wider">Post-Tax Value</p>
          <p className="font-figures text-[20px] font-bold text-brand sm:text-[22px]">
            {formatMoney(result.postTaxMaturityValue)}
          </p>
          <p className="mt-0.5 text-[11px] text-brand/80">Net payout in hand</p>
        </div>

        <div className="rounded-2xl border border-turmeric/30 bg-turmeric/5 p-3.5">
          <p className="text-[12px] font-semibold text-turmeric uppercase tracking-wider">Real Value (Purchasing Power)</p>
          <p className="font-figures text-[20px] font-bold text-ink sm:text-[22px]">
            {formatMoney(result.inflationAdjustedMaturityValue)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">Inflation-adjusted today's value</p>
        </div>
      </div>

      {/* Visual Charts: Donut + Growth Timeline */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Donut Chart: Invested vs Gains */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-paper/40 p-4 lg:col-span-4">
          <p className="mb-2 text-[13px] font-semibold text-ink">Corpus Distribution</p>
          <div className="relative flex size-36 items-center justify-center">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="currentColor"
                strokeWidth="16"
                className="text-line/40"
              />
              {/* Invested Slice */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="#285fe8"
                strokeWidth="16"
                strokeDasharray={`${investedStroke} ${circumference}`}
                strokeDashoffset="0"
                className="transition-all duration-500"
              />
              {/* Gains Slice */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="#1f8f5f"
                strokeWidth="16"
                strokeDasharray={`${gainsStroke} ${circumference}`}
                strokeDashoffset={-investedStroke}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="font-figures text-[16px] font-bold text-ink">{multiplier}x</span>
              <span className="text-[10px] text-muted uppercase">Return</span>
            </div>
          </div>

          <div className="mt-3 flex w-full justify-around text-[12px]">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-brand" />
              <span className="text-muted">Invested:</span>
              <span className="font-semibold text-ink">{investedPercent}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-ontime" />
              <span className="text-muted">Gains:</span>
              <span className="font-semibold text-ontime">{gainsPercent}%</span>
            </div>
          </div>
        </div>

        {/* Growth Timeline Chart */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-paper/40 p-4 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">Growth Trajectory Over Time</p>
            <div className="flex items-center gap-4 text-[12px]">
              <div className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-brand" />
                <span className="text-muted">Total Value</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 border-t-2 border-dashed border-muted" />
                <span className="text-muted">Total Invested</span>
              </div>
            </div>
          </div>

          <div className="relative mt-2 h-44 w-full">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              className="size-full overflow-visible"
            >
              {/* Subtle grid lines */}
              <line
                x1={padX}
                y1={getY(0)}
                x2={chartWidth - padX}
                y2={getY(0)}
                stroke="currentColor"
                className="text-line/60"
                strokeWidth="1"
              />
              <line
                x1={padX}
                y1={getY(maxVal / 2)}
                x2={chartWidth - padX}
                y2={getY(maxVal / 2)}
                stroke="currentColor"
                className="text-line/30"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <line
                x1={padX}
                y1={getY(maxVal)}
                x2={chartWidth - padX}
                y2={getY(maxVal)}
                stroke="currentColor"
                className="text-line/30"
                strokeWidth="1"
                strokeDasharray="4 4"
              />

              {/* Area under closing line */}
              <path d={areaPath} fill="url(#brandGradient)" opacity="0.15" />

              {/* Invested Line (dashed) */}
              <path
                d={investedPath}
                fill="none"
                stroke="#586779"
                strokeWidth="2"
                strokeDasharray="4 3"
              />

              {/* Closing / Value Line */}
              <path d={closingPath} fill="none" stroke="#285fe8" strokeWidth="2.5" />

              {/* Start & End Marker dots */}
              {points.length > 0 && (
                <>
                  <circle
                    cx={getX(0)}
                    cy={getY(parseFloat(points[0].closingBalance))}
                    r="4"
                    fill="#285fe8"
                  />
                  <circle
                    cx={getX(points.length - 1)}
                    cy={getY(parseFloat(points[points.length - 1].closingBalance))}
                    r="4"
                    fill="#285fe8"
                  />
                </>
              )}

              <defs>
                <linearGradient id="brandGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#285fe8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#285fe8" stopOpacity="0.0" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="flex justify-between text-[11px] text-muted">
            <span>Year 1</span>
            <span>Year {Math.round(result.durationYears / 2)}</span>
            <span>Year {result.durationYears} (Maturity)</span>
          </div>
        </div>
      </div>

      {/* Year-by-Year Breakdown Collapsible Table */}
      <div className="rounded-2xl border border-line bg-paper/50">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-left font-semibold text-ink transition-colors hover:bg-surface/50"
          aria-expanded={showTable}
        >
          <span className="flex items-center gap-2 text-[14px]">
            <TrendingUp size={16} className="text-brand" />
            Year-by-Year Growth Breakdown Schedule
          </span>
          <span className="flex items-center gap-1 text-[13px] text-muted">
            {showTable ? 'Hide Schedule' : 'Show Schedule'}
            {showTable ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {showTable && (
          <div className="border-t border-line/60 p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line text-[11px] font-semibold text-muted uppercase">
                  <tr>
                    <th className="py-2 pr-3">Year</th>
                    <th className="py-2 pr-3">Opening (₹)</th>
                    <th className="py-2 pr-3">Contributions (₹)</th>
                    <th className="py-2 pr-3">Growth / Returns (₹)</th>
                    <th className="py-2 pr-3">Closing Balance (₹)</th>
                    <th className="py-2 pr-3">Cumulative Invested (₹)</th>
                    <th className="py-2 pr-3">Cumulative Gain (₹)</th>
                    <th className="py-2">Real Purchasing Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {result.yearlyBreakdown.map((row) => (
                    <tr key={row.year} className="hover:bg-brand/5">
                      <td className="py-2.5 pr-3 font-semibold text-ink">Year {row.year}</td>
                      <td className="py-2.5 pr-3 font-figures">{formatMoney(row.openingBalance)}</td>
                      <td className="py-2.5 pr-3 font-figures">{formatMoney(row.contributions)}</td>
                      <td className="py-2.5 pr-3 font-figures font-medium text-ontime">
                        +{formatMoney(row.growthEarned)}
                      </td>
                      <td className="py-2.5 pr-3 font-figures font-bold text-ink">
                        {formatMoney(row.closingBalance)}
                      </td>
                      <td className="py-2.5 pr-3 font-figures text-muted">
                        {formatMoney(row.cumulativeInvested)}
                      </td>
                      <td className="py-2.5 pr-3 font-figures font-semibold text-ontime">
                        +{formatMoney(row.cumulativeGain)}
                      </td>
                      <td className="py-2.5 font-figures text-turmeric font-medium">
                        {formatMoney(row.inflationAdjustedValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Projection Disclaimer */}
      <p className="text-[12px] text-muted italic">
        * Projections are hypothetical estimates based on your entered assumptions and an assumed constant rate of return ({result.expectedReturnPercent}%). Returns in market-linked investments fluctuate and are not guaranteed. Tax liability is calculated according to the configured rule ({result.taxMethod === 'none' ? 'None' : result.taxMethod === 'flat' ? 'Flat rate' : 'LTCG threshold'}) and may vary based on future statutory tax law changes.
      </p>
    </div>
  )
}
