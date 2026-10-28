import { useId, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { formatMoney, parseRupeeInput } from '../lib/money'
import { Select } from './Select'

const FIELD =
  'min-h-12 w-full rounded-xl border border-line bg-paper px-3 text-[16px] text-ink placeholder:text-muted/70 focus-visible:border-ink aria-[invalid=true]:border-late'

interface FieldShellProps {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}

export function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[14px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[14px] font-semibold text-late">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function describedBy(id: string, hint?: string, error?: string | null) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
  type?: 'text' | 'email' | 'password' | 'month'
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoComplete?: string
  maxLength?: number
  placeholder?: string
}

export function TextField({ label, value, onChange, hint, error, type = 'text', inputMode, autoComplete, maxLength, placeholder }: TextFieldProps) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={FIELD}
      />
    </FieldShell>
  )
}

interface PasswordFieldProps extends Omit<TextFieldProps, 'type'> {
  showLabel: string
  hideLabel: string
}

export function PasswordField({ showLabel, hideLabel, label, value, onChange, hint, error, autoComplete }: PasswordFieldProps) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={`${FIELD} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-lg text-muted hover:text-ink"
        >
          {shown ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
    </FieldShell>
  )
}

interface SelectFieldProps<T extends string> {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  hint?: string
  error?: string | null
}

export function SelectField<T extends string>({ label, value, onChange, options, hint, error }: SelectFieldProps<T>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <Select
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={FIELD}
      />
    </FieldShell>
  )
}

interface AmountFieldProps {
  label: string
  /** A decimal string such as "12500.00", or "" when nothing has been entered. */
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
}

/** Whole rupees only. Empty stays empty, so a missing amount is never turned into zero. */
export function AmountField({ label, value, onChange, hint, error }: AmountFieldProps) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="₹"
        value={value === '' ? '' : formatMoney(value)}
        onChange={(event) => {
          if (event.target.value.trim() === '' || event.target.value.trim() === '₹') {
            onChange('')
            return
          }
          const next = parseRupeeInput(event.target.value)
          if (next !== null) onChange(next)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={FIELD}
      />
    </FieldShell>
  )
}

interface MonthFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
  min?: string
}

/** A year and month (YYYY-MM), the unit the planning engine works in. */
export function MonthField({ label, value, onChange, hint, error, min }: MonthFieldProps) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="month"
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={FIELD}
      />
    </FieldShell>
  )
}

/** A full calendar date (YYYY-MM-DD). */
export function DateField({ label, value, onChange, hint, error }: Omit<MonthFieldProps, 'min'>) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={FIELD}
      />
    </FieldShell>
  )
}

export function CheckField({ label, checked, onChange, error }: { label: string; checked: boolean; onChange: (value: boolean) => void; error?: string | null }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          className="mt-1 size-5 shrink-0 accent-[var(--color-ink)]"
        />
        <label htmlFor={id} className="text-[15px]">
          {label}
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] font-semibold text-late">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-[15px] font-semibold text-late">
      {children}
    </p>
  )
}

interface RepeaterProps<T extends { id: string }> {
  items: T[]
  max?: number
  addLabel: string
  empty: string
  removeLabel: (index: number) => string
  confirmRemove: string
  confirmYes: string
  confirmNo: string
  onAdd: () => void
  onRemove: (id: string) => void
  renderItem: (item: T, index: number) => ReactNode
  limitNote?: string
}

/** A list of records the person can add to and remove from, asking before anything is removed. */
export function Repeater<T extends { id: string }>({
  items,
  max,
  addLabel,
  empty,
  removeLabel,
  confirmRemove,
  confirmYes,
  confirmNo,
  onAdd,
  onRemove,
  renderItem,
  limitNote,
}: RepeaterProps<T>) {
  const [asking, setAsking] = useState<string | null>(null)
  const full = max !== undefined && items.length >= max
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <p className="text-muted">{empty}</p> : null}
      {items.map((item, index) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-2xl glass p-4">
          {renderItem(item, index)}
          <div className="flex items-center justify-end gap-2">
            {asking === item.id ? (
              <>
                <span role="alert" className="mr-auto text-[14px] font-semibold">
                  {confirmRemove}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onRemove(item.id)
                    setAsking(null)
                  }}
                  className="min-h-10 rounded-lg bg-late px-3 text-[14px] font-semibold text-paper"
                >
                  {confirmYes}
                </button>
                <button type="button" onClick={() => setAsking(null)} className="min-h-10 rounded-lg border border-line px-3 text-[14px]">
                  {confirmNo}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAsking(item.id)}
                aria-label={removeLabel(index)}
                className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-[14px] text-muted hover:text-late"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      ))}
      {full && limitNote ? <p className="text-[14px] text-muted">{limitNote}</p> : null}
      <button
        type="button"
        onClick={onAdd}
        disabled={full}
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-ink/40 font-semibold disabled:opacity-50"
      >
        <Plus size={18} aria-hidden="true" />
        {addLabel}
      </button>
    </div>
  )
}
