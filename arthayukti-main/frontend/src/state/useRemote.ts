import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFailure } from '../api/client'

export interface Remote<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** Asks again, for the same inputs. */
  reload: () => void
}

interface Answer<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** Runs a request whenever `key` changes and keeps the last answer on screen meanwhile. */
export function useRemote<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  delayMs = 0,
): Remote<T> {
  const [state, setState] = useState<Answer<T>>({ data: null, error: null, loading: key !== null })
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(load)

  // When there is nothing to request any more, drop the earlier answer so it cannot show
  // against a different plan. (Adjusting state while rendering is the sanctioned pattern.)
  const [previousKey, setPreviousKey] = useState(key)
  if (key !== previousKey) {
    setPreviousKey(key)
    if (key === null) setState({ data: null, error: null, loading: false })
  }

  useEffect(() => {
    loader.current = load
  })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, loading: true, error: null }))
      loader
        .current(controller.signal)
        .then((data) => setState({ data, error: null, loading: false }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          const code = error instanceof ApiFailure ? error.code : 'unknown'
          setState((previous) => ({ ...previous, loading: false, error: code }))
        })
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, delayMs, attempt])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  return { ...state, reload }
}
