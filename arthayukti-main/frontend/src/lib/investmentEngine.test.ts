import { describe, expect, it } from 'vitest'
import {
  calculateLumpSum,
  calculateSip,
  calculateTax,
  compileCalculators,
  createNewCalculator,
  defaultLumpSumInputs,
  defaultSipInputs,
  exportComparisonToCsv,
} from './investmentEngine'

describe('Investment Calculation Engine', () => {
  describe('Lump-Sum Compounding', () => {
    it('calculates annual compounding correctly: A = P(1+r)^t', () => {
      // 100,000 at 10% for 3 years annually -> 100000 * 1.10^3 = 133,100.00
      const res = calculateLumpSum({
        investmentName: 'Test Annual',
        initialAmount: '100000',
        expectedReturnPercent: '10.0',
        durationYears: '3',
        compoundingFrequency: 'annually',
        inflationRatePercent: '0',
        taxMethod: 'none',
        taxRatePercent: '0',
        taxExemptionAmount: '0',
      })
      expect(res.totalInvested).toBe('100000.00')
      expect(res.preTaxMaturityValue).toBe('133100.00')
      expect(res.estimatedGains).toBe('33100.00')
      expect(res.postTaxMaturityValue).toBe('133100.00')
      expect(res.yearlyBreakdown).toHaveLength(3)
      expect(res.yearlyBreakdown[0].closingBalance).toBe('110000.00')
      expect(res.yearlyBreakdown[1].closingBalance).toBe('121000.00')
      expect(res.yearlyBreakdown[2].closingBalance).toBe('133100.00')
    })

    it('calculates semi-annual, quarterly, and monthly compounding with higher yields', () => {
      // 100,000 at 12% for 1 year:
      // Annual: 100000 * (1 + 0.12) = 112,000.00
      // Semi-annual: 100000 * (1 + 0.06)^2 = 112,360.00
      // Quarterly: 100000 * (1 + 0.03)^4 = 112,550.88
      // Monthly: 100000 * (1 + 0.01)^12 = 112,682.50
      const semi = calculateLumpSum({
        ...defaultLumpSumInputs('0'),
        initialAmount: '100000',
        expectedReturnPercent: '12.0',
        durationYears: '1',
        compoundingFrequency: 'semi_annually',
      })
      expect(semi.preTaxMaturityValue).toBe('112360.00')

      const quarterly = calculateLumpSum({
        ...defaultLumpSumInputs('0'),
        initialAmount: '100000',
        expectedReturnPercent: '12.0',
        durationYears: '1',
        compoundingFrequency: 'quarterly',
      })
      expect(quarterly.preTaxMaturityValue).toBe('112550.88')

      const monthly = calculateLumpSum({
        ...defaultLumpSumInputs('0'),
        initialAmount: '100000',
        expectedReturnPercent: '12.0',
        durationYears: '1',
        compoundingFrequency: 'monthly',
      })
      expect(monthly.preTaxMaturityValue).toBe('112682.50')
    })

    it('handles 0% return and 0 principal gracefully', () => {
      const zeroReturn = calculateLumpSum({
        ...defaultLumpSumInputs('0'),
        initialAmount: '50000',
        expectedReturnPercent: '0',
        durationYears: '5',
      })
      expect(zeroReturn.preTaxMaturityValue).toBe('50000.00')
      expect(zeroReturn.estimatedGains).toBe('0.00')

      const zeroPrincipal = calculateLumpSum({
        ...defaultLumpSumInputs('0'),
        initialAmount: '0',
        expectedReturnPercent: '12',
        durationYears: '5',
      })
      expect(zeroPrincipal.preTaxMaturityValue).toBe('0.00')
    })
  })

  describe('SIP Simulation and Timing', () => {
    it('simulates monthly SIP annuity-due correctly', () => {
      // 5,000 monthly for 1 year at 12% (1% per month)
      // Month 1: (0 + 5000) * 1.01 = 5050
      // Month 2: (5050 + 5000) * 1.01 = 10150.50
      // 12 months sum of geometric series with monthly deposits
      const res = calculateSip({
        ...defaultSipInputs('0'),
        initialAmount: '0',
        recurringAmount: '5000',
        frequency: 'monthly',
        durationYears: '1',
        expectedReturnPercent: '12.0',
        stepUpMode: 'none',
      })
      expect(res.totalInvested).toBe('60000.00')
      // Calculated: 5000 * 1.01 * ((1.01^12 - 1) / 0.01) ~= 64,046.64
      expect(parseFloat(res.preTaxMaturityValue)).toBeCloseTo(64046.64, 0)
      expect(parseFloat(res.estimatedGains)).toBeGreaterThan(4000)
    })

    it('simulates SIP with initial lump-sum kick-off', () => {
      const withLump = calculateSip({
        ...defaultSipInputs('0'),
        initialAmount: '50000',
        recurringAmount: '5000',
        frequency: 'monthly',
        durationYears: '2',
        expectedReturnPercent: '10.0',
        stepUpMode: 'none',
      })
      expect(withLump.initialInvestment).toBe('50000.00')
      expect(withLump.totalRecurringContributions).toBe('120000.00')
      expect(withLump.totalInvested).toBe('170000.00')
    })

    it('applies percentage annual step-up from Year 2 onwards', () => {
      // Year 1: 10,000/mo = 120,000
      // Year 2: +10% -> 11,000/mo = 132,000
      // Total invested = 252,000
      const stepped = calculateSip({
        ...defaultSipInputs('0'),
        initialAmount: '0',
        recurringAmount: '10000',
        frequency: 'monthly',
        durationYears: '2',
        expectedReturnPercent: '12.0',
        stepUpMode: 'percent',
        stepUpValue: '10.0',
      })
      expect(stepped.totalInvested).toBe('252000.00')
      expect(stepped.yearlyBreakdown[0].contributions).toBe('120000.00')
      expect(stepped.yearlyBreakdown[1].contributions).toBe('132000.00')
    })

    it('applies fixed rupee amount step-up from Year 2 onwards', () => {
      // Year 1: 10,000/mo = 120,000
      // Year 2: +1,000 -> 11,000/mo = 132,000
      const fixedStep = calculateSip({
        ...defaultSipInputs('0'),
        initialAmount: '0',
        recurringAmount: '10000',
        frequency: 'monthly',
        durationYears: '2',
        expectedReturnPercent: '12.0',
        stepUpMode: 'amount',
        stepUpValue: '1000',
      })
      expect(fixedStep.totalInvested).toBe('252000.00')
      expect(fixedStep.yearlyBreakdown[1].contributions).toBe('132000.00')
    })
  })

  describe('Tax Calculation Models', () => {
    it('charges 0 tax under None method', () => {
      expect(calculateTax(500000, 'none', 12.5, 125000)).toBe(0)
    })

    it('charges flat tax on full gains under Flat method', () => {
      // 100,000 gains at 20% = 20,000
      expect(calculateTax(100000, 'flat', 20, 0)).toBe(20000)
    })

    it('applies exemption threshold under LTCG exemption method', () => {
      // Gains: 200,000. Exemption: 125,000. Taxable: 75,000 at 12.5% = 9,375.00
      expect(calculateTax(200000, 'ltcg_exemption', 12.5, 125000)).toBe(9375)

      // Gains <= Exemption -> 0 tax
      expect(calculateTax(100000, 'ltcg_exemption', 12.5, 125000)).toBe(0)
    })
  })

  describe('Inflation Adjustment', () => {
    it('defers real purchasing power by (1 + inflation)^years', () => {
      // Nominal: 200,000 at 6% inflation for 10 years -> 200,000 / (1.06^10) ~= 111,678.96
      const res = calculateLumpSum({
        ...defaultLumpSumInputs('6.0'),
        initialAmount: '100000',
        expectedReturnPercent: '7.177', // approximately doubles in 10 yrs
        durationYears: '10',
        compoundingFrequency: 'annually',
        inflationRatePercent: '6.0',
      })
      const nominal = parseFloat(res.postTaxMaturityValue)
      const real = parseFloat(res.inflationAdjustedMaturityValue)
      expect(real).toBeCloseTo(nominal / Math.pow(1.06, 10), 0)
    })
  })

  describe('Multi-Calculator Compilation and CSV', () => {
    it('compiles multiple calculators and sums aggregates accurately', () => {
      const calc1 = createNewCalculator(1, '6.0', 'lump_sum')
      calc1.result = calculateLumpSum(calc1.lumpSumInputs)
      calc1.isCalculated = true

      const calc2 = createNewCalculator(2, '6.0', 'sip')
      calc2.result = calculateSip(calc2.sipInputs)
      calc2.isCalculated = true

      const compiled = compileCalculators([calc1, calc2])
      expect(compiled.compiledCalculators).toHaveLength(2)
      expect(compiled.aggregate.validCalculatorCount).toBe(2)

      const expectedInvested = (
        parseFloat(calc1.result.totalInvested) + parseFloat(calc2.result.totalInvested)
      ).toFixed(2)
      expect(compiled.aggregate.combinedInvested).toBe(expectedInvested)

      const expectedGains = (
        parseFloat(calc1.result.estimatedGains) + parseFloat(calc2.result.estimatedGains)
      ).toFixed(2)
      expect(compiled.aggregate.combinedEstimatedGains).toBe(expectedGains)
    })

    it('generates compliant CSV with correct column headers and values', () => {
      const calc1 = createNewCalculator(1, '6.0', 'lump_sum')
      calc1.result = calculateLumpSum(calc1.lumpSumInputs)
      calc1.isCalculated = true

      const csv = exportComparisonToCsv([calc1])
      expect(csv).toContain('Calculator Name,Investment Name,Calculator Type')
      expect(csv).toContain('Calculator 1')
      expect(csv).toContain('Lump-Sum Calculator')
      expect(csv).toContain('100000.00')
    })
  })
})
