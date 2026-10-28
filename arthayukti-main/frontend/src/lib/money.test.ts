import { describe, expect, it } from 'vitest'
import {
  addMoney,
  atLeastZero,
  formatMoney,
  fromPaise,
  isGreater,
  isNegative,
  isZero,
  mulMoney,
  parseRupeeInput,
  share,
  subMoney,
  toPaise,
} from './money'

describe('formatMoney', () => {
  it('uses Indian digit grouping', () => {
    expect(formatMoney('100000000.00', { paise: true })).toBe('₹10,00,00,000.00')
  })

  it('shows paise when asked', () => {
    expect(formatMoney('112682.50', { paise: true })).toBe('₹1,12,682.50')
  })

  it('rounds to whole rupees by default', () => {
    expect(formatMoney('112682.50')).toBe('₹1,12,683')
  })

  it('formats zero and negative amounts', () => {
    expect(formatMoney('0')).toBe('₹0')
    expect(formatMoney('-91000.00')).toBe('-₹91,000')
  })

  it('does not lose precision on large values', () => {
    expect(formatMoney('9007199254740993.00', { paise: true })).toBe('₹9,00,71,99,25,47,40,993.00')
  })

  it('rejects non-decimal input', () => {
    expect(() => formatMoney('12abc')).toThrow()
    expect(() => formatMoney('1e5')).toThrow()
  })
})

describe('paise arithmetic', () => {
  it('converts both ways without drifting', () => {
    expect(toPaise('1250.50')).toBe(125050n)
    expect(toPaise('-0.05')).toBe(-5n)
    expect(fromPaise(125050n)).toBe('1250.50')
    expect(fromPaise(-5n)).toBe('-0.05')
  })

  it('adds and subtracts exactly', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30')
    expect(addMoney('55000.00', '20000.00', '9000.00', '15000.00')).toBe('99000.00')
    expect(subMoney('190000.00', '99000.00')).toBe('91000.00')
    expect(subMoney('0.00', '99000.00')).toBe('-99000.00')
  })

  it('multiplies by a whole number', () => {
    expect(mulMoney('99000.00', 6)).toBe('594000.00')
  })

  it('compares and clamps', () => {
    expect(atLeastZero('-5.00')).toBe('0.00')
    expect(atLeastZero('5.00')).toBe('5.00')
    expect(isZero('0.00')).toBe(true)
    expect(isNegative('-0.01')).toBe(true)
    expect(isGreater('10.00', '9.99')).toBe(true)
  })

  it('gives bar shares between 0 and 1', () => {
    expect(share('50.00', '100.00')).toBe(0.5)
    expect(share('150.00', '100.00')).toBe(1)
    expect(share('10.00', '0.00')).toBe(0)
  })
})

describe('parseRupeeInput', () => {
  it('keeps only the digits that were typed', () => {
    expect(parseRupeeInput('₹1,20,000')).toBe('120000.00')
    expect(parseRupeeInput('70000')).toBe('70000.00')
  })

  it('treats an emptied box as zero', () => {
    expect(parseRupeeInput('')).toBe('0.00')
    expect(parseRupeeInput('₹')).toBe('0.00')
  })

  it('ignores anything after a decimal point instead of reading it as more digits', () => {
    expect(parseRupeeInput('1500.50')).toBe('1500.00')
    expect(parseRupeeInput('₹2,00,000.99')).toBe('200000.00')
  })

  it('refuses text with no digits and absurd lengths', () => {
    expect(parseRupeeInput('abc')).toBeNull()
    expect(parseRupeeInput('-500')).toBeNull()
    expect(parseRupeeInput('₹-5,000')).toBeNull()
    expect(parseRupeeInput('123456789012')).toBeNull()
  })
})
