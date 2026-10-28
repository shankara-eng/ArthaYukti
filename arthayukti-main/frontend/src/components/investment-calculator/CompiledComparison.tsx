import { Download, Layers, TrendingUp } from 'lucide-react'
import {
  compileCalculators,
  exportComparisonToCsv,
  type IndividualCalculatorState,
} from '../../lib/investmentEngine'
import { formatMoney } from '../../lib/money'

interface CompiledComparisonProps {
  calculators: IndividualCalculatorState[]
}

const PALETTE = [
  '#285fe8', // brand blue
  '#1f8f5f', // emerald green
  '#b8893a', // gold / turmeric
  '#8b5cf6', // purple
  '#ec4899', // rose / pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
]

export function CompiledComparison({ calculators }: CompiledComparisonProps) {
  const { compiledCalculators, aggregate, timeline, maxDuration } = compileCalculators(calculators)

  if (compiledCalculators.length === 0) {
    return (
      <div className="rounded-3xl border border-line bg-paper/40 p-6 text-center text-muted">
        <Layers size={32} className="mx-auto mb-2 text-muted/60" />
        <p className="font-semibold text-ink">No Completed Calculations Yet</p>
        <p className="mt-1 text-[14px]">
          Configure and click <strong className="text-brand">Calculate</strong> on one or more calculators below, then view the consolidated comparison here.
        </p>
      </div>
    )
  }

  const handleExportCsv = () => {
    const csvContent = exportComparisonToCsv(compiledCalculators)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'arthayukti_investment_comparison.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  // Growth chart calculations
  const chartWidth = 600
  const chartHeight = 220
  const padX = 40
  const padY = 25
  const usableW = chartWidth - padX * 2
  const usableH = chartHeight - padY * 2

  let maxChartVal = 1
  for (const point of timeline) {
    for (const val of Object.values(point.values)) {
      if (val !== null && val > maxChartVal) maxChartVal = val
    }
  }

  const getX = (year: number) => padX + (year / Math.max(maxDuration, 1)) * usableW
  const getY = (val: number) => chartHeight - padY - (val / maxChartVal) * usableH

  return (
    <section
      id="compiled-comparison"
      aria-labelledby="compiled-comparison-title"
      className="glass flex flex-col gap-6 rounded-3xl p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="text-brand" size={22} />
            <h2 id="compiled-comparison-title" className="font-display text-[22px] font-bold tracking-tight text-ink">
              Consolidated Comparison & Portfolio View
            </h2>
          </div>
          <p className="mt-1 text-[14px] text-muted">
            Aggregated metrics and side-by-side comparison across {compiledCalculators.length} active investment calculator{compiledCalculators.length > 1 ? 's' : ''}.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[14px] font-semibold text-white shadow-xs transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Download size={16} />
          Export CSV Comparison
        </button>
      </div>

      {/* Aggregate Combined Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-paper/60 p-4">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Combined Invested</p>
          <p className="font-figures text-[22px] font-bold text-ink sm:text-[24px]">
            {formatMoney(aggregate.combinedInvested)}
          </p>
          <p className="mt-1 text-[11px] text-muted">Sum of all principals & SIP contributions</p>
        </div>

        <div className="rounded-2xl border border-line bg-paper/60 p-4">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Combined Estimated Gains</p>
          <p className="font-figures text-[22px] font-bold text-ontime sm:text-[24px]">
            +{formatMoney(aggregate.combinedEstimatedGains)}
          </p>
          <p className="mt-1 text-[11px] text-ontime/80">Total pre-tax wealth creation</p>
        </div>

        <div className="rounded-2xl border border-line bg-paper/60 p-4">
          <p className="text-[12px] font-medium text-muted uppercase tracking-wider">Combined Pre-Tax Maturity</p>
          <p className="font-figures text-[22px] font-bold text-ink sm:text-[24px]">
            {formatMoney(aggregate.combinedPreTaxMaturity)}
          </p>
          <p className="mt-1 text-[11px] text-muted">Nominal value across all durations</p>
        </div>

        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
          <p className="text-[12px] font-semibold text-brand uppercase tracking-wider">Combined Post-Tax Payout</p>
          <p className="font-figures text-[22px] font-bold text-brand sm:text-[24px]">
            {formatMoney(aggregate.combinedPostTaxMaturity)}
          </p>
          <p className="mt-1 text-[11px] text-brand/80">Net realization after taxes</p>
        </div>
      </div>

      {/* Important Disclaimer Note regarding Aggregation */}
      <div className="rounded-2xl border border-turmeric/30 bg-turmeric/10 p-3.5 text-[13px] text-ink">
        <strong className="font-semibold text-turmeric">Portfolio Note: </strong>
        These totals represent the mathematical sum of the compiled calculators. If your calculators represent alternative, mutually exclusive choices (for example, comparing a Lump-Sum versus a SIP of the same funds), treat these totals as scenario comparison baselines rather than a single combined portfolio.
      </div>

      {/* Consolidated Growth Comparison Chart */}
      <div className="rounded-2xl border border-line bg-paper/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-brand" />
            <span className="text-[14px] font-semibold text-ink">Projected Wealth Trajectories by Scenario</span>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            {compiledCalculators.map((c, i) => {
              const color = PALETTE[i % PALETTE.length]
              return (
                <div key={c.id} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-medium text-ink">
                    {c.name}: {c.result?.investmentName}
                  </span>
                  <span className="text-muted">({c.result?.durationYears}y)</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* SVG Multi-Line Chart */}
        <div className="relative mt-4 h-56 w-full">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="size-full overflow-visible"
          >
            {/* Grid lines */}
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
              y1={getY(maxChartVal / 2)}
              x2={chartWidth - padX}
              y2={getY(maxChartVal / 2)}
              stroke="currentColor"
              className="text-line/30"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <line
              x1={padX}
              y1={getY(maxChartVal)}
              x2={chartWidth - padX}
              y2={getY(maxChartVal)}
              stroke="currentColor"
              className="text-line/30"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            {/* Lines for each calculator */}
            {compiledCalculators.map((c, i) => {
              const color = PALETTE[i % PALETTE.length]
              // Extract valid points up to duration
              const pts = timeline
                .filter((p) => p.values[c.id] !== null && p.values[c.id] !== undefined)
                .map((p) => ({
                  x: getX(p.year),
                  y: getY(p.values[c.id]!),
                }))

              if (pts.length === 0) return null
              const pathD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

              return (
                <g key={c.id}>
                  <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" />
                  {/* Final maturity dot */}
                  <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={color} />
                </g>
              )
            })}
          </svg>
        </div>

        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span>Start (Year 0)</span>
          <span>Time Horizon: up to {maxDuration} Years (curves end at respective maturity)</span>
          <span>Year {maxDuration}</span>
        </div>
      </div>

      {/* Comprehensive Consolidated Comparison Table */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper/60">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line bg-surface/80 text-[11px] font-semibold text-muted uppercase">
            <tr>
              <th className="py-3 px-3">Calculator</th>
              <th className="py-3 px-3">Investment Name</th>
              <th className="py-3 px-3">Type</th>
              <th className="py-3 px-3">Initial (₹)</th>
              <th className="py-3 px-3">Recurring (₹)</th>
              <th className="py-3 px-3">Duration</th>
              <th className="py-3 px-3">Return</th>
              <th className="py-3 px-3">Step-Up</th>
              <th className="py-3 px-3">Total Invested (₹)</th>
              <th className="py-3 px-3">Pre-Tax Maturity (₹)</th>
              <th className="py-3 px-3">Tax (₹)</th>
              <th className="py-3 px-3">Post-Tax Value (₹)</th>
              <th className="py-3 px-3">Real Purchasing (₹)</th>
              <th className="py-3 px-3">Total Gains (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {compiledCalculators.map((c, i) => {
              const r = c.result!
              const isSip = r.calculatorType === 'sip'
              const color = PALETTE[i % PALETTE.length]

              return (
                <tr key={c.id} className="hover:bg-brand/5">
                  <td className="py-3 px-3 font-semibold text-ink">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                      <span>{c.name}</span>
                      {c.isOutdated && (
                        <span className="rounded-md bg-late/10 px-1.5 py-0.5 text-[10px] font-semibold text-late">
                          Outdated
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-medium text-ink">{r.investmentName}</td>
                  <td className="py-3 px-3">
                    <span className="rounded-lg bg-surface px-2 py-0.5 text-[11px] font-semibold text-brand">
                      {isSip ? 'SIP' : 'Lump-Sum'}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-figures">{formatMoney(r.initialInvestment)}</td>
                  <td className="py-3 px-3 font-figures">
                    {isSip ? `${formatMoney(c.sipInputs.recurringAmount)} / ${c.sipInputs.frequency}` : '—'}
                  </td>
                  <td className="py-3 px-3">{r.durationYears} yrs</td>
                  <td className="py-3 px-3">{r.expectedReturnPercent}%</td>
                  <td className="py-3 px-3 text-[12px]">{isSip ? r.stepUpSummary : '—'}</td>
                  <td className="py-3 px-3 font-figures font-medium text-ink">
                    {formatMoney(r.totalInvested)}
                  </td>
                  <td className="py-3 px-3 font-figures font-bold text-ink">
                    {formatMoney(r.preTaxMaturityValue)}
                  </td>
                  <td className="py-3 px-3 font-figures text-muted">
                    {parseFloat(r.estimatedTax) > 0 ? formatMoney(r.estimatedTax) : '₹0'}
                  </td>
                  <td className="py-3 px-3 font-figures font-bold text-brand">
                    {formatMoney(r.postTaxMaturityValue)}
                  </td>
                  <td className="py-3 px-3 font-figures font-medium text-turmeric">
                    {formatMoney(r.inflationAdjustedMaturityValue)}
                  </td>
                  <td className="py-3 px-3 font-figures font-bold text-ontime">
                    +{formatMoney(r.estimatedGains)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-line bg-surface/90 text-[12px] font-bold text-ink">
            <tr>
              <td colSpan={8} className="py-3 px-3 uppercase tracking-wider text-muted">
                Combined Aggregate Totals
              </td>
              <td className="py-3 px-3 font-figures">{formatMoney(aggregate.combinedInvested)}</td>
              <td className="py-3 px-3 font-figures">{formatMoney(aggregate.combinedPreTaxMaturity)}</td>
              <td className="py-3 px-3 font-figures text-muted">—</td>
              <td className="py-3 px-3 font-figures text-brand">{formatMoney(aggregate.combinedPostTaxMaturity)}</td>
              <td className="py-3 px-3 font-figures text-turmeric">—</td>
              <td className="py-3 px-3 font-figures text-ontime">+{formatMoney(aggregate.combinedEstimatedGains)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
