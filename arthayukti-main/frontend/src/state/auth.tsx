import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, setUnauthorizedHandler } from '../api/client'
import type { AuthResponse, UserProfile } from '../api/types'
import { AuthContext, type Auth, type AuthStatus } from './useAuth'

// The token (never the password) is kept for the life of this browser tab only, so a refresh
// does not sign the person out. It is cleared on logout, on expiry and when the tab closes.
const SESSION_KEY = 'arthayukti.session'

function readSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSession(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(SESSION_KEY, token)
    else window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // the session still works until the page is closed
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialToken] = useState(readSession)
  const [status, setStatus] = useState<AuthStatus>(initialToken ? 'checking' : 'anonymous')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [notice, setNotice] = useState<'expired' | null>(null)

  const end = useCallback((reason: 'expired' | null) => {
    setAccessToken(null)
    writeSession(null)
    setUser(null)
    setStatus('anonymous')
    setNotice(reason)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => end('expired'))
    return () => setUnauthorizedHandler(null)
  }, [end])

  // Restore a session from this tab, but only if the server still accepts the token.
  useEffect(() => {
    if (!initialToken) return
    setAccessToken(initialToken)
    const controller = new AbortController()
    api
      .me(controller.signal)
      .then((profile) => {
        setUser(profile)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        end(null)
      })
    return () => controller.abort()
  }, [initialToken, end])

  const begin = useCallback((response: AuthResponse) => {
    setAccessToken(response.access_token)
    writeSession(response.access_token)
    setUser(response.user)
    setNotice(null)
    setStatus('authenticated')
  }, [])

  const value: Auth = useMemo(
    () => ({
      status,
      user,
      notice,
      clearNotice: () => setNotice(null),
      login: async (email, password) => begin(await api.login(email, password)),
      signup: async (email, password, fullName) => begin(await api.signup(email, password, fullName)),
      logout: async () => {
        try {
          await api.logout()
        } catch {
          // the token is dropped here whether or not the server was reachable
        }
        end(null)
      },
    }),
    [status, user, notice, begin, end],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
