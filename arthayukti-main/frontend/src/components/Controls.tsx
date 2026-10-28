import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Volume2, type LucideIcon } from 'lucide-react'
import { useStore } from '../state/useStore'

export function LanguageControl({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useStore()
  const option = (value: 'en' | 'hi', label: string, short: string) => (
    <button
      type="button"
      onClick={() => setLanguage(value)}
      aria-pressed={language === value}
      lang={value}
      aria-label={label}
      className={`${compact ? 'min-h-8 px-2.5 text-[13px]' : 'min-h-10 px-3 text-[16px]'} rounded-lg font-semibold ${
        language === value ? "bg-surface shadow-sm" : "bg-transparent"
      }`}
    >
      {compact ? <span aria-hidden="true"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></span> : label}
    </button>
  )
  return (
    <div className="glass flex items-center rounded-xl p-1" role="group">
      {option('en', 'English', 'EN')}
      {option('hi', 'हिन्दी', 'हि')}
    </div>
  )
}

export function ListenButton({ speak, compact = false }: { speak: string; compact?: boolean }) {
  const { text } = useStore()
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null

  const onClick = () => {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(speak)
    utterance.lang = text.speechLang
    utterance.rate = 0.9
    window.speechSynthesis.speak(utterance)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={compact ? text.listen : undefined}
      title={compact ? text.listen : undefined}
      className={
        compact
          ? 'flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface/70 hover:bg-surface'
          : 'flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 text-[16px]'
      }
    >
      <Volume2 size={compact ? 18 : 20} aria-hidden="true" />
      {compact ? null : <span>{text.listen}</span>}
    </button>
  )
}

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  icon?: 'forward' | 'back' | LucideIcon
  className?: string
}

function ButtonIcon({ icon, accent }: { icon: ButtonProps['icon']; accent: boolean }) {
  if (!icon) return null
  const Icon = icon === 'forward' ? ArrowRight : icon === 'back' ? ArrowLeft : icon
  return <Icon size={24} aria-hidden="true" className={accent ? 'text-turmeric' : ''} />
}

export function PrimaryButton({ children, onClick, disabled, icon = 'forward', className }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 w-full items-center justify-center gap-4 rounded-2xl bg-brand px-6 py-4 text-[20px] font-semibold text-white disabled:opacity-60 ${className ?? ''}`}
    >
      <span className="flex-1 text-center">{children}</span>
      <ButtonIcon icon={icon} accent />
    </button>
  )
}

export function SecondaryButton({ children, onClick, disabled, icon = 'back', className }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 w-full items-center justify-center gap-4 rounded-2xl bg-paper px-6 py-4 text-[20px] font-semibold text-ink disabled:opacity-60 ${className ?? ''}`}
    >
      <span className="flex-1 text-center">{children}</span>
      <ButtonIcon icon={icon} accent={false} />
    </button>
  )
}
