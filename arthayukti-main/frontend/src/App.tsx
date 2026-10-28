import { useEffect, type ReactNode } from 'react'
import { Layout } from './components/Layout'
import { Card, CardTitle, PageHeading } from './components/Cards'
import { PrimaryButton } from './components/Controls'
import { ErrorNote, LoadingNote } from './components/Status'
import { titleFor } from './lib/nav'
import { hasGoals } from './lib/blank'
import { PRIVATE_ROUTES, useRoute, type Route } from './lib/route'
import { AuthProvider } from './state/auth'
import { useAuth } from './state/useAuth'
import { useShellCopy } from './state/useShellCopy'
import { ForgotPasswordPage, LoginPage, SignupPage } from './pages/AuthPages'
import { ComparePage } from './pages/Compare'
import { FixesPage } from './pages/Fixes'
import { Home } from './pages/Home'
import { OnboardingPage } from './pages/Onboarding'
import { PlanPage } from './pages/Plan'
import { ResetPasswordPage } from './pages/ResetPassword'
import { Dreams, MoneyIn, MoneyOut } from './pages/Setup'
import { TradeoffsPage } from './pages/Tradeoffs'
import { WhatIfPage } from './pages/WhatIf'
import { DashboardPage } from './pages/app/Dashboard'
import {
  CustomTrajectoryPage,
  DebtTrajectoryPage,
  ExpenditureTrajectoryPage,
  GoalFeasibilityPage,
  HouseholdTrajectoryPage,
  InvestmentTrajectoryPage,
  ScenarioComparisonPage,
} from './pages/app/Outlook'
import { DebtsModule, EquitiesModule, InsuranceModule } from './pages/app/CalcHub'
import { InvestmentCalculatorPage } from './pages/app/InvestmentCalculatorPage'
import { TrajectoryPage } from './pages/app/Trajectory'
import { EmergencyPage } from './pages/app/Emergency'
import { PlanBPage } from './pages/app/PlanB'
import { RescuePage } from './pages/app/Rescue'
import { AdvisorPage } from './pages/app/Advisor'
import { AlertsPage, FinancesPage, GoalsPage, ProfilePage, SettingsPage } from './pages/app/Tools'
import type { PageProps } from './pages/types'
import { StoreProvider } from './state/store'
import { useStore } from './state/useStore'

const NEEDS_GOALS: Route[] = ['plan', 'what-if', 'fixes', 'compare', 'tradeoffs']
const SIGNED_OUT_ONLY: Route[] = ['home', 'login', 'signup', 'forgot-password']

/** A page inside the signed-in workspace: the shell supplies the visible title, this the heading for screen readers. */
function AppPage({ route, navigate, children }: { route: Route; navigate: PageProps['navigate']; children: ReactNode }) {
  const nav = useShellCopy().nav
  const title = titleFor(route, nav)
  return (
    <Layout route={route} navigate={navigate} speak={title}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </Layout>
  )
}

