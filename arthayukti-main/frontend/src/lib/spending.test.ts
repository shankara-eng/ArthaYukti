import { describe, expect, it } from 'vitest'
import { blankChange, blankDraft, changeToInput, draftToInput, percentToRate, ratePercentText } from './spending'

describe('rates', () => {
  it('turns a typed percentage into the exact decimal string the server wants', () => {
    expect([percentToRate('6'), percentToRate('6.5'), percentToRate('0'), percentToRate('30'), percentToRate('12.3456')]).toEqual([
      '0.060000',
      '0.065000',
      '0.000000',
      '0.300000',
      '0.123456',
    ])
  })
  it('refuses a negative, too large or malformed rate', () => {
    for (const bad of ['', '-1', '30.0001', '31', 'abc', '6.12345', '1e2']) expect(percentToRate(bad)).toBeNull()
  })
  it('shows a stored rate as a percentage', () => {
    expect([ratePercentText('0.060000'), ratePercentText('0.065000'), ratePercentText('0.000000'), ratePercentText('0.123456')]).toEqual(['6%', '6.5%', '0%', '12.3456%'])
  })
})

describe('building a plan request', () => {
  const ready = { ...blankDraft(new Date(2026, 9, 25)), category: 'sys:housing', amount: '5000' }

  it('asks for what is missing instead of guessing', () => {
    expect(draftToInput(blankDraft())).toEqual({ problems: ['category', 'amount'] })
    expect(draftToInput({ ...ready, customRate: true, rate: '' })).toEqual({ problems: ['rate'] })
  })
  it('sends no dates for "from today", and an own-rate only when chosen', () => {
    const result = draftToInput(ready)
    expect(result).toEqual({
      body: { category: 'sys:housing', amount: '5000.00', frequency: 'monthly', duration: 'today_forever', inflation_override: null },
    })
  })
  it('sends months for a monthly range and years only for a yearly one', () => {
    const monthly = draftToInput({ ...ready, duration: 'range', startYear: '2028', startMonth: '3', endYear: '2030', endMonth: '8' })
    expect(monthly).toMatchObject({ body: { start_year: 2028, start_month: 3, end_year: 2030, end_month: 8 } })
    const yearly = draftToInput({ ...ready, frequency: 'yearly', duration: 'range', startYear: '2028', endYear: '2030', customRate: true, rate: '4' })
    expect('body' in yearly && yearly.body).toMatchObject({ start_year: 2028, end_year: 2030, inflation_override: '0.040000' })
    expect('body' in yearly && 'start_month' in yearly.body).toBe(false)
  })
})

describe('building a scheduled change', () => {
  it('needs an amount, and uses months only for a monthly plan', () => {
    const draft = { ...blankChange(new Date(2026, 9, 25)), amount: '12000', year: '2028', month: '1' }
    expect(changeToInput({ ...draft, amount: '' }, 'monthly')).toBeNull()
    expect(changeToInput(draft, 'monthly')).toEqual({ kind: 'permanent', effective_year: 2028, effective_month: 1, amount: '12000.00' })
    expect(changeToInput({ ...draft, kind: 'temporary', endYear: '2028', endMonth: '12' }, 'yearly')).toEqual({
      kind: 'temporary',
      effective_year: 2028,
      end_year: 2028,
      amount: '12000.00',
    })
  })
})
