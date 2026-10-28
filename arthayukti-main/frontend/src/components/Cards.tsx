import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Frown, Smile, Wallet } from 'lucide-react'
import type { Tone } from '../lib/outcome'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`glass flex flex-col gap-4 rounded-3xl p-6 ${className ?? ''}`}
    >
      {children}
    </section>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[28px] leading-[1.15] font-semibold">{children}</h2>
}

export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-[34px] leading-[1.15] font-semibold sm:text-[40px] lg:text-[48px]">
        {title}
      </h1>
      {subtitle ? <p className="text-muted">{subtitle}</p> : null}
    </div>
  )
}

export function VerdictBanner({ tone, title, body }: { tone: Tone; title: string; body: string }) {
  const Icon = tone === 'good' ? Smile : Frown
  return (
    <div
      role="status"
      className={`flex items-start gap-4 rounded-3xl p-6 ${tone === 'good' ? 'bg-sage' : 'bg-blush'}`}
    >
      <Icon
        size={40}
        aria-hidden="true"
        className={`shrink-0 ${tone === 'good' ? 'text-ontime' : 'text-late'}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-display text-[24px] leading-[1.15] font-semibold sm:text-[28px]">{title}</p>
        <p>{body}</p>
      </div>
    </div>
  )
}

interface TilesProps {
  inLabel: string
  outLabel: string
  leftLabel: string
  income: string
  spending: string
  left: string
  note?: string
}

export function SummaryTiles({ inLabel, outLabel, leftLabel, income, spending, left, note }: TilesProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile icon={<ArrowDownLeft size={24} aria-hidden="true" />} label={inLabel} value={income} />
        <Tile icon={<ArrowUpRight size={24} aria-hidden="true" />} label={outLabel} value={spending} />
        <Tile
          dark
          icon={<Wallet size={24} aria-hidden="true" className="text-turmeric" />}
          label={leftLabel}
          value={left}
        />
      </div>
      {note ? <p className="text-muted">{note}</p> : null}
    </div>
  )
}

function Tile({
  icon,
  label,
  value,
  dark,
}: {
  icon: ReactNode
  label: string
  value: string
  dark?: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl p-6 ${dark ? 'bg-brand text-white' : 'bg-paper'}`}
    >
      {icon}
      <p className={dark ? '' : 'text-muted'}>{label}</p>
      <p className="font-display text-[32px] leading-none">{value}</p>
    </div>
  )
}

export function StepProgress({
  step,
  stepOf,
  labels,
}: {
  step: 1 | 2 | 3
  stepOf: string
  labels: [string, string, string]
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold">{stepOf}</p>
      <div className="flex gap-2" aria-hidden="true">
        {[1, 2, 3].map((index) => (
          <div
            key={index}
            className={`h-2 flex-1 rounded-sm ${index <= step ? 'bg-turmeric' : 'bg-sand'}`}
          />
        ))}
      </div>
      <ol className="flex justify-between">
        {labels.map((label, index) => (
          <li key={label} className={index + 1 === step ? 'font-semibold' : ''}>
            {label}
          </li>
        ))}
      </ol>
    </div>
  )
}
