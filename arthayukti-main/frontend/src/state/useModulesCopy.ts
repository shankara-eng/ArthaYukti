import { modulesCopy, type ModulesCopy } from '../i18n/modules'
import { useStore } from './useStore'

/** The words for the signed-in pages, in the language the person chose. */
export function useModulesCopy(): ModulesCopy {
  return modulesCopy[useStore().language]
}
