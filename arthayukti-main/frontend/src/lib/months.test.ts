import { describe, expect, it } from 'vitest'
import { addMonths, monthLabel, monthLabelLong, monthRange, monthsBetween } from './months'

describe('months', () => {
  it('adds months across year ends', () => {
    expect(addMonths('2027-01', 11)).toBe('2027-12')
    expect(addMonths('2027-12', 1)).toBe('2028-01')
    expect(addMonths('2027-01', 0)).toBe('2027-01')
  })

  it('counts months between two dates', () => {
    expect(monthsBetween('2027-01', '2027-06')).toBe(5)
    expect(monthsBetween('2027-01', '2030-12')).toBe(47)
  })

  it('labels months in English and Hindi', () => {
    expect(monthLabel('2027-01', 'en')).toBe('Jan 2027')
    expect(monthLabel('2030-12', 'hi')).toBe('दिसं 2030')
    expect(monthLabelLong('2027-07', 'en')).toBe('July 2027')
    expect(monthLabelLong('2027-07', 'hi')).toBe('जुलाई 2027')
  })

  it('lists consecutive months', () => {
    expect(monthRange('2027-11', 3)).toEqual(['2027-11', '2027-12', '2028-01'])
  })

  it('rejects text that is not a month', () => {
    expect(() => monthLabel('2027-13', 'en')).toThrow()
  })
})
