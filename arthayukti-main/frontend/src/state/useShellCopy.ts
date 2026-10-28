import { shellCopy, type ShellCopy } from '../i18n/shell'
import { useStore } from './useStore'

/** The shell and sign-in words in the language the person chose. */
export function useShellCopy(): ShellCopy {
  return shellCopy[useStore().language]
}
