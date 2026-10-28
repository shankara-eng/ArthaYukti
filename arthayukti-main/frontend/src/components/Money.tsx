import { formatMoney } from '../lib/money'

/** An amount with its paise in a lighter tone, so the rupees read first. */
export function Money({ amount, className, tone = 'muted' }: { amount: string; className?: string; tone?: 'muted' | 'light' }) {
  const full = formatMoney(amount, { paise: true })
  const dot = full.lastIndexOf('.')
  if (dot < 0) return <span className={className}>{full}</span>
  return (
    <span className={className}>
      {full.slice(0, dot)}
      <span className={tone === 'light' ? 'text-white/60' : 'text-muted'}>{full.slice(dot)}</span>
    </span>
  )
}
