import { Armchair, GraduationCap, Home, PiggyBank, ShieldCheck, Target, type LucideIcon } from 'lucide-react'
import type { Goal } from '../api/types'

const GOAL_ICONS: Record<string, LucideIcon> = {
  emergency_fund: ShieldCheck,
  home: Home,
  education: GraduationCap,
  retirement: Armchair,
  loan_payoff: PiggyBank,
}

export function goalIcon(goal: Pick<Goal, 'type'>): LucideIcon {
  return GOAL_ICONS[goal.type] ?? Target
}
