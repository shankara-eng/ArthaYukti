import { describe, expect, it } from 'vitest'
import { blankInvestment, buildConfig, draftFromConfig, percentToFraction, type CalculatorDraft, type InvestmentDraft } from './calculators'

const investment = (patch: Partial<InvestmentDraft> = {}): InvestmentDraft => ({
  ...blankInvestment('2027-01'),
  id: 'a',
  name: 'Fund A',
  recurring: false,
  lumpSum: '1,00,000',
  growthYears: '10',
  growthPercent: '12',
  ...patch,
})

const draft = (...items: InvestmentDraft[]): CalculatorDraft => ({ mode: 'individual', commonDate: '', investments: items })

describe('percentToFraction', () => {
  it.each([
    ['12', 0, 100, '0.120000'],
    ['12.5', 0, 100, '0.125000'],
    ['7.25', 0, 100, '0.072500'],
    ['0', 0, 100, '0.000000'],
    ['100', -100, 100, '1.000000'],
    ['-100', -100, 100, '-1.000000'],
    ['-0.5', -100, 100, '-0.005000'],
    ['  8 ', 0, 100, '0.080000'],
  ])('reads %s as %s', (text, min, max, expected) => {
    expect(percentToFraction(text, min, max)).toBe(expected)
  })

  it.each(['', 'abc', '12.345', '1e2', '12%', '--1', '.5', '5.'])('refuses %j', (text) => {
    expect(percentToFraction(text, -100, 100)).toBeNull()
  })

  it('refuses a value outside the allowed range', () => {
    expect(percentToFraction('100.01', 0, 100)).toBeNull()
    expect(percentToFraction('-100.01', -100, 100)).toBeNull()
    expect(percentToFraction('-1', 0, 100)).toBeNull()
  })
})

