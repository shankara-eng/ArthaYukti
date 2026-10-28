import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Check, ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Menu, X } from 'lucide-react'
import { api } from '../api/client'
import type { InsuranceReminderItem } from '../api/types'
import { NAV_AFTER_OUTLOOK, NAV_BEFORE_OUTLOOK, OUTLOOK_ICON, OUTLOOK_ITEMS, titleFor, type NavItem } from '../lib/nav'
import type { Route } from '../lib/route'
import { useAuth } from '../state/useAuth'
import { useShellCopy } from '../state/useShellCopy'
import { useStore } from '../state/useStore'
import { LanguageControl, ListenButton } from './Controls'
import { PageActionsSlot } from '../state/pageActionsSlot'
import { Select } from './Select'
import { ThemeToggle } from './ThemeToggle'
import { Wordmark } from './Wordmark'

interface ShellProps {
  route: Route
  navigate: (route: Route) => void
  speak: string
  children: ReactNode
}

const COLLAPSE_KEY = 'arthayukti.sidebar'

function readCollapsed(): boolean {
  try {
    // The slim icon rail is the default; the person can widen it.
    return window.localStorage.getItem(COLLAPSE_KEY) !== 'open'
  } catch {
    return true
  }
}

/** Quick links in the pill bar at the top. */
const TOP_LINKS: { route: Route; key: 'dashboard' | 'finances' | 'goals' | 'outlook' }[] = [
  { route: 'dashboard', key: 'dashboard' },
  { route: 'finances', key: 'finances' },
  { route: 'goals', key: 'goals' },
  { route: 'outlook-household', key: 'outlook' },
]

const circle = 'flex size-9 shrink-0 sm:size-[34px] items-center justify-center rounded-full transition-colors motion-reduce:transition-none'

