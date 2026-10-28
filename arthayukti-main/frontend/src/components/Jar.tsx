import { useId } from 'react'
import type { Tone } from '../lib/outcome'

const JAR_PATH =
  'M36.4394 3.70732C56.1465 -1.23577 75.8535 -1.23577 95.5606 3.70732L92.1497 23.8328C117.163 35.4843 133.08 59.8467 131.943 84.2091C130.806 127.638 109.204 152 66 152C22.7961 152 1.19409 127.638 0.0571455 84.2091C-1.0798 59.8467 14.8374 35.4843 39.8502 23.8328L36.4394 3.70732Z'

const HEIGHT = 152
const WATERLINE_Y = 63
const FULL_Y = 50
const CLAY = '#dc9a70'
const RIM = '#ba714d'
const WATER: Record<Tone, string> = { good: '#1e9e6a', late: '#d9573b' }

interface JarProps {
  /** How full the jar is at the target date, from 0 to 1. */
  level: number
  tone: Tone
  label: string
  className?: string
}

/**
 * The matka jar. The dashed line is the money needed by the target date. Water above it means
 * the dream is covered; water below it means it falls short.
 */
export function Jar({ level, tone, label, className }: JarProps) {
  const gradientId = useId()
  const clipId = useId()
  const clamped = Math.min(1, Math.max(0, level))
  const full = tone === 'good' && clamped >= 1
  const waterTop = full ? FULL_Y : HEIGHT - (HEIGHT - WATERLINE_Y) * clamped
  const hasWater = clamped > 0

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 132 152"
      className={className ?? 'h-[152px] w-[132px] shrink-0'}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={JAR_PATH} />
        </clipPath>
        {hasWater ? (
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2={HEIGHT} gradientUnits="userSpaceOnUse">
            <stop stopColor={CLAY} />
            <stop offset={waterTop / HEIGHT} stopColor={CLAY} />
            <stop offset={waterTop / HEIGHT + 0.005} stopColor={WATER[tone]} />
            <stop offset="1" stopColor={WATER[tone]} />
          </linearGradient>
        ) : null}
      </defs>
      <path d={JAR_PATH} fill={hasWater ? `url(#${gradientId})` : CLAY} />
      <path
        d={JAR_PATH}
        fill="none"
        stroke={RIM}
        strokeWidth={6}
        clipPath={`url(#${clipId})`}
      />
      <line
        x1="21"
        x2="111"
        y1={WATERLINE_Y}
        y2={WATERLINE_Y}
        stroke="#1f2a5a"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
    </svg>
  )
}
