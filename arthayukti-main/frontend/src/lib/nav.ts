import { Bell, Bot, Calculator, ChartLine, Gauge, HandCoins, House, Landmark, LifeBuoy, PiggyBank, Settings, ShieldCheck, Target, TrendingUp, Users, Waypoints, type LucideIcon } from 'lucide-react'
import type { ShellCopy } from '../i18n/shell'
import type { Route } from './route'

export interface NavItem {
  route: Route
  key: keyof Omit<ShellCopy['nav'], 'label' | 'outlookItems' | 'outlook'>
  icon: LucideIcon
  /** Other routes that belong to this item, so it stays highlighted on them. */
  covers: Route[]
}

export const NAV_BEFORE_OUTLOOK: NavItem[] = [
  { route: 'dashboard', key: 'dashboard', icon: Gauge, covers: [] },
  { route: 'profile', key: 'profile', icon: Users, covers: [] },
  { route: 'finances', key: 'finances', icon: HandCoins, covers: ['money-in', 'money-out'] },
  { route: 'insurance', key: 'insurance', icon: ShieldCheck, covers: [] },
  { route: 'debts', key: 'debts', icon: Landmark, covers: [] },
  { route: 'equities', key: 'equities', icon: TrendingUp, covers: [] },
  { route: 'calculators', key: 'calculators', icon: Calculator, covers: [] },
  { route: 'emergency', key: 'emergency', icon: PiggyBank, covers: [] },
  { route: 'goals', key: 'goals', icon: Target, covers: ['dreams', 'plan', 'what-if', 'fixes', 'compare', 'tradeoffs'] },
  { route: 'trajectory', key: 'trajectory', icon: Waypoints, covers: [] },
]

export const OUTLOOK_ITEMS: { route: Route; key: keyof ShellCopy['nav']['outlookItems'] }[] = [
  { route: 'outlook-household', key: 'household' },
  { route: 'outlook-investment', key: 'investment' },
  { route: 'outlook-debt', key: 'debt' },
  { route: 'outlook-expenditure', key: 'expenditure' },
  { route: 'outlook-custom', key: 'custom' },
  { route: 'outlook-feasibility', key: 'feasibility' },
  { route: 'outlook-scenarios', key: 'scenarios' },
]

export const OUTLOOK_ICON = ChartLine

export const NAV_AFTER_OUTLOOK: NavItem[] = [
  { route: 'plan-b', key: 'planb', icon: LifeBuoy, covers: ['rescue'] },
  { route: 'advisor', key: 'advisor', icon: Bot, covers: [] },
  { route: 'alerts', key: 'alerts', icon: Bell, covers: [] },
  { route: 'settings', key: 'settings', icon: Settings, covers: [] },
]

export const HOME_ICON = House

/** The heading shown for a route inside the application. */
export function titleFor(route: Route, nav: ShellCopy['nav']): string {
  const direct = [...NAV_BEFORE_OUTLOOK, ...NAV_AFTER_OUTLOOK].find(
    (item) => item.route === route || item.covers.includes(route),
  )
  if (direct) return nav[direct.key]
  const outlook = OUTLOOK_ITEMS.find((item) => item.route === route)
  if (outlook) return nav.outlookItems[outlook.key]
  return nav.dashboard
}