describe('buildConfig', () => {
  it('builds a lump-sum request with exact decimal strings', () => {
    const built = buildConfig(draft(investment()))
    expect(built.problems).toBeNull()
    expect(built.config).toEqual({
      mode: 'individual',
      investments: [
        { id: 'a', name: 'Fund A', start_month: '2027-01', lump_sum: '100000.00', growth_years: 10, annual_growth: '0.120000', tax_rate: '0.0000', tax_method: 'gains', rate_convention: 'nominal_monthly', inflation_rate: '0.000000' },
      ],
      compile_ids: ['a'],
    })
  })

  it('builds a recurring investment with step-ups, tax and inflation', () => {
    const built = buildConfig(
      draft(
        investment({
          lumpSum: '',
          recurring: true,
          amount: '10,000',
          frequency: 'quarterly',
          contributionYears: '5',
          taxPercent: '12.5',
          inflationPercent: '6',
          steps: [
            { id: 's2', fromYear: '3', mode: 'percent', value: '10' },
            { id: 's1', fromYear: '2', mode: 'amount', value: '15000' },
          ],
        }),
      ),
    )
    expect(built.config?.investments[0]).toMatchObject({
      lump_sum: '0.00',
      tax_rate: '0.1250',
      inflation_rate: '0.060000',
      sip: {
        amount: '10000.00',
        frequency: 'quarterly',
        contribution_years: 5,
        step_ups: [
          { from_year: 2, mode: 'amount', amount: '15000.00' },
          { from_year: 3, mode: 'percent', percent: '0.1000' },
        ],
      },
    })
  })

  it('sends the decision for a balance that matures before the common date', () => {
    const built = buildConfig({ ...draft(investment({ afterAction: 'reinvest', reinvestPercent: '6' })), mode: 'common_date', commonDate: '2040-12' })
    expect(built.config).toMatchObject({ mode: 'common_date', common_date: '2040-12' })
    expect(built.config?.investments[0].after_maturity).toEqual({ action: 'reinvest', rate: '0.060000' })
  })

  it('lists only the ticked investments for the compiled report', () => {
    const built = buildConfig(draft(investment(), investment({ id: 'b', name: 'B', include: false })))
    expect(built.config?.compile_ids).toEqual(['a'])
  })

  it('names each problem instead of sending a bad request', () => {
    const built = buildConfig(
      draft(
        investment({ name: ' ', growthYears: '61', growthPercent: '120', taxPercent: '101', inflationPercent: '-1', lumpSum: '' }),
        investment({ id: 'b', recurring: true, amount: '0', contributionYears: '20', growthYears: '10', steps: [{ id: 'x', fromYear: '1', mode: 'amount', value: '5' }] }),
      ),
    )
    expect(built.config).toBeNull()
    expect(built.problems).toMatchObject({
      'a.name': 'name',
      'a.growthYears': 'years',
      'a.growthPercent': 'percentGrowth',
      'a.taxPercent': 'percentTax',
      'a.inflationPercent': 'percentInflation',
      'a.lumpSum': 'needMoney',
      'b.amount': 'money',
      'b.contributionYears': 'contributionLonger',
      'b.step.x.fromYear': 'stepYear',
    })
  })

  it('rejects a repeated or out-of-range step-up year, a missing common date and a negative amount', () => {
    const repeat = buildConfig(
      draft(
        investment({
          recurring: true,
          amount: '1000',
          contributionYears: '4',
          growthYears: '4',
          steps: [
            { id: 'p', fromYear: '2', mode: 'amount', value: '2000' },
            { id: 'q', fromYear: '2', mode: 'amount', value: '3000' },
            { id: 'r', fromYear: '5', mode: 'amount', value: '4000' },
          ],
        }),
      ),
    )
    expect(repeat.problems).toMatchObject({ 'a.step.q.fromYear': 'stepYear', 'a.step.r.fromYear': 'stepYear' })
    expect(buildConfig({ ...draft(investment()), mode: 'common_date' }).problems).toMatchObject({ commonDate: 'commonDate' })
    expect(buildConfig(draft(investment({ lumpSum: '-500' }))).problems).toMatchObject({ 'a.lumpSum': 'money' })
  })

  it('refuses a reinvestment decision without a valid rate', () => {
    const built = buildConfig({ ...draft(investment({ afterAction: 'reinvest', reinvestPercent: '' })), mode: 'common_date', commonDate: '2040-12' })
    expect(built.problems).toMatchObject({ 'a.reinvestPercent': 'rate' })
  })
})

describe('draftFromConfig', () => {
  it('turns a saved request back into the same forms', () => {
    const original = draft(
      investment({
        lumpSum: '50000',
        recurring: true,
        amount: '2500',
        contributionYears: '4',
        growthYears: '8',
        growthPercent: '9.5',
        taxPercent: '10',
        steps: [{ id: 'z', fromYear: '3', mode: 'percent', value: '5' }],
        afterAction: 'hold',
      }),
    )
    const built = buildConfig(original)
    expect(built.config).not.toBeNull()
    const again = buildConfig(draftFromConfig(built.config!))
    expect(again.config).toEqual(built.config)
  })
})

describe('tax method and rate convention', () => {
  it('sends the chosen options and reads them back from a saved calculator', () => {
    const built = buildConfig(draft(investment({ taxPercent: '10', taxMethod: 'total_amount', rateConvention: 'effective_annual' })))
    expect(built.problems).toBeNull()
    expect(built.config?.investments[0]).toMatchObject({ tax_rate: '0.1000', tax_method: 'total_amount', rate_convention: 'effective_annual' })
    const back = draftFromConfig(built.config!)
    expect(back.investments[0]).toMatchObject({ taxMethod: 'total_amount', rateConvention: 'effective_annual' })
  })
  it('keeps the product defaults for a calculator saved before these options existed', () => {
    const built = buildConfig(draft(investment()))
    const old = { ...built.config!, investments: built.config!.investments.map(({ tax_method: _a, rate_convention: _b, ...rest }) => rest) }
    expect(draftFromConfig(old as never).investments[0]).toMatchObject({ taxMethod: 'gains', rateConvention: 'nominal_monthly' })
  })
})
