import { trajectoryCopy, type TrajectoryCopy } from '../i18n/trajectory'
import { useStore } from './useStore'

/** The words for the Financial Trajectory tab, in the chosen language. */
export function useTrajectoryCopy(): TrajectoryCopy {
  return trajectoryCopy[useStore().language]
}
