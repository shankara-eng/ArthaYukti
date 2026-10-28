import type { FixOption } from '../api/types'
import type { Copy } from '../i18n/copy'
import { formatMoney } from './money'

/** The size of a fix in words: rupees, months or a percentage. */
export function fixAmount(text: Copy, option: FixOption): string {
  if (option.lever === 'extra_savings') return formatMoney(option.magnitude)
  if (option.lever === 'delay_goal') return text.fixes.delayTitle(Number(option.magnitude))
  return `${Number(option.magnitude)}%`
}

export function fixSummary(text: Copy, option: FixOption): string {
  return text.fixes.summary(option.lever, fixAmount(text, option))
}
