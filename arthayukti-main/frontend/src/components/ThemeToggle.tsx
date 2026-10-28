import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun } from 'lucide-react'

export const THEME_KEY = 'arthayukti.theme'
type Theme = 'light' | 'dark'

function stored(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const system = (): Theme => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

/** Light/dark switch. Follows the system until the person chooses; the choice is remembered. */
export function ThemeToggle({ light, dark }: { light: string; dark: string }) {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system())

  useEffect(() => apply(theme), [theme])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const follow = () => {
      if (stored() === null) setTheme(query.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const choose = () => {
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // the choice still holds for this visit
    }
    // Where the browser can, cross-fade the whole page between themes instead of snapping.
    const change = () => {
      apply(next)
      flushSync(() => setTheme(next))
    }
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!calm && typeof document.startViewTransition === 'function') document.startViewTransition(change)
    else change()
  }

  return (
    <button
      type="button"
      onClick={choose}
      aria-label={next === 'dark' ? dark : light}
      title={next === 'dark' ? dark : light}
      aria-pressed={theme === 'dark'}
      className="flex size-9 shrink-0 sm:size-[34px] items-center justify-center rounded-full bg-surface/70 transition-colors hover:bg-surface motion-reduce:transition-none"
    >
      <span key={theme} className="theme-icon flex">
        {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
      </span>
    </button>
  )
}
