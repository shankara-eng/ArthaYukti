import { createContext, useContext } from 'react'
import type { UserProfile } from '../api/types'

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated'

export interface Auth {
  status: AuthStatus
  user: UserProfile | null
  /** Set when a signed-in request was refused, so the sign-in screen can say why. */
  notice: 'expired' | null
  clearNotice: () => void
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, fullName: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}