/** The signed-in workspace: a floating pill bar, a slim icon rail, and a glass content area. */
export function AppShell({ route, navigate: goTo, speak, children }: ShellProps) {
  const c = useShellCopy()
  const auth = useAuth()
  const { choice, setChoice, dirty, saving, saveError, savePlan, plan } = useStore()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [bell, setBell] = useState(false)
  const [menu, setMenu] = useState(false)
  const [reminders, setReminders] = useState<InsuranceReminderItem[] | null>(null)
  const [outlookOpen, setOutlookOpen] = useState(route.startsWith('outlook-'))
  // The slim rail scrolls when the window is short, so its Outlook list floats outside it, at these coordinates.
  const [flyout, setFlyout] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const flyoutList = useRef<HTMLUListElement>(null)
  const outlookButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .reminders(controller.signal)
      .then(setReminders)
      .catch(() => setReminders(null))
    return () => controller.abort()
  }, [route])

  // Moving to another page also closes the menus.
  const navigate = (next: Route) => {
    setDrawer(false)
    setBell(false)
    setMenu(false)
    if (flyout) {
      setFlyout(null)
      setOutlookOpen(false)
    }
    goTo(next)
  }

  // The floating Outlook list closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!flyout) return
    const close = () => {
      setFlyout(null)
      setOutlookOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (flyoutList.current?.contains(target) || outlookButton.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        outlookButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [flyout])

  const toggleOutlook = (compact: boolean) => {
    if (compact && !outlookOpen) {
      const rect = outlookButton.current?.getBoundingClientRect()
      // Hang from the button when there is room below it, otherwise sit on the window's bottom edge.
      if (rect) setFlyout(window.innerHeight - rect.top >= 380 ? { top: rect.top, left: rect.right + 12 } : { bottom: 8, left: rect.right + 12 })
    } else {
      setFlyout(null)
    }
    setOutlookOpen((value) => !value)
  }

  function toggleCollapse() {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, current ? 'open' : 'collapsed')
      } catch {
        // the choice still holds for this visit
      }
      return !current
    })
  }

  const open = reminders?.filter((item) => !item.is_acknowledged) ?? []
  const title = titleFor(route, c.nav)
  const first = (auth.user?.full_name?.trim().split(/\s+/)[0] || auth.user?.email.split('@')[0]) ?? ''
  const OutlookIcon = OUTLOOK_ICON
  const outlookActive = route.startsWith('outlook-')

  /** The navigation list, used by the icon rail (compact), the widened rail and the phone drawer. */
  const navList = (compact: boolean) => {
    const link = (item: NavItem) => {
      const active = route === item.route || item.covers.includes(route)
      const Icon = item.icon
      return (
        <li key={item.route}>
          <button
            type="button"
            onClick={() => navigate(item.route)}
            aria-current={active ? 'page' : undefined}
            title={compact ? c.nav[item.key] : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-xl text-left text-[15px] transition-colors motion-reduce:transition-none ${
              compact ? 'size-10 justify-center' : 'w-full px-3'
            } ${active ? 'bg-brand font-semibold text-white shadow-[0_8px_18px_-8px_var(--color-brand)]' : 'text-ink hover:bg-surface/80'}`}
          >
            <Icon size={20} aria-hidden="true" className="shrink-0" />
            <span className={compact ? 'sr-only' : 'truncate'}>{c.nav[item.key]}</span>
          </button>
        </li>
      )
    }
    const outlookList = (floating: boolean) => (
      <ul
        ref={floating ? flyoutList : undefined}
        style={floating && flyout ? { ...flyout, maxHeight: 'calc(100dvh - 1rem)' } : undefined}
        className={floating ? 'pop-panel surface-solid fixed z-40 flex w-60 flex-col gap-1 overflow-y-auto rounded-3xl p-2' : 'mt-1 ml-6 flex flex-col gap-1 border-l border-line pl-3'}
      >
        {OUTLOOK_ITEMS.map((item) => (
          <li key={item.route}>
            <button
              type="button"
              onClick={() => navigate(item.route)}
              aria-current={route === item.route ? 'page' : undefined}
              className={`min-h-10 w-full rounded-xl px-4 text-left text-[14px] ${route === item.route ? 'bg-brand font-semibold text-white' : 'text-ink hover:bg-sand'}`}
            >
              {c.nav.outlookItems[item.key]}
            </button>
          </li>
        ))}
      </ul>
    )
    return (
      <nav aria-label={c.nav.label}>
        <ul className={`flex flex-col gap-1.5 ${compact ? 'items-center' : ''}`}>
          {NAV_BEFORE_OUTLOOK.map(link)}
          <li className="relative">
            <button
              ref={compact ? outlookButton : undefined}
              type="button"
              onClick={() => toggleOutlook(compact)}
              aria-expanded={outlookOpen}
              title={compact ? c.nav.outlook : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-xl text-left text-[15px] ${compact ? 'size-10 justify-center' : 'w-full px-3'} ${
                outlookActive ? 'bg-brand font-semibold text-white' : 'text-ink hover:bg-surface/80'
              }`}
            >
              <OutlookIcon size={20} aria-hidden="true" className="shrink-0" />
              <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{c.nav.outlook}</span>
              {compact ? null : <ChevronDown size={16} aria-hidden="true" className={outlookOpen ? 'rotate-180' : ''} />}
            </button>
            {outlookOpen && (!compact || flyout) ? (compact ? createPortal(outlookList(true), document.body) : outlookList(false)) : null}
          </li>
          {NAV_AFTER_OUTLOOK.map(link)}
        </ul>
      </nav>
    )
  }

  return (
    <PageActionsSlot.Provider value={actionsSlot}>
    <div className="min-h-screen p-2 sm:p-4">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-cream">
        {c.header.skip}
      </a>
      <div className="mx-auto max-w-[1560px]">
        <header className="glass-bar sticky top-2 z-30 flex items-center gap-1.5 rounded-2xl px-2 py-1.5 sm:gap-2.5 sm:px-4">
          <button type="button" onClick={() => setDrawer(true)} aria-label={c.header.menu} className={`${circle} border border-line bg-surface/70 lg:hidden`}>
            <Menu size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate('dashboard')} aria-label="ArthaYukti" className="sm:mr-2">
            <span className="sm:hidden">
              <Wordmark size="mark" />
            </span>
            <span className="hidden sm:block">
              <Wordmark />
            </span>
          </button>
          <nav aria-label={c.header.primary} className="mx-auto hidden min-w-0 items-center gap-0.5 rounded-xl bg-surface/60 p-1 lg:flex xl:gap-1">
            {TOP_LINKS.map((item) => {
              const active =
                route === item.route ||
                (item.key === 'outlook' && outlookActive) ||
                (item.key === 'finances' && ['money-in', 'money-out'].includes(route)) ||
                (item.key === 'goals' && ['dreams', 'plan', 'what-if', 'fixes', 'compare', 'tradeoffs'].includes(route))
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => navigate(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`min-h-9 rounded-lg px-2.5 text-[13px] leading-tight transition-colors xl:px-4 xl:text-[14px] xl:whitespace-nowrap motion-reduce:transition-none ${active ? 'bg-surface font-semibold shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {c.nav[item.key]}
                </button>
              )
            })}
          </nav>
          <span className="flex-1 lg:hidden" />
          <LanguageControl compact />
          <ThemeToggle light={c.header.themeToLight} dark={c.header.themeToDark} />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setBell((value) => !value)
                setMenu(false)
              }}
              aria-label={`${c.header.notifications}${open.length ? ` (${open.length})` : ''}`}
              aria-expanded={bell}
              className={`${circle} relative bg-surface/70 hover:bg-surface`}
            >
              <Bell size={17} aria-hidden="true" />
              {open.length ? <span className="absolute top-1.5 right-2 size-2 rounded-full bg-late" aria-hidden="true" /> : null}
            </button>
            {bell ? (
              <div className="pop-panel surface-solid absolute right-0 z-40 mt-3 w-[min(340px,calc(100vw-2rem))] rounded-3xl p-3 [transform-origin:top_right]">
                {open.length === 0 ? (
                  <p className="p-2 text-muted">{c.header.noNotifications}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {open.slice(0, 5).map((item) => (
                      <li key={item.id} className="rounded-2xl bg-cream p-3 text-[14px]">
                        <p className="font-semibold">{item.due_date}</p>
                        <p>{item.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" onClick={() => navigate('alerts')} className="mt-2 w-full rounded-lg px-2 py-2 text-left text-[14px] font-semibold underline">
                  {c.nav.alerts}
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMenu((value) => !value)
                setBell(false)
              }}
              aria-label={c.header.account}
              aria-expanded={menu}
              className={`${circle} bg-brand text-[14px] font-semibold text-white`}
            >
              {(auth.user?.full_name || auth.user?.email || '?').slice(0, 1).toUpperCase()}
            </button>
            {menu ? (
              <div className="pop-panel surface-solid absolute right-0 z-40 mt-3 w-[min(280px,calc(100vw-2rem))] rounded-3xl p-3 [transform-origin:top_right]">
                <p className="truncate px-2 font-semibold">{auth.user?.full_name || auth.user?.email}</p>
                <p className="truncate px-2 pb-2 text-[14px] text-muted">{auth.user?.email}</p>
                <button type="button" onClick={() => navigate('settings')} className="min-h-10 w-full rounded-lg px-2 text-left hover:bg-sand">
                  {c.header.settings}
                </button>
                <button type="button" onClick={() => void auth.logout()} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-sand">
                  <LogOut size={16} aria-hidden="true" />
                  {c.header.signOut}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {drawer ? <button type="button" aria-label={c.header.menu} onClick={() => setDrawer(false)} className="fixed inset-0 z-40 bg-night/40 backdrop-blur-sm lg:hidden" /> : null}
        <aside className={`glass-bar fixed inset-y-3 left-3 z-50 w-[280px] overflow-y-auto rounded-[17px] p-4 transition-transform motion-reduce:transition-none lg:hidden ${drawer ? 'translate-x-0' : '-translate-x-[120%]'}`}>
          <div className="mb-3 flex items-center justify-between">
            <Wordmark />
            <button type="button" onClick={() => setDrawer(false)} aria-label={c.header.menu} className={`${circle} bg-surface/70`}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {navList(false)}
        </aside>

        <div className="mt-4 flex items-start gap-4 sm:mt-5 sm:gap-5">
          <aside
            className={`glass-bar sticky top-[5.25rem] hidden max-h-[calc(100dvh-7rem)] shrink-0 flex-col items-center gap-3 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[19px] py-4 lg:flex ${collapsed ? 'w-[64px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'w-[250px] items-stretch px-3 [scrollbar-width:thin]'}`}
          >
            {navList(collapsed)}
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label={collapsed ? c.header.expand : c.header.collapse}
              className={`${circle} mt-1 self-center border border-line bg-surface/70 hover:bg-surface`}
            >
              {collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
            </button>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-1">
              <p className="min-w-0 font-display text-[26px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] sm:text-[30px]">
                {route === 'dashboard' ? (
                  <>
                    {c.header.welcome} <span className="text-muted">{first}</span>
                  </>
                ) : (
                  title
                )}
              </p>

              <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={c.header.primary}>
                <div ref={setActionsSlot} className="contents" />

                {plan ? (
                  <div className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface/70 pr-1 pl-3 text-[14px]">
                    <span className="text-muted" aria-hidden="true">
                      {c.header.scenario}
                    </span>
                    <Select
                      aria-label={c.header.scenario}
                      value={choice}
                      onChange={(value) => setChoice(value)}
                      options={(['normal', 'no_income', 'expense'] as const).map((value) => ({ value, label: c.header.scenarios[value] }))}
                      className="min-h-8 max-w-[12.5rem] rounded-lg bg-surface px-2.5 text-[14px] font-semibold sm:max-w-none"
                    />
                  </div>
                ) : null}

                {auth.status === 'authenticated' && plan ? (
                  <div className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface/70 pr-1 pl-3 text-[14px]" role="status">
                    {saving ? (
                      <span className="text-muted">{c.header.saving}</span>
                    ) : saveError ? (
                      <span className="max-w-[15rem] leading-tight font-semibold text-late">{c.header.saveFailed}</span>
                    ) : dirty ? (
                      <span className="font-semibold">{c.header.unsaved}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted">
                        <Check size={16} aria-hidden="true" className="text-ontime" />
                        {c.header.saved}
                      </span>
                    )}
                    {dirty ? (
                      <button type="button" disabled={saving} onClick={() => void savePlan()} className="min-h-8 rounded-lg bg-brand px-3 font-semibold text-white disabled:opacity-60">
                        {c.header.save}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <ListenButton speak={speak} compact />
              </div>
            </div>

            <main key={route} id="main-content" tabIndex={-1} className="page-in outline-none">
              <div className="flex flex-col gap-5">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </div>
    </PageActionsSlot.Provider>
  )
}
