import type { Route } from '../lib/route'

export interface PageProps {
  navigate: (route: Route) => void
}
