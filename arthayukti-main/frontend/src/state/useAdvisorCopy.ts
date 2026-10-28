import { advisorCopy, type AdvisorCopy } from '../i18n/advisor'
import { useStore } from './useStore'

/** The words for the AI Financial Advisor, in the chosen language. */
export function useAdvisorCopy(): AdvisorCopy {
  return advisorCopy[useStore().language]
}
