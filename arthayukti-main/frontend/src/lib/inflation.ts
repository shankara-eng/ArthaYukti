/** "0.065000" as the percentage a person types and reads: "6.5". Trailing zeros are dropped. */
export function rateToPercent(rate: string): string {
  const [whole, fraction = ''] = rate.split('.')
  // Rates are six-decimal strings; a percentage needs at most four decimals of that.
  const hundredths = fraction.padEnd(6, '0').slice(0, 4)
  const percentWhole = `${BigInt(whole) * 100n + BigInt(hundredths.slice(0, 2))}`
  const percentFraction = hundredths.slice(2).replace(/0+$/, '')
  return percentFraction ? `${percentWhole}.${percentFraction}` : percentWhole
}
