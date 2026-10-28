/**
 * Investment Calculator Engine for ArthaYukti.
 *
 * Dedicated to exact mathematical evaluation of Lump-Sum and SIP investments,
 * year-by-year milestone schedules, tax models, inflation purchasing-power adjustments,
 * and multi-calculator consolidated comparisons.
 *
 * Mathematical conventions:
 * - Currency calculations use exact two-decimal precision (paise).
 * - Lump-sum compounding supports: Annual (1x), Semi-annual (2x), Quarterly (4x), Monthly (12x).
 * - SIP contributions occur at the beginning of each period (annuity due) and compound monthly.
 * - SIP Step-ups take effect at the start of each subsequent year (Year 2 onwards).
 * - Tax models supported:
 *     * None (0% tax)
 *     * Flat Tax on net gains
 *     * LTCG with Exemption (e.g. Indian Section 112A threshold: tax applied only on gains above exemption)
 * - Inflation adjustments reflect real purchasing power: Nominal / (1 + inflation)^years.
 */

export type CalculatorType = 'lump_sum' | 'sip'
export type CompoundingFrequency = 'annually' | 'semi_annually' | 'quarterly' | 'monthly'
export type SipFrequency = 'monthly' | 'quarterly' | 'annual'
export type StepUpMode = 'none' | 'percent' | 'amount'
export type TaxMethod = 'none' | 'flat' | 'ltcg_exemption'

export interface LumpSumInputs {
  investmentName: string
  initialAmount: string
  expectedReturnPercent: string
  durationYears: string
  compoundingFrequency: CompoundingFrequency
  inflationRatePercent: string
  taxMethod: TaxMethod
  taxRatePercent: string
  taxExemptionAmount: string
}

export interface SipInputs {
  investmentName: string
  initialAmount: string
  recurringAmount: string
  frequency: SipFrequency
  durationYears: string
  expectedReturnPercent: string
  stepUpMode: StepUpMode
  stepUpValue: string
  inflationRatePercent: string
  taxMethod: TaxMethod
  taxRatePercent: string
  taxExemptionAmount: string
}

export interface YearBreakdownRow {
  year: number
  openingBalance: string
  contributions: string
  growthEarned: string
  closingBalance: string
  cumulativeInvested: string
  cumulativeGain: string
  inflationAdjustedValue: string
}

export interface CalculationResult {
  calculatorType: CalculatorType
  investmentName: string
  initialInvestment: string
  totalRecurringContributions: string
  totalInvested: string
  estimatedGains: string
  preTaxMaturityValue: string
  estimatedTax: string
  taxMethod: TaxMethod
  taxRatePercent: string
  taxExemptionAmount: string
  postTaxMaturityValue: string
  inflationAdjustedMaturityValue: string
  durationYears: number
  expectedReturnPercent: string
  stepUpSummary: string
  compoundingSummary?: string
  yearlyBreakdown: YearBreakdownRow[]
  calculatedAt: string
}

export interface IndividualCalculatorState {
  id: string
  name: string
  isCustomName: boolean
  type: CalculatorType | null
  lumpSumInputs: LumpSumInputs
  sipInputs: SipInputs
  result: CalculationResult | null
  isCalculated: boolean
  isOutdated: boolean
  isCollapsed: boolean
}

export interface ConsolidatedAggregate {
  validCalculatorCount: number
  combinedInvested: string
  combinedPreTaxMaturity: string
  combinedPostTaxMaturity: string
  combinedEstimatedGains: string
}

export interface ConsolidatedTimelinePoint {
  year: number
  // calculatorId -> projected value at this year, or null if matured before this year
  values: Record<string, number | null>
}

// Decimal helper utilities
export function roundPaise(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100
}

export function toFixed2(num: number): string {
  return roundPaise(num).toFixed(2)
}

export function parseNum(val: string, fallback = 0): number {
  const clean = val.replace(/,/g, '').trim()
  const parsed = parseFloat(clean)
  return isNaN(parsed) ? fallback : parsed
}

