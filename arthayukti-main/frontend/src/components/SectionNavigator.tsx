import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ListTree } from 'lucide-react'

export interface SectionLink {
  id: string
  label: string
}

/**
 * A compact "On this page" button. It opens a floating list next to the button, over a softly blurred
 * backdrop; choosing a section closes it and scrolls there. Escape or a click outside closes it too.
 * It scrolls with scrollIntoView, not with #links, because the app's router lives in the hash.
 */
export function SectionNavigator({ label, sections }: { label: string; sections: SectionLink[] }) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const [place, setPlace] = useState<{ align: 'left' | 'right'; up: boolean; max: number }>({ align: 'left', up: false, max: 448 })
  const [present, setPresent] = useState<SectionLink[]>(sections)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // The panel plays a short exit before it unmounts.
  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) button.current?.focus()
    setClosing(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 140)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Only sections that exist on the page right now are listed, and the panel is kept inside the window.
  const toggle = () => {
    if (open) {
      close(false)
      return
    }
    window.clearTimeout(timer.current)
    setClosing(false)
    {
      setPresent(sections.filter((section) => document.getElementById(section.id)))
      const rect = button.current?.getBoundingClientRect()
      if (rect) {
        // Open below the button when there is room for a useful list, otherwise above it.
        const below = window.innerHeight - rect.bottom - 16
        const above = rect.top - 16
        const up = below < 260 && above > below
        setPlace({ align: rect.left + 300 > window.innerWidth - 12 ? 'right' : 'left', up, max: Math.min(448, Math.max(160, up ? above : below)) })
      }
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
        items[next]?.focus()
        event.preventDefault()
      }
      if (event.key === 'Tab') {
        const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          last.focus()
          event.preventDefault()
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus()
          event.preventDefault()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const go = (id: string) => {
    close(false)
    const target = document.getElementById(id)
    if (!target) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
  }

  return (
    <div className="relative inline-block">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open && !closing}
        onClick={toggle}
        className={`glass flex min-h-10 items-center gap-2 rounded-xl px-3 text-[14px] font-semibold ${open ? 'relative z-50' : ''}`}
      >
        <ListTree size={18} aria-hidden="true" />
        {label}
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${open && !closing ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <>
          <button type="button" aria-label={label} tabIndex={-1} onClick={() => close(true)} data-closing={closing || undefined} className="pop-backdrop fixed inset-0 z-40 cursor-default bg-ink/20 backdrop-blur-[3px]" />
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            data-closing={closing || undefined}
            style={{ maxHeight: place.max, transformOrigin: `${place.up ? 'bottom' : 'top'} ${place.align}` }}
            className={`pop-panel surface-solid absolute z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-2xl p-2 ${place.up ? 'bottom-full mb-2' : 'top-full mt-2'} ${place.align === 'right' ? 'right-0' : 'left-0'}`}
          >
            {present.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => go(section.id)}
                className="min-h-10 rounded-lg px-3 text-left text-[15px] font-semibold hover:bg-sand focus-visible:bg-sand"
              >
                {section.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
