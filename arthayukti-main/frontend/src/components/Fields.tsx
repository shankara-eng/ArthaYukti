import { useId, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, Minus, Plus } from 'lucide-react'
import { Select } from './Select'
import { monthLabel, monthRange, monthToIndex, type Language } from '../lib/months'
import { formatMoney, parseRupeeInput } from '../lib/money'

interface MoneyFieldProps {
  icon: ReactNode
  label: string
  hint?: string
  value: string
  onChange: (amount: string) => void
}

export function MoneyField({ icon, label, hint, value, onChange }: MoneyFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={formatMoney(value)}
        onChange={(event) => {
          const next = parseRupeeInput(event.target.value)
          if (next !== null) onChange(next)
        }}
        className="min-h-[72px] w-full rounded-2xl border border-line bg-cream p-4 font-display text-[32px]"
      />
      {hint ? <p className="text-muted">{hint}</p> : null}
    </div>
  )
}

interface StepperProps {
  value: string
  decreaseLabel: string
  increaseLabel: string
  onDecrease: () => void
  onIncrease: () => void
}

export function Stepper({ value, decreaseLabel, increaseLabel, onDecrease, onIncrease }: StepperProps) {
  const button = (label: string, action: () => void, icon: ReactNode) => (
    <button
      type="button"
      onClick={action}
      aria-label={label}
      className="flex h-16 w-11 shrink-0 items-center justify-center sm:w-14"
    >
      {icon}
    </button>
  )
  return (
    <div className="flex min-h-16 items-center gap-2 rounded-2xl bg-cream">
      {button(decreaseLabel, onDecrease, <Minus size={24} aria-hidden="true" />)}
      <p className="min-w-0 flex-1 text-center font-display text-[22px] sm:text-[26px]" aria-live="polite">
        {formatMoney(value)}
      </p>
      {button(increaseLabel, onIncrease, <Plus size={24} aria-hidden="true" />)}
    </div>
  )
}

interface MonthPickerProps {
  value: string
  from: string
  label: string
  language: Language
  onChange: (month: string) => void
}

const MONTH_CHOICES = 420

export function MonthPicker({ value, from, label, language, onChange }: MonthPickerProps) {
  const months = monthRange(from, MONTH_CHOICES)
  if (!months.includes(value) && monthToIndex(value) >= monthToIndex(from)) months.push(value)
  return (
    <div className="flex min-h-16 items-center gap-4 rounded-2xl border border-line bg-cream p-4 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-turmeric">
      <CalendarDays size={24} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <Select
          aria-label={label}
          value={value}
          onChange={onChange}
          options={months.map((month) => ({ value: month, label: monthLabel(month, language) }))}
          className="min-h-8 font-semibold"
        />
      </div>
    </div>
  )
}

interface PriorityControlsProps {
  rankText: string
  moveUpLabel: string
  moveDownLabel: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

export function PriorityControls(props: PriorityControlsProps) {
  const square = (label: string, enabled: boolean, action: () => void, icon: ReactNode) => (
    <button
      type="button"
      onClick={action}
      disabled={!enabled}
      aria-label={label}
      className="flex size-14 items-center justify-center rounded-2xl bg-sand disabled:opacity-40"
    >
      {icon}
    </button>
  )
  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1">{props.rankText}</p>
      {square(props.moveUpLabel, props.canMoveUp, props.onMoveUp, <ArrowUp size={24} aria-hidden="true" />)}
      {square(props.moveDownLabel, props.canMoveDown, props.onMoveDown, <ArrowDown size={24} aria-hidden="true" />)}
    </div>
  )
}
