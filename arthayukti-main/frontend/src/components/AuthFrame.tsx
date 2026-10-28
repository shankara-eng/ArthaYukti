import type { ReactNode } from 'react'
import { useShellCopy } from '../state/useShellCopy'
import { LanguageControl } from './Controls'
import { OrbitScene } from './OrbitScene'
import { ThemeToggle } from './ThemeToggle'
import { Wordmark } from './Wordmark'

interface AuthFrameProps {
  children: ReactNode
  /** Layers of the orbit scene to reveal. */
  revealed?: number
  /** Show the scene on small screens too (sign-up and onboarding). */
  sceneOnMobile?: boolean
}

/** The shared composition for sign-in, sign-up and recovery: a brand card beside a glass form card. */
export function AuthFrame({ children, revealed = 2, sceneOnMobile = false }: AuthFrameProps) {
  const shell = useShellCopy()
  const c = shell.auth
  return (
    <div className="min-h-screen p-2 sm:p-4">
      <div className="mx-auto grid min-h-[calc(100vh-1rem)] max-w-[1400px] gap-3 sm:min-h-[calc(100vh-2rem)] sm:gap-4 lg:grid-cols-[1.05fr_1fr]">
        <aside className="stage relative flex flex-col justify-between gap-8 overflow-hidden rounded-[19px] px-6 py-7 lg:px-12 lg:py-10">
          <div aria-hidden="true" className="hatch pointer-events-none absolute inset-0 opacity-30" />
          <Wordmark size="lg" surface="dark" />
          <div className="relative z-10 hidden max-w-[520px] flex-col gap-5 lg:flex">
            <h2 className="font-display text-[42px] leading-[1.08] font-semibold tracking-tight">{c.heroTitle}</h2>
            <p className="text-[18px] text-muted">{c.heroBody}</p>
            <ul className="flex flex-col gap-2 text-[16px]">
              {c.heroPoints.map((point) => (
                <li key={point} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-glow" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <OrbitScene
            revealed={revealed}
            className={`absolute -right-16 -bottom-20 w-[360px] opacity-80 lg:-right-24 lg:-bottom-24 lg:w-[540px] ${
              sceneOnMobile ? 'hidden sm:block' : 'hidden lg:block'
            }`}
          />
        </aside>
        <main className="glass flex flex-col rounded-[19px] px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
          <div className="mb-4 flex items-center justify-end gap-2">
            <LanguageControl />
            <ThemeToggle light={shell.header.themeToLight} dark={shell.header.themeToDark} />
          </div>
          <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center gap-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