function FullPageNote({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-cream p-6">{children}</div>
}

function Screens() {
  const [route, navigate] = useRoute()
  const auth = useAuth()
  const { plan, text, accountState } = useStore()

  useEffect(() => {
    if (auth.status === 'anonymous' && PRIVATE_ROUTES.includes(route)) navigate('login')
    if (auth.status === 'authenticated' && accountState === 'ready' && SIGNED_OUT_ONLY.includes(route)) {
      // Straight to the homepage: nothing has to be entered first. Guided setup stays available from there.
      navigate('dashboard')
    }
  }, [auth.status, accountState, route, navigate])

  // The reset link works without a plan: it comes from an e-mail.
  if (route === 'reset-password') return <ResetPasswordPage navigate={navigate} />

  if (auth.status === 'checking') {
    return (
      <FullPageNote>
        <LoadingNote />
      </FullPageNote>
    )
  }

  if (auth.status === 'anonymous') {
    if (route === 'login' || PRIVATE_ROUTES.includes(route)) return <LoginPage navigate={navigate} />
    if (route === 'signup') return <SignupPage navigate={navigate} />
    if (route === 'forgot-password') return <ForgotPasswordPage navigate={navigate} />
    // Without an account, nothing is shown until the person starts their own plan or opens the labelled example.
    if (!plan) return <Home navigate={navigate} />
    return <PlanScreens route={route} navigate={navigate} />
  }

  // Signed in from here on.
  if (accountState === 'error') {
    return (
      <FullPageNote>
        <ErrorNote />
      </FullPageNote>
    )
  }
  if (accountState !== 'ready') {
    return (
      <FullPageNote>
        <LoadingNote />
      </FullPageNote>
    )
  }
  if (SIGNED_OUT_ONLY.includes(route)) return null // the redirect above is on its way
  if (route === 'onboarding') return <OnboardingPage navigate={navigate} />

  switch (route) {
    case 'dashboard':
      return <AppPage route={route} navigate={navigate}><DashboardPage navigate={navigate} /></AppPage>
    case 'profile':
      return <AppPage route={route} navigate={navigate}><ProfilePage navigate={navigate} /></AppPage>
    case 'finances':
      return <AppPage route={route} navigate={navigate}><FinancesPage /></AppPage>
    case 'goals':
      return <AppPage route={route} navigate={navigate}><GoalsPage navigate={navigate} /></AppPage>
    case 'insurance':
      return <AppPage route={route} navigate={navigate}><InsuranceModule /></AppPage>
    case 'debts':
      return <AppPage route={route} navigate={navigate}><DebtsModule /></AppPage>
    case 'equities':
      return <AppPage route={route} navigate={navigate}><EquitiesModule /></AppPage>
    case 'calculators':
      return <AppPage route={route} navigate={navigate}><InvestmentCalculatorPage /></AppPage>
    case 'trajectory':
      return <AppPage route={route} navigate={navigate}><TrajectoryPage /></AppPage>
    case 'emergency':
      return <AppPage route={route} navigate={navigate}><EmergencyPage /></AppPage>
    case 'outlook-household':
      return <AppPage route={route} navigate={navigate}><HouseholdTrajectoryPage /></AppPage>
    case 'outlook-investment':
      return <AppPage route={route} navigate={navigate}><InvestmentTrajectoryPage /></AppPage>
    case 'outlook-debt':
      return <AppPage route={route} navigate={navigate}><DebtTrajectoryPage /></AppPage>
    case 'outlook-expenditure':
      return <AppPage route={route} navigate={navigate}><ExpenditureTrajectoryPage /></AppPage>
    case 'outlook-custom':
      return <AppPage route={route} navigate={navigate}><CustomTrajectoryPage /></AppPage>
    case 'outlook-feasibility':
      return <AppPage route={route} navigate={navigate}><GoalFeasibilityPage /></AppPage>
    case 'outlook-scenarios':
      return <AppPage route={route} navigate={navigate}><ScenarioComparisonPage /></AppPage>
    case 'rescue':
      return <AppPage route={route} navigate={navigate}><RescuePage navigate={navigate} /></AppPage>
    case 'plan-b':
      return <AppPage route={route} navigate={navigate}><PlanBPage /></AppPage>
    case 'advisor':
      return <AppPage route={route} navigate={navigate}><AdvisorPage /></AppPage>
    case 'alerts':
      return <AppPage route={route} navigate={navigate}><AlertsPage /></AppPage>
    case 'settings':
      return <AppPage route={route} navigate={navigate}><SettingsPage /></AppPage>
    default:
      break
  }

  // The older step-by-step screens, now inside the workspace for a signed-in person.
  if (!plan) return <AppPage route="dashboard" navigate={navigate}><DashboardPage navigate={navigate} /></AppPage>
  if (!hasGoals(plan) && NEEDS_GOALS.includes(route)) return <NeedsGoal route={route} navigate={navigate} copy={text.needGoals} />
  return <PlanScreens route={route} navigate={navigate} />
}

function NeedsGoal({ route, navigate, copy }: { route: Route; navigate: PageProps['navigate']; copy: { title: string; body: string; action: string } }) {
  return (
    <Layout route={route} navigate={navigate} speak={`${copy.title} ${copy.body}`}>
      <PageHeading title={copy.title} />
      <Card>
        <CardTitle>{copy.body}</CardTitle>
        <PrimaryButton onClick={() => navigate('dreams')}>{copy.action}</PrimaryButton>
      </Card>
    </Layout>
  )
}

/** The step-by-step plan screens that work with a plan in memory, with or without an account. */
function PlanScreens({ route, navigate }: { route: Route; navigate: PageProps['navigate'] }) {
  const { plan, text } = useStore()
  if (plan && !hasGoals(plan) && NEEDS_GOALS.includes(route)) return <NeedsGoal route={route} navigate={navigate} copy={text.needGoals} />
  switch (route) {
    case 'money-in':
      return <MoneyIn navigate={navigate} />
    case 'money-out':
      return <MoneyOut navigate={navigate} />
    case 'dreams':
      return <Dreams navigate={navigate} />
    case 'plan':
      return <PlanPage navigate={navigate} />
    case 'what-if':
      return <WhatIfPage navigate={navigate} />
    case 'fixes':
      return <FixesPage navigate={navigate} />
    case 'compare':
      return <ComparePage navigate={navigate} />
    case 'tradeoffs':
      return <TradeoffsPage navigate={navigate} />
    default:
      return <Home navigate={navigate} />
  }
}

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <Screens />
      </StoreProvider>
    </AuthProvider>
  )
}
