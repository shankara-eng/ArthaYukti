import type { ReactNode } from 'react'
import { ArrowDownUp, Columns2, Target, Zap, type LucideIcon } from 'lucide-react'
import type { Route } from '../lib/route'
import { householdName } from '../lib/household'
import { useAuth } from '../state/useAuth'
import { useShellCopy } from '../state/useShellCopy'
import { useStore } from '../state/useStore'
import { AppShell } from './AppShell'
import { LanguageControl, ListenButton } from './Controls'
import { ThemeToggle } from './ThemeToggle'
import { Wordmark } from './Wordmark'

interface LayoutProps {
  route: Route
  navigate: (route: Route) => void
  /** What the Listen button reads aloud. */
  speak: string
  children: ReactNode
}

type NavKey = 'myPlan' | 'whatIf' | 'compare' | 'tradeoffs'

const NAV: { route: Route; key: NavKey; icon: LucideIcon; covers: Route[] }[] = [
  { route: 'plan', key: 'myPlan', icon: Target, covers: ['plan'] },
  { route: 'tradeoffs', key: 'tradeoffs', icon: ArrowDownUp, covers: ['tradeoffs'] },
  { route: 'what-if', key: 'whatIf', icon: Zap, covers: ['what-if', 'fixes'] },
  { route: 'compare', key: 'compare', icon: Columns2, covers: ['compare'] },
]

export function Layout({ route, navigate, speak, children }: LayoutProps) {
  const { text, sample, plan } = useStore()
  const name = householdName(text, sample, plan)
  const auth = useAuth()
  const shell = useShellCopy()

  if (auth.status === 'authenticated') {
    return (
      <AppShell route={route} navigate={navigate} speak={speak}>
        {children}
      </AppShell>
    )
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="stage border-b border-night-line px-4 py-3 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-8 gap-y-2">
          <button type="button" onClick={() => navigate('home')} aria-label="ArthaYukti">
            <Wordmark surface="dark" />
          </button>
          {plan ? (
            <nav aria-label={text.nav.label} className="hidden flex-1 items-center gap-1 md:flex">
              {NAV.map((item) => {
                const active = item.covers.includes(route)
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => navigate(item.route)}
                    aria-current={active ? 'page' : undefined}
                    className={`min-h-11 rounded-xl px-4 text-[15px] whitespace-nowrap transition-colors motion-reduce:transition-none ${
                      active ? 'bg-brand font-semibold text-white' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {text.nav[item.key]}
                  </button>
                )
              })}
            </nav>
          ) : (
            <span className="flex-1" />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('login')} className="min-h-11 rounded-xl px-4 text-[15px] font-semibold text-ink hover:bg-sand">
              {shell.auth.signInLink}
            </button>
            <button type="button" onClick={() => navigate('signup')} className="min-h-11 rounded-xl bg-brand px-4 text-[15px] font-semibold text-white">
              {shell.auth.createAccount}
            </button>
            <LanguageControl />
            <ThemeToggle light={shell.header.themeToLight} dark={shell.header.themeToDark} />
            <ListenButton speak={speak} />
          </div>
        </div>
        {name ? (
          <div className="mx-auto mt-2 flex max-w-[1180px] items-center gap-2 text-[14px] text-muted">
            <span className="font-semibold text-ink">{name}</span>
            <span className="rounded-xl border border-night-line px-2 py-0.5">
              {sample ? text.shell.sample : text.shell.unsaved}
            </span>
          </div>
        ) : null}
      </header>

      <main className="px-4 pt-8 pb-28 sm:px-8 md:pb-12 lg:px-12">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-8">{children}</div>
      </main>

      <footer className="border-t border-line px-4 py-6 pb-28 text-[14px] text-muted sm:px-8 md:pb-6 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <p>{text.footer.example}</p>
          <p>{text.footer.scope}</p>
          <p>{text.footer.legal}</p>
        </div>
      </footer>

      {plan ? (
        <nav
          aria-label={text.nav.label}
          className="stage fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-night-line pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.map((item) => {
            const active = item.covers.includes(route)
            const Icon = item.icon
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => navigate(item.route)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[12px] ${
                  active ? 'font-semibold text-glow' : 'text-muted'
                }`}
              >
                <Icon size={22} aria-hidden="true" />
                <span className="max-w-full truncate">{text.nav[item.key]}</span>
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
