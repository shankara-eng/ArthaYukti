import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFailure } from '../api/client'

export interface Keyed<T> {
  /** The answer for exactly the current key, or null: an answer for an earlier key is never handed back. */
  data: T | null
  error: string | null
  /** True from the moment the key changes until its own answer (or failure) arrives. */
  loading: boolean
  /** True when an earlier key's answer exists but is not this key's. */
  outdated: boolean
  reload: () => void
}

interface Answer<T> {
  key: string
  data: T | null
  error: string | null
}

/**
 * Like `useRemote`, but an answer carries the key it was asked for, so numbers worked out for old inputs can never be
 * shown while the new inputs are being calculated (not even during the short wait before the request goes out).
 */
export function useKeyedRemote<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, delayMs = 0): Keyed<T> {
  const [answer, setAnswer] = useState<Answer<T> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(load)

  useEffect(() => {
    loader.current = load
  })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      loader
        .current(controller.signal)
        .then((data) => setAnswer({ key, data, error: null }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setAnswer({ key, data: null, error: error instanceof ApiFailure ? error.code : 'unknown' })
        })
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, delayMs, attempt])

  const reload = useCallback(() => {
    setAnswer(null)
    setAttempt((current) => current + 1)
  }, [])
  const current = key !== null && answer !== null && answer.key === key ? answer : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: key !== null && current === null,
    outdated: key !== null && current === null && answer !== null && answer.data !== null,
    reload,
  }
}
