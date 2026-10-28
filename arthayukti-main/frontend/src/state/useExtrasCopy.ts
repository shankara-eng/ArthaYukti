import { extrasCopy, type ExtrasCopy } from '../i18n/extras'
import { useStore } from './useStore'

/** The words for the rescue, price, cover-growth and ledger screens, in the chosen language. */
export function useExtrasCopy(): ExtrasCopy {
  return extrasCopy[useStore().language]
}
