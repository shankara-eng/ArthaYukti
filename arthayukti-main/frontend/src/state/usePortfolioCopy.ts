import { portfolioCopy, type PortfolioCopy } from '../i18n/portfolio'
import { useStore } from './useStore'

/** The words for the stock portfolio, in the chosen language. */
export function usePortfolioCopy(): PortfolioCopy {
  return portfolioCopy[useStore().language]
}
