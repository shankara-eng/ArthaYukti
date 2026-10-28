import { describe, expect, it } from 'vitest'
import { blankForm, formIssues, minutesSince, signedPercent, toCreateBody, trimQuantity, validDate, validPrice, validQuantity, whenText } from './portfolio'

const valid = { ...blankForm(), symbol: 'reliance', quantity: '10', price: '1000.5', date: '2026-01-05' }

describe('validation mirrors the server', () => {
  it('accepts a normal holding', () => {
    expect(formIssues(valid)).toEqual([])
  })
  it('refuses a symbol that carries an exchange suffix or odd characters', () => {
    for (const symbol of ['', 'RELIANCE.NS', 'TCS.BO', 'has space', 'A;B', '-X', 'A'.repeat(21)]) expect(formIssues({ ...valid, symbol })).toContain('symbol')
    for (const symbol of ['tcs', 'M&M', 'BAJAJ-AUTO', 'A'.repeat(20)]) expect(formIssues({ ...valid, symbol })).not.toContain('symbol')
  })
  it('wants whole shares from 1 up to a billion', () => {
    expect(['1', '10', '1000000000', ' 5 '].map(validQuantity)).toEqual([true, true, true, true])
    expect(['', '0', '-1', '1.5', 'x', '1000000001', '01'].map(validQuantity)).toEqual([false, false, false, false, false, false, false])
  })
  it('wants a price above zero, up to four decimals, within the cap', () => {
    expect(['1', '0.5', '1000.1234', '10000000'].map(validPrice)).toEqual([true, true, true, true])
    expect(['', '0', '-5', '1.23456', 'abc', '10000001', '1e5', '.5'].map(validPrice)).toEqual([false, false, false, false, false, false, false, false])
  })
  it('wants a real calendar date between 1990 and today, or none', () => {
    expect(validDate('2026-01-05')).toBe(true)
    for (const bad of ['', '2026-13-01', '2026-02-30', '05/01/2026', '1989-12-31', '2999-01-01', 'yesterday']) expect(validDate(bad)).toBe(false)
    expect(formIssues({ ...valid, date: '' })).toEqual([]) // optional
    expect(formIssues({ ...valid, date: '2999-01-01' })).toEqual(['date'])
  })
  it('can skip the symbol and date checks, as the edit form does', () => {
    expect(formIssues({ ...blankForm(), quantity: '2', price: '3' }, { symbol: false, date: false })).toEqual([])
  })
})

describe('toCreateBody', () => {
  it('sends only what the person entered, with the symbol uppercased and no price from the browser', () => {
    expect(toCreateBody({ ...valid, symbol: ' reliance ', company: ' Reliance Industries ' })).toEqual({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      company_name: 'Reliance Industries',
      quantity: '10',
      average_price: '1000.5',
      purchase_date: '2026-01-05',
    })
    expect(toCreateBody({ ...valid, company: '', date: '' })).toEqual({ symbol: 'RELIANCE', exchange: 'NSE', quantity: '10', average_price: '1000.5' })
  })
})

describe('display helpers', () => {
  it('trims trailing zeros from a quantity', () => {
    expect([trimQuantity('10.000000'), trimQuantity('2.500000'), trimQuantity('7'), trimQuantity('100')]).toEqual(['10', '2.5', '7', '100'])
  })
  it('signs percentages and shows a dash for none', () => {
    expect([signedPercent('20.00'), signedPercent('-9.98'), signedPercent('0.00'), signedPercent(null), signedPercent(undefined)]).toEqual(['+20.00%', '-9.98%', '+0.00%', '–', '–'])
  })
  it('measures how old a server time is, and tolerates none', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')
    expect(minutesSince('2026-10-25T11:30:00Z', now)).toBe(30)
    expect(minutesSince('2026-10-25T13:00:00Z', now)).toBe(0) // never negative
    expect(minutesSince(null, now)).toBeNull()
    expect(minutesSince('garbage', now)).toBeNull()
  })
  it('writes a time in either language and nothing for a bad one', () => {
    expect(whenText('2026-10-25T12:00:00Z', 'en')).toMatch(/2026/)
    expect(whenText('2026-10-25T12:00:00Z', 'hi')).not.toBe('')
    expect(whenText('nope', 'en')).toBe('')
    expect(whenText(null, 'en')).toBe('')
  })
})
