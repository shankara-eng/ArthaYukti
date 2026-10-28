import { planbCopy, type PlanBCopy } from '../i18n/planb'
import { useStore } from './useStore'

/** The words for Plan B, in the chosen language. */
export function usePlanBCopy(): PlanBCopy {
  return planbCopy[useStore().language]
}
