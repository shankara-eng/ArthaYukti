/**
 * ArthaYukti logo: the approved symbol beside the wordmark. The wordmark is vector outlines of Hanken Grotesk
 * (OFL) set in public/brand, with the Y in the accent colour and a diamond for the dot of the i.
 * `surface` picks the version made for that background; on a light surface the dark theme swaps in the
 * white-lettered one. `size="mark"` is the symbol alone, for tight spaces. No tagline.
 */
type Surface = 'light' | 'dark'

// Heights are set per part so the symbol and the lettering can be tuned apart.
const SIZES = {
  md: { symbol: 'h-[17px] xl:h-[18.5px]', word: 'h-5 xl:h-[22px]', gap: 'gap-2' },
  lg: { symbol: 'h-[27px]', word: 'h-8', gap: 'gap-2.5' },
}

export function Wordmark({ size = 'md', surface = 'light' }: { size?: 'md' | 'lg' | 'mark'; surface?: Surface }) {
  if (size === 'mark') return <Symbol surface={surface} className="h-[25px] w-auto" />
  const s = SIZES[size]
  const word = (kind: Surface, extra = '') => (
    <img src={`/brand/wordmark${kind === 'dark' ? '-white' : ''}.svg`} alt="" aria-hidden="true" className={`${s.word} w-auto max-w-none ${extra}`} />
  )
  return (
    <span className={`flex items-center ${s.gap}`}>
      <Symbol surface={surface} className={`${s.symbol} w-auto`} />
      {surface === 'dark' ? (
        word('dark')
      ) : (
        <>
          {word('light', 'logo-on-light')}
          {word('dark', 'logo-on-dark')}
        </>
      )}
      <span className="sr-only">ArthaYukti</span>
    </span>
  )
}

/** On a light surface the dark theme swaps in the symbol made for dark backgrounds. */
export function Symbol({ surface = 'light', className }: { surface?: Surface; className?: string }) {
  const img = (name: Surface, extra = '') => (
    <img src={`/brand/symbol-${name}.svg`} alt="" aria-hidden="true" width={66} height={64} className={`${className ?? ''} ${extra}`} />
  )
  if (surface === 'dark') return img('dark')
  return (
    <>
      {img('light', 'logo-on-light')}
      {img('dark', 'logo-on-dark')}
    </>
  )
}
