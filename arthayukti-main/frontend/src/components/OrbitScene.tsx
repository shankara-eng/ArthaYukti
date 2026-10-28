import { useEffect, useRef, useState } from 'react'

interface OrbitSceneProps {
  /** How many layers have been revealed, 0 to `layers`. Decorative: it shows progress, not money. */
  revealed?: number
  layers?: number
  className?: string
}

function supports3d(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  return CSS.supports('transform-style', 'preserve-3d')
}

function allowsPointerMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return (
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * A slowly turning set of orbits with stacked translucent slabs, one more revealed for each
 * section the person completes. It is pure decoration: it never shows calculated figures, never
 * takes pointer events, and falls back to flat rings where CSS 3D is unavailable.
 */
export function OrbitScene({ revealed = 0, layers = 6, className }: OrbitSceneProps) {
  const frame = useRef<HTMLDivElement>(null)
  const [flat] = useState(() => !supports3d())

  // A small tilt that follows the pointer, only on devices with a mouse and no reduced-motion setting.
  useEffect(() => {
    const node = frame.current
    if (!node || flat || !allowsPointerMotion()) return
    const onMove = (event: PointerEvent) => {
      const x = event.clientX / window.innerWidth - 0.5
      const y = event.clientY / window.innerHeight - 0.5
      node.style.setProperty('--tilt-x', `${(-y * 8).toFixed(2)}deg`)
      node.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [flat])

  const shown = Math.min(Math.max(revealed, 0), layers)
  return (
    <div
      ref={frame}
      aria-hidden="true"
      className={`pointer-events-none relative aspect-square select-none ${className ?? ''}`}
      style={{ perspective: '900px' }}
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: flat ? 'flat' : 'preserve-3d',
          transform: 'rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))',
          transition: 'transform 300ms ease-out',
        }}
      >
        {[0, 1, 2].map((ring) => (
          <div
            key={ring}
            className="orbit-ring"
            style={{
              inset: `${ring * 11}%`,
              animationDuration: `${28 + ring * 12}s`,
              animationDirection: ring % 2 ? 'reverse' : 'normal',
              opacity: 0.85 - ring * 0.2,
            }}
          />
        ))}
        <div className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-glow shadow-[0_0_30px_8px_color-mix(in_srgb,var(--color-glow)_45%,transparent)]" />
        {Array.from({ length: layers }, (_, index) => (
          <div
            key={index}
            className="orbit-slab"
            style={{
              opacity: index < shown ? 1 : 0.12,
              transform: flat
                ? `translateY(${(layers - index) * -6}px)`
                : `rotateX(62deg) translateZ(${index * 22 - layers * 9}px)`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
