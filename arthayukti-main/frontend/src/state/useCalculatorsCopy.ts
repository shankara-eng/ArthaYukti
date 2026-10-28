import { calculatorsCopy, type CalculatorsCopy } from '../i18n/calculators'
import { useStore } from './useStore'

/** The words for the investment calculators, in the chosen language. */
export function useCalculatorsCopy(): CalculatorsCopy {
  return calculatorsCopy[useStore().language]
}