export const COMPOUNDING_PERIODS: Record<CompoundingFrequency, number> = {
  annually: 1,
  semi_annually: 2,
  quarterly: 4,
  monthly: 12,
}

export const SIP_PERIODS_PER_YEAR: Record<SipFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  annual: 1,
}

export function defaultLumpSumInputs(defaultInflation = '6.0'): LumpSumInputs {
  return {
    investmentName: 'Lump-Sum Investment',
    initialAmount: '100000',
    expectedReturnPercent: '12.0',
    durationYears: '10',
    compoundingFrequency: 'annually',
    inflationRatePercent: defaultInflation,
    taxMethod: 'none',
    taxRatePercent: '12.5',
    taxExemptionAmount: '125000',
  }
}

export function defaultSipInputs(defaultInflation = '6.0'): SipInputs {
  return {
    investmentName: 'SIP Investment',
    initialAmount: '0',
    recurringAmount: '10000',
    frequency: 'monthly',
    durationYears: '10',
    expectedReturnPercent: '12.0',
    stepUpMode: 'none',
    stepUpValue: '10.0',
    inflationRatePercent: defaultInflation,
    taxMethod: 'none',
    taxRatePercent: '12.5',
    taxExemptionAmount: '125000',
  }
}

export function createNewCalculator(
  index: number,
  defaultInflation = '6.0',
  initialType: CalculatorType | null = null,
): IndividualCalculatorState {
  const id = `calc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    name: `Calculator ${index}`,
    isCustomName: false,
    type: initialType,
    lumpSumInputs: defaultLumpSumInputs(defaultInflation),
    sipInputs: defaultSipInputs(defaultInflation),
    result: null,
    isCalculated: false,
    isOutdated: false,
    isCollapsed: false,
  }
}

/**
 * Calculates tax on investment gains based on selected method.
 */
export function calculateTax(
  gains: number,
  method: TaxMethod,
  ratePercent: number,
  exemptionAmount: number,
): number {
  if (gains <= 0 || method === 'none' || ratePercent <= 0) {
    return 0
  }
  const taxRate = ratePercent / 100
  if (method === 'flat') {
    return roundPaise(gains * taxRate)
  }
  if (method === 'ltcg_exemption') {
    const taxableGains = Math.max(0, gains - exemptionAmount)
    return roundPaise(taxableGains * taxRate)
  }
  return 0
}

/**
 * Calculates Lump-Sum investment growth with exact compounding.
 */
export function calculateLumpSum(inputs: LumpSumInputs): CalculationResult {
  const P = Math.max(0, parseNum(inputs.initialAmount))
  const r = parseNum(inputs.expectedReturnPercent) / 100
  const T = Math.max(1, Math.min(60, Math.round(parseNum(inputs.durationYears, 1))))
  const n = COMPOUNDING_PERIODS[inputs.compoundingFrequency] || 1
  const inflationRate = Math.max(0, parseNum(inputs.inflationRatePercent)) / 100
  const taxRate = Math.max(0, parseNum(inputs.taxRatePercent))
  const exemption = Math.max(0, parseNum(inputs.taxExemptionAmount))

  const yearlyBreakdown: YearBreakdownRow[] = []
  let previousClosing = 0

  for (let y = 1; y <= T; y++) {
    const opening = y === 1 ? 0 : previousClosing
    const contributions = y === 1 ? P : 0
    // Compound formula: A = P * (1 + r/n)^(n*y)
    // If r <= -1, value drops to 0
    const factor = Math.max(0, 1 + r / n)
    const closing = roundPaise(P * Math.pow(factor, n * y))
    const growth = roundPaise(closing - opening - contributions)
    const cumulativeInvested = P
    const cumulativeGain = roundPaise(closing - cumulativeInvested)
    const deflator = Math.pow(1 + inflationRate, y)
    const inflationAdjusted = roundPaise(closing / (deflator > 0 ? deflator : 1))

    yearlyBreakdown.push({
      year: y,
      openingBalance: toFixed2(opening),
      contributions: toFixed2(contributions),
      growthEarned: toFixed2(growth),
      closingBalance: toFixed2(closing),
      cumulativeInvested: toFixed2(cumulativeInvested),
      cumulativeGain: toFixed2(cumulativeGain),
      inflationAdjustedValue: toFixed2(inflationAdjusted),
    })

    previousClosing = closing
  }

  const preTaxMaturity = previousClosing
  const totalInvested = P
  const estimatedGains = Math.max(0, roundPaise(preTaxMaturity - totalInvested))
  const tax = calculateTax(estimatedGains, inputs.taxMethod, taxRate, exemption)
  const postTaxMaturity = roundPaise(preTaxMaturity - tax)
  const totalDeflator = Math.pow(1 + inflationRate, T)
  const inflationAdjustedMaturity = roundPaise(postTaxMaturity / (totalDeflator > 0 ? totalDeflator : 1))

  const frequencyLabels: Record<CompoundingFrequency, string> = {
    annually: 'Compounded Annually',
    semi_annually: 'Compounded Semi-Annually',
    quarterly: 'Compounded Quarterly',
    monthly: 'Compounded Monthly',
  }

  return {
    calculatorType: 'lump_sum',
    investmentName: inputs.investmentName.trim() || 'Lump-Sum Investment',
    initialInvestment: toFixed2(P),
    totalRecurringContributions: '0.00',
    totalInvested: toFixed2(totalInvested),
    estimatedGains: toFixed2(estimatedGains),
    preTaxMaturityValue: toFixed2(preTaxMaturity),
    estimatedTax: toFixed2(tax),
    taxMethod: inputs.taxMethod,
    taxRatePercent: toFixed2(taxRate),
    taxExemptionAmount: toFixed2(exemption),
    postTaxMaturityValue: toFixed2(postTaxMaturity),
    inflationAdjustedMaturityValue: toFixed2(inflationAdjustedMaturity),
    durationYears: T,
    expectedReturnPercent: toFixed2(r * 100),
    stepUpSummary: 'Not applicable',
    compoundingSummary: frequencyLabels[inputs.compoundingFrequency] || 'Compounded Annually',
    yearlyBreakdown,
    calculatedAt: new Date().toISOString(),
  }
}

/**
 * Calculates SIP investment growth with actual contribution timing and periodic step-ups.
 * Timing convention: Contributions occur at the beginning of each installment period (annuity due)
 * and compound monthly through the duration.
 */
export function calculateSip(inputs: SipInputs): CalculationResult {
  const initialLump = Math.max(0, parseNum(inputs.initialAmount))
  const startingContribution = Math.max(0, parseNum(inputs.recurringAmount))
  const r = parseNum(inputs.expectedReturnPercent) / 100
  const T = Math.max(1, Math.min(60, Math.round(parseNum(inputs.durationYears, 1))))
  const freq = inputs.frequency || 'monthly'
  const periodsPerYear = SIP_PERIODS_PER_YEAR[freq]
  const monthsPerPeriod = 12 / periodsPerYear

  const inflationRate = Math.max(0, parseNum(inputs.inflationRatePercent)) / 100
  const taxRate = Math.max(0, parseNum(inputs.taxRatePercent))
  const exemption = Math.max(0, parseNum(inputs.taxExemptionAmount))

  const stepUpMode = inputs.stepUpMode
  const stepUpVal = Math.max(0, parseNum(inputs.stepUpValue))

  let currentInstallment = startingContribution
  let balance = initialLump
  let totalInvested = initialLump
  let totalRecurring = 0
  const yearlyBreakdown: YearBreakdownRow[] = []

  const monthlyRate = r / 12

  for (let y = 1; y <= T; y++) {
    // Step-up applied at the start of each year after Year 1
    if (y > 1) {
      if (stepUpMode === 'percent') {
        currentInstallment = roundPaise(currentInstallment * (1 + stepUpVal / 100))
      } else if (stepUpMode === 'amount') {
        currentInstallment = roundPaise(currentInstallment + stepUpVal)
      }
    }

    const yearOpening = balance
    let yearContributions = y === 1 ? initialLump : 0

    // Simulate 12 months for this year
    for (let m = 1; m <= 12; m++) {
      // Check if contribution occurs this month (e.g. monthly: all months, quarterly: m=1,4,7,10, annual: m=1)
      const isContributionMonth = (m - 1) % monthsPerPeriod === 0
      if (isContributionMonth) {
        balance += currentInstallment
        totalInvested += currentInstallment
        totalRecurring += currentInstallment
        yearContributions += currentInstallment
      }

      // Compound interest for the month
      balance = roundPaise(balance * (1 + monthlyRate))
    }

    const yearClosing = balance
    const yearGrowth = roundPaise(yearClosing - yearOpening - yearContributions)
    const cumulativeGain = roundPaise(yearClosing - totalInvested)
    const deflator = Math.pow(1 + inflationRate, y)
    const inflationAdjusted = roundPaise(yearClosing / (deflator > 0 ? deflator : 1))

    yearlyBreakdown.push({
      year: y,
      openingBalance: toFixed2(yearOpening),
      contributions: toFixed2(yearContributions),
      growthEarned: toFixed2(yearGrowth),
      closingBalance: toFixed2(yearClosing),
      cumulativeInvested: toFixed2(totalInvested),
      cumulativeGain: toFixed2(cumulativeGain),
      inflationAdjustedValue: toFixed2(inflationAdjusted),
    })
  }

  const preTaxMaturity = balance
  const estimatedGains = Math.max(0, roundPaise(preTaxMaturity - totalInvested))
  const tax = calculateTax(estimatedGains, inputs.taxMethod, taxRate, exemption)
  const postTaxMaturity = roundPaise(preTaxMaturity - tax)
  const totalDeflator = Math.pow(1 + inflationRate, T)
  const inflationAdjustedMaturity = roundPaise(postTaxMaturity / (totalDeflator > 0 ? totalDeflator : 1))

  let stepUpSummary = 'None (Fixed SIP)'
  if (stepUpMode === 'percent') {
    stepUpSummary = `+${stepUpVal}% annually`
  } else if (stepUpMode === 'amount') {
    stepUpSummary = `+₹${stepUpVal.toLocaleString('en-IN')} annually`
  }

  return {
    calculatorType: 'sip',
    investmentName: inputs.investmentName.trim() || 'SIP Investment',
    initialInvestment: toFixed2(initialLump),
    totalRecurringContributions: toFixed2(totalRecurring),
    totalInvested: toFixed2(totalInvested),
    estimatedGains: toFixed2(estimatedGains),
    preTaxMaturityValue: toFixed2(preTaxMaturity),
    estimatedTax: toFixed2(tax),
    taxMethod: inputs.taxMethod,
    taxRatePercent: toFixed2(taxRate),
    taxExemptionAmount: toFixed2(exemption),
    postTaxMaturityValue: toFixed2(postTaxMaturity),
    inflationAdjustedMaturityValue: toFixed2(inflationAdjustedMaturity),
    durationYears: T,
    expectedReturnPercent: toFixed2(r * 100),
    stepUpSummary,
    yearlyBreakdown,
    calculatedAt: new Date().toISOString(),
  }
}

/**
 * Compiles all valid, configured calculators into consolidated comparison totals and timeline.
 */
export function compileCalculators(calculators: IndividualCalculatorState[]): {
  compiledCalculators: IndividualCalculatorState[]
  aggregate: ConsolidatedAggregate
  timeline: ConsolidatedTimelinePoint[]
  maxDuration: number
} {
  const valid = calculators.filter((c) => c.result !== null && c.isCalculated)

  let sumInvested = 0
  let sumPreTax = 0
  let sumPostTax = 0
  let sumGains = 0
  let maxDuration = 0

  for (const c of valid) {
    if (!c.result) continue
    sumInvested += parseNum(c.result.totalInvested)
    sumPreTax += parseNum(c.result.preTaxMaturityValue)
    sumPostTax += parseNum(c.result.postTaxMaturityValue)
    sumGains += parseNum(c.result.estimatedGains)
    if (c.result.durationYears > maxDuration) {
      maxDuration = c.result.durationYears
    }
  }

  // Build timeline up to maxDuration
  const timeline: ConsolidatedTimelinePoint[] = []
  for (let y = 0; y <= maxDuration; y++) {
    const pointValues: Record<string, number | null> = {}
    for (const c of valid) {
      if (!c.result) continue
      if (y === 0) {
        // At Year 0: initial investment
        pointValues[c.id] = parseNum(c.result.initialInvestment)
      } else if (y <= c.result.durationYears) {
        // Find breakdown row for year y
        const row = c.result.yearlyBreakdown.find((r) => r.year === y)
        pointValues[c.id] = row ? parseNum(row.closingBalance) : null
      } else {
        // Investment has matured; do not silently extend growth
        pointValues[c.id] = null
      }
    }
    timeline.push({ year: y, values: pointValues })
  }

  return {
    compiledCalculators: valid,
    aggregate: {
      validCalculatorCount: valid.length,
      combinedInvested: toFixed2(sumInvested),
      combinedPreTaxMaturity: toFixed2(sumPreTax),
      combinedPostTaxMaturity: toFixed2(sumPostTax),
      combinedEstimatedGains: toFixed2(sumGains),
    },
    timeline,
    maxDuration,
  }
}

/**
 * Formats compiled calculators into a clean, RFC-4180 compliant CSV string.
 */
export function exportComparisonToCsv(calculators: IndividualCalculatorState[]): string {
  const headers = [
    'Calculator Name',
    'Investment Name',
    'Calculator Type',
    'Initial Investment (INR)',
    'Recurring Contribution (INR)',
    'Contribution Frequency',
    'Expected Return (%)',
    'Duration (Years)',
    'Annual SIP Step-Up',
    'Total Amount Invested (INR)',
    'Pre-Tax Maturity Value (INR)',
    'Tax Method',
    'Applicable Tax Rate (%)',
    'Tax Exemption (INR)',
    'Estimated Tax (INR)',
    'Post-Tax Maturity Value (INR)',
    'Inflation-Adjusted Maturity Value (INR)',
    'Total Estimated Gains (INR)',
  ]

  const rows: string[][] = []

  for (const c of calculators) {
    if (!c.result || !c.isCalculated) continue
    const r = c.result
    const isSip = r.calculatorType === 'sip'

    rows.push([
      c.name,
      r.investmentName,
      isSip ? 'SIP Calculator' : 'Lump-Sum Calculator',
      r.initialInvestment,
      isSip ? c.sipInputs.recurringAmount : 'Not applicable',
      isSip ? c.sipInputs.frequency : 'Not applicable',
      r.expectedReturnPercent,
      r.durationYears.toString(),
      isSip ? r.stepUpSummary : 'Not applicable',
      r.totalInvested,
      r.preTaxMaturityValue,
      r.taxMethod === 'none' ? 'None (0%)' : r.taxMethod === 'flat' ? 'Flat Tax' : 'LTCG with Exemption',
      r.taxRatePercent,
      r.taxExemptionAmount,
      r.estimatedTax,
      r.postTaxMaturityValue,
      r.inflationAdjustedMaturityValue,
      r.estimatedGains,
    ])
  }

  const escapeCsv = (str: string) => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  return [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\r\n')
}
