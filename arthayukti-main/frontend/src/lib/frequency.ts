import { fromPaise, toPaise } from './money'

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export const FREQUENCIES: Frequency[] = ['monthly', 'weekly', 'fortnightly', 'quarterly', 'half_yearly', 'yearly']

const PER_YEAR: Record<Frequency, bigint> = {
  weekly: 52n,
  fortnightly: 26n,
  monthly: 12n,
  quarterly: 4n,
  half_yearly: 2n,
  yearly: 1n,
}

/**
 * What an amount paid at some interval comes to in an average month, in whole paise and rounded
 * half-up. This only turns what someone typed into the monthly figure the planning engine takes.
 */
export function monthlyEquivalent(amount: string, frequency: Frequency): string {
  const paise = toPaise(amount)
  return fromPaise((paise * PER_YEAR[frequency] + 6n) / 12n)
}
