import { useEffect, useId, useState } from 'react'
import { ApiFailure, api } from '../api/client'
import { Card, CardTitle, PageHeading } from '../components/Cards'
import { PrimaryButton, SecondaryButton } from '../components/Controls'
import { Layout } from '../components/Layout'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

type Outcome = 'idle' | 'sending' | 'done' | 'invalid' | 'weak' | 'offline'

/** The token comes from the e-mailed link. It is read once, then removed from the address bar. */
function readToken(): string {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('token') ?? ''
}

/** Convenience checks only. The server decides what is acceptable. */
function problem(password: string, again: string): 'short' | 'letters' | 'mismatch' | null {
  if (password.length < 10) return 'short'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'letters'
  if (password !== again) return 'mismatch'
  return null
}

export function ResetPasswordPage({ navigate }: PageProps) {
  const { text } = useStore()
  const copy = text.reset
  const [token] = useState(readToken)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [tried, setTried] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>('idle')
  const passwordId = useId()
  const againId = useId()

  useEffect(() => {
    if (token) window.history.replaceState(null, '', `${window.location.pathname}#/reset-password`)
  }, [token])

  const found = problem(password, again)
  const message =
    found === 'short' ? copy.tooShort : found === 'letters' ? copy.needsLetterAndDigit : found === 'mismatch' ? copy.mismatch : null

  async function submit() {
    setTried(true)
    if (found) return
    setOutcome('sending')
    try {
      await api.resetPassword(token, password)
      setPassword('')
      setAgain('')
      setOutcome('done')
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation_error') setOutcome('weak')
      else if (error instanceof ApiFailure && error.code === 'offline') setOutcome('offline')
      else setOutcome('invalid')
    }
  }

  const heading = <PageHeading title={copy.title} subtitle={copy.subtitle} />

  if (!token) {
    return (
      <Layout route="reset-password" navigate={navigate} speak={copy.noLink}>
        {heading}
        <Card>
          <p role="alert">{copy.noLink}</p>
          <SecondaryButton onClick={() => navigate('home')}>{copy.home}</SecondaryButton>
        </Card>
      </Layout>
    )
  }

  if (outcome === 'done') {
    return (
      <Layout route="reset-password" navigate={navigate} speak={copy.done}>
        {heading}
        <Card>
          <CardTitle>{copy.done}</CardTitle>
          <p role="status">{copy.doneBody}</p>
          <PrimaryButton onClick={() => navigate('home')}>{copy.home}</PrimaryButton>
        </Card>
      </Layout>
    )
  }

  const field = 'min-h-14 w-full rounded-2xl border border-line bg-cream px-4'
  return (
    <Layout route="reset-password" navigate={navigate} speak={`${copy.title} ${copy.subtitle}`}>
      {heading}
      <Card>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor={passwordId}>{copy.newPassword}</label>
            <input id={passwordId} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            <p className="text-[15px] text-muted">{copy.rules}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={againId}>{copy.repeat}</label>
            <input id={againId} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
          </div>
          {tried && message ? (
            <p role="alert" className="font-semibold text-late">
              {message}
            </p>
          ) : null}
          {outcome === 'invalid' ? (
            <p role="alert" className="font-semibold text-late">
              {copy.invalidLink}
            </p>
          ) : null}
          {outcome === 'weak' ? (
            <p role="alert" className="font-semibold text-late">
              {copy.rejected}
            </p>
          ) : null}
          {outcome === 'offline' ? (
            <p role="alert" className="font-semibold text-late">
              {text.common.offline}
            </p>
          ) : null}
          <PrimaryButton disabled={outcome === 'sending'} onClick={() => void submit()}>
            {outcome === 'sending' ? text.common.loading : copy.submit}
          </PrimaryButton>
        </form>
      </Card>
    </Layout>
  )
}
