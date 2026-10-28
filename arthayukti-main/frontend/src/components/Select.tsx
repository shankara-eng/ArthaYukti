import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  /** Classes for the button that shows the current choice. */
  className?: string
  /** Something to show before the label inside the button (an icon). */
  leading?: ReactNode
}

/**
 * A drop-down that matches the app: a themed, animated list instead of the browser's own menu.
 * Keyboard: arrows, Home/End, type-ahead, Enter or Space to choose, Escape to close.
 */
export function Select<T extends string>({ value, options, onChange, id, className, leading, ...aria }: SelectProps<T>) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [place, setPlace] = useState<{ up: boolean; max: number; right: boolean }>({ up: false, max: 288, right: false })
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const typed = useRef({ text: '', at: 0 })
  const current = options.find((option) => option.value === value)

  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) trigger.current?.focus()
    setClosing(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 140)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const openList = () => {
    window.clearTimeout(timer.current)
    setClosing(false)
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom - 16
      const above = rect.top - 16
      const up = below < 200 && above > below
      setPlace({ up, max: Math.min(320, Math.max(120, up ? above : below)), right: rect.left + 260 > window.innerWidth - 12 && rect.right > 260 })
    }
    setOpen(true)
  }

  // Focus the chosen entry when the list opens, and close on a click or tap elsewhere.
  useEffect(() => {
    if (!open) return
    const items = list.current?.querySelectorAll<HTMLElement>('[role=option]')
    const selected = [...(items ?? [])].find((item) => item.getAttribute('aria-selected') === 'true') ?? items?.[0]
    selected?.focus({ preventScroll: true })
    selected?.scrollIntoView({ block: 'nearest' })
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, close])

  const move = (to: (items: HTMLElement[], at: number) => number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const target = items[Math.max(0, Math.min(items.length - 1, to(items, at)))]
    target.focus()
    target.scrollIntoView({ block: 'nearest' })
  }

  const onListKey = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move((_, at) => at + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        move((_, at) => at - 1)
        return
      case 'Home':
        event.preventDefault()
        move(() => 0)
        return
      case 'End':
        event.preventDefault()
        move((items) => items.length - 1)
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      case 'Tab':
        close(false)
        return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Type-ahead: letters jump to the next entry that starts with them.
      const now = Date.now()
      typed.current = { text: now - typed.current.at > 700 ? event.key.toLowerCase() : typed.current.text + event.key.toLowerCase(), at: now }
      const start = typed.current.text
      move((items, at) => {
        const order = [...items.keys()].map((i) => (i + Math.max(at, 0) + (start.length === 1 ? 1 : 0)) % items.length)
        const hit = order.find((i) => items[i].textContent?.trim().toLowerCase().startsWith(start))
        return hit ?? at
      })
    }
  }

  const choose = (next: T) => {
    if (next !== value) onChange(next)
    close(true)
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open && !closing}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        aria-invalid={aria['aria-invalid']}
        aria-describedby={aria['aria-describedby']}
        onClick={() => (open && !closing ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) openList()
          }
        }}
        className={`flex w-full items-center gap-2 text-left ${className ?? ''}`}
      >
        {leading}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open && !closing ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          data-closing={closing || undefined}
          onKeyDown={onListKey}
          style={{ maxHeight: place.max, transformOrigin: `${place.up ? 'bottom' : 'top'} ${place.right ? 'right' : 'left'}` }}
          className={`pop-panel surface-solid absolute z-50 flex min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl p-1.5 ${place.up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${place.right ? 'right-0' : 'left-0'}`}
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[15px] transition-colors duration-150 hover:bg-sand focus-visible:bg-sand motion-reduce:transition-none ${selected ? 'font-semibold' : ''}`}
              >
                <span>{option.label}</span>
                {selected ? <Check size={16} aria-hidden="true" className="shrink-0 text-brand" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
