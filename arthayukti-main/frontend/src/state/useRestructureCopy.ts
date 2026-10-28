import { restructureCopy, type RestructureCopy } from '../i18n/restructure'
import { useStore } from './useStore'

/** The words for the Insurance, Debts and Equities modules, Debts calculator, Emergency Funds, inflation setting and first-time guidance. */
export function useRestructureCopy(): RestructureCopy {
  return restructureCopy[useStore().language]
}
