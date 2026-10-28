import { useState } from 'react'
import { Layout } from '../components/Layout'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { householdName } from '../lib/household'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

export function Home({ navigate }: PageProps) {
  const { text, sample, plan, source, startOwn, loadExample, startOver, exampleLoading, sampleError } =
    useStore()
  const { home } = text
  const [confirmingReset, setConfirmingReset] = useState(false)

  return (
    <Layout route="home" navigate={navigate} speak={`${home.tagline} ${home.hook}`}>
      <section className="stage relative overflow-hidden rounded-[19px] px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-20">
        <Ripples />
        <div className="relative flex max-w-[620px] flex-col gap-6">
          <p className="text-[15px] font-semibold tracking-wide text-glow uppercase">
            {plan ? home.forFamily(householdName(text, sample, plan)) : home.forEveryone}
          </p>
          <h1 className="font-display text-[42px] leading-[1.05] font-semibold tracking-tight sm:text-[56px] lg:text-[68px]">
            {home.tagline}
          </h1>
          <p className="max-w-[52ch] text-[18px] text-muted">{home.hook}</p>

          <div className="flex max-w-[460px] flex-col gap-3 pt-2">
            {plan ? (
              <>
                <PrimaryButton onClick={() => navigate(source === 'own' ? 'money-in' : 'plan')}>
                  {home.continueMine}
                </PrimaryButton>
                {confirmingReset ? (
                  <div role="alertdialog" aria-label={home.startOver} className="flex flex-col gap-2">
                    <p className="font-semibold">{home.startOverWarn}</p>
                    <SecondaryButton
                      icon="forward"
                      onClick={() => {
                        setConfirmingReset(false)
                        startOver()
                      }}
                    >
                      {home.startOver}
                    </SecondaryButton>
                    <SecondaryButton icon="back" onClick={() => setConfirmingReset(false)}>
                      {text.tradeoffs.cancel}
                    </SecondaryButton>
                  </div>
                ) : (
                  <SecondaryButton icon="forward" onClick={() => setConfirmingReset(true)}>
                    {home.startOver}
                  </SecondaryButton>
                )}
              </>
            ) : (
              <>
                <PrimaryButton
                  disabled={exampleLoading}
                  onClick={() => {
                    startOwn()
                    navigate('money-in')
                  }}
                >
                  {home.startMine}
                </PrimaryButton>
                <SecondaryButton
                  icon="forward"
                  disabled={exampleLoading}
                  onClick={async () => {
                    if (await loadExample()) navigate('plan')
                  }}
                >
                  {exampleLoading ? text.common.loading : home.tryExample}
                </SecondaryButton>
                <p className="text-[14px] text-muted">{home.exampleNote}</p>
                {sampleError ? (
                  <p role="alert" className="font-semibold text-late">
                    {home.exampleFailed}
                  </p>
                ) : null}
              </>
            )}
            <p className="text-[14px] text-muted">{home.notSaved}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="can-title" className="flex flex-col gap-5">
        <h2 id="can-title" className="font-display text-[28px] leading-tight font-semibold">
          {home.canTitle}
        </h2>
        <ol className="grid gap-x-10 gap-y-6 md:grid-cols-3">
          {home.can.map((item, index) => (
            <li key={item.title} className="flex flex-col gap-2 border-t-2 border-ink pt-4">
              <span className="font-display text-[15px] text-muted" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="font-display text-[22px] leading-snug font-semibold">{item.title}</h3>
              <p className="text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="soon-title" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6">
        <h2 id="soon-title" className="text-[14px] font-semibold tracking-wide text-muted uppercase">
          {home.soonTitle}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {home.soon.map((item) => (
            <li key={item} className="rounded-xl border border-dashed border-line px-3 py-1 text-[14px] text-muted">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  )
}

/** Decorative rings spreading from a glow. They carry no data. */
function Ripples() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 400"
      className="pointer-events-none absolute -top-10 -right-24 hidden size-[520px] opacity-80 sm:block lg:-right-10"
      fill="none"
    >
      <circle cx="260" cy="200" r="14" fill="var(--color-glow)" />
      <circle cx="260" cy="200" r="48" stroke="var(--color-glow)" strokeOpacity="0.55" strokeWidth="1.5" />
      <circle cx="260" cy="200" r="94" stroke="var(--color-glow)" strokeOpacity="0.32" strokeWidth="1.5" />
      <circle cx="260" cy="200" r="148" stroke="var(--color-glow)" strokeOpacity="0.18" strokeWidth="1.5" />
      <circle cx="260" cy="200" r="206" stroke="var(--color-glow)" strokeOpacity="0.09" strokeWidth="1.5" />
      <circle cx="308" cy="152" r="5" fill="var(--color-mint)" />
      <circle cx="166" cy="236" r="5" fill="var(--color-late)" />
      <circle cx="352" cy="262" r="5" fill="var(--color-ink)" fillOpacity="0.7" />
    </svg>
  )
}
