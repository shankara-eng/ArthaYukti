import { useCallback, useEffect, useState } from 'react'

export const ROUTES = [
  // Open to everyone
  'home',
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  // The step-by-step screens that also work without an account
  'money-in',
  'money-out',
  'dreams',
  'plan',
  'what-if',
  'fixes',
  'compare',
  'tradeoffs',
  // Signed-in application
  'onboarding',
  'dashboard',
  'profile',
  'finances',
  'goals',
  'trajectory',
  'rescue',
  'plan-b',
  'insurance',
  'debts',
  'equities',
  'calculators',
  'emergency',
  'outlook-household',
  'outlook-investment',
  'outlook-debt',
  'outlook-expenditure',
  'outlook-custom',
  'outlook-feasibility',
  'outlook-scenarios',
  'advisor',
  'alerts',
  'settings',
] as const

export type Route = (typeof ROUTES)[number]

/** Routes that only make sense for a signed-in person. */
export const PRIVATE_ROUTES: Route[] = [
  'onboarding',
  'dashboard',
  'profile',
  'finances',
  'goals',
  'trajectory',
  'rescue',
  'plan-b',
  'insurance',
  'debts',
  'equities',
  'calculators',
  'emergency',
  'outlook-household',
  'outlook-investment',
  'outlook-debt',
  'outlook-expenditure',
  'outlook-custom',
  'outlook-feasibility',
  'outlook-scenarios',
  'advisor',
  'alerts',
  'settings',
]

/** Pages that moved or were removed: an old bookmark lands on where its content lives now. */
const MOVED: Record<string, Route> = { assets: 'equities', import: 'finances', taxes: 'dashboard' }

export function parseRoute(hash: string): Route {
  // A query string (as in the reset link) is not part of the route name.
  const name = hash.replace(/^#\/?/, '').split('?')[0]
  if (name in MOVED) return MOVED[name]
  return ROUTES.find((route) => route === name) ?? 'home'
}

/** A tiny hash router: the back button works and no server setup is needed. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`
  }, [])

  return [route, navigate]
}
