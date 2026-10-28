import { useCallback, useState } from 'react'
import { ApiFailure } from '../api/client'

/** Runs a save, tracking whether it is in progress or failed, so a double click cannot save twice. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | Error | null>(null)
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setFailure(null)
    try {
      await action()
      return true
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error('failed'))
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, failure, run, clear: () => setFailure(null) }
}
