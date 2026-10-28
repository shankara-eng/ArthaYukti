// Amounts arrive from the API as decimal strings. The screens only display them, and the few
// sums they show are done in whole paise with BigInt, never through a float.

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const paise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const DECIMAL = /^-?\d+(\.\d+)?$/

export function formatMoney(amount: string, options: { paise?: boolean } = {}): string {
  if (!DECIMAL.test(amount)) {
    throw new Error(`Not a decimal amount: ${amount}`)
  }
  const formatter = options.paise ? paise : rupees
  // Intl formats decimal strings exactly, without converting through a float.
  return formatter.format(amount as `${number}`)
}

export function toPaise(amount: string): bigint {
  if (!DECIMAL.test(amount)) {
    throw new Error(`Not a decimal amount: ${amount}`)
  }
  const negative = amount.startsWith('-')
  const [whole, fraction = ''] = amount.replace('-', '').split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

export function fromPaise(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function addMoney(...amounts: string[]): string {
  return fromPaise(amounts.reduce((total, amount) => total + toPaise(amount), 0n))
}

export function subMoney(left: string, right: string): string {
  return fromPaise(toPaise(left) - toPaise(right))
}

export function mulMoney(amount: string, times: number): string {
  return fromPaise(toPaise(amount) * BigInt(times))
}

export function atLeastZero(amount: string): string {
  return toPaise(amount) < 0n ? '0.00' : amount
}

export function isZero(amount: string): boolean {
  return toPaise(amount) === 0n
}

export function isNegative(amount: string): boolean {
  return toPaise(amount) < 0n
}

export function isGreater(left: string, right: string): boolean {
  return toPaise(left) > toPaise(right)
}

/** Share of `part` in `whole` between 0 and 1. For drawing bars only, never for money. */
export function share(part: string, whole: string): number {
  const total = toPaise(whole)
  if (total <= 0n) return 0
  const value = Number((toPaise(part) * 10000n) / total) / 10000
  return Math.min(1, Math.max(0, value))
}

/** Turns what someone typed into a money string, or null when it is not a number. */
export function parseRupeeInput(text: string): string | null {
  const stripped = text.replace(/[₹,\s]/g, '')
  if (stripped === '') return '0.00'
  // A minus sign is refused, not dropped: "-500" must never become ₹500.
  if (stripped.includes('-')) return null
  // Amounts are whole rupees: anything after a decimal point is ignored, not read as more digits.
  const digits = stripped.split('.')[0].replace(/[^\d]/g, '')
  if (digits === '' || digits.length > 10) return stripped.startsWith('.') ? '0.00' : null
  return `${BigInt(digits)}.00`
}
