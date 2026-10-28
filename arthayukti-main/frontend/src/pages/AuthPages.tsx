import { useState } from 'react'
import { ApiFailure, api } from '../api/client'
import { AuthFrame } from '../components/AuthFrame'
import { CheckField, FormError, PasswordField, SelectField, TextField } from '../components/forms'
import type { Route } from '../lib/route'
import { validNewPassword, validEmail } from '../lib/validation'
import { useAuth } from '../state/useAuth'
import { useShellCopy } from '../state/useShellCopy'
import { useStore } from '../state/useStore'
import type { PageProps } from './types'

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="min-h-14 w-full rounded-xl bg-brand px-6 text-[17px] font-semibold text-white transition-opacity disabled:opacity-60 motion-reduce:transition-none"
    >
      {children}
    </button>
  )
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-[36px] leading-[1.1] font-semibold tracking-tight">{title}</h1>
      <p className="text-muted">{subtitle}</p>
    </div>
  )
}

function Link({ to, navigate, children }: { to: Route; navigate: PageProps['navigate']; children: string }) {
  return (
    <button type="button" onClick={() => navigate(to)} className="font-semibold underline underline-offset-4">
      {children}
    </button>
  )
}

function failureText(error: unknown, c: ReturnType<typeof useShellCopy>['auth'], fallback: string): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'offline') return c.offline
    if (error.status === 429) return c.slow
    if (error.status === 403) return error.message || 'Account is disabled.'
  }
  return fallback
}

export function LoginPage({ navigate }: PageProps) {
  const c = useShellCopy().auth
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const emailError = tried && !validEmail(email) ? c.needEmail : null
  const passwordError = tried && password === '' ? c.needPassword : null

  async function submit() {
    setTried(true)
    setFailure(null)
    if (!validEmail(email) || password === '') return
    setBusy(true)
    try {
      await auth.login(email.trim(), password)
      navigate('dashboard')
    } catch (error) {
      setFailure(failureText(error, c, error instanceof ApiFailure && error.status === 401 ? c.wrong : c.offline))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame revealed={2}>
      <Heading title={c.loginTitle} subtitle={c.loginSubtitle} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {auth.notice === 'expired' && !failure ? (
          <p role="status" className="rounded-xl bg-sand px-4 py-3 text-[15px] font-semibold">
            {c.expired}
          </p>
        ) : null}
        <TextField label={c.email} type="email" value={email} onChange={setEmail} autoComplete="email" error={emailError} />
        <PasswordField
          label={c.password}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          showLabel={c.show}
          hideLabel={c.hide}
          error={passwordError}
        />
        {failure ? <FormError>{failure}</FormError> : null}
        <SubmitButton busy={busy}>{busy ? c.signingIn : c.signIn}</SubmitButton>
      </form>
      <div className="flex flex-col gap-2 text-[15px]">
        <Link to="forgot-password" navigate={navigate}>
          {c.forgot}
        </Link>
        <p>
          {c.noAccount}{' '}
          <Link to="signup" navigate={navigate}>
            {c.createAccount}
          </Link>
        </p>
        <Link to="home" navigate={navigate}>
          {c.explore}
        </Link>
      </div>
    </AuthFrame>
  )
}

export function SignupPage({ navigate }: PageProps) {
  const c = useShellCopy().auth
  const auth = useAuth()
  const { language, setLanguage } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [consent, setConsent] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const passwordProblem = validNewPassword(password)
  const passwordError =
    tried && passwordProblem === 'short'
      ? c.tooShort
      : tried && passwordProblem === 'letters'
        ? c.needsLetterAndDigit
        : null
  const againError = tried && !passwordProblem && password !== again ? c.mismatch : null

  async function submit() {
    setTried(true)
    setFailure(null)
    if (!validEmail(email) || passwordProblem || password !== again || !consent) return
    setBusy(true)
    try {
      await auth.signup(email.trim(), password, name.trim())
      navigate('dashboard')
    } catch (error) {
      setFailure(failureText(error, c, error instanceof ApiFailure && error.status === 422 ? c.passwordRules : c.createFailed))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame revealed={3} sceneOnMobile>
      <Heading title={c.signupTitle} subtitle={c.signupSubtitle} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField label={c.name} hint={c.nameHint} value={name} onChange={setName} autoComplete="name" maxLength={80} />
        <TextField label={c.email} type="email" value={email} onChange={setEmail} autoComplete="email" error={tried && !validEmail(email) ? c.needEmail : null} />
        <PasswordField
          label={c.password}
          hint={c.passwordRules}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showLabel={c.show}
          hideLabel={c.hide}
          error={passwordError}
        />
        <PasswordField
          label={c.confirm}
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          showLabel={c.show}
          hideLabel={c.hide}
          error={againError}
        />
        <SelectField
          label={c.language}
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
        />
        <CheckField label={c.consent} checked={consent} onChange={setConsent} error={tried && !consent ? c.consentRequired : null} />
        {failure ? <FormError>{failure}</FormError> : null}
        <SubmitButton busy={busy}>{busy ? c.creating : c.create}</SubmitButton>
      </form>
      <p className="text-[15px]">
        {c.haveAccount}{' '}
        <Link to="login" navigate={navigate}>
          {c.signInLink}
        </Link>
      </p>
    </AuthFrame>
  )
}

export function ForgotPasswordPage({ navigate }: PageProps) {
  const c = useShellCopy().auth
  const [email, setEmail] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function submit() {
    setTried(true)
    setFailure(null)
    if (!validEmail(email)) return
    setBusy(true)
    try {
      await api.requestPasswordReset(email.trim())
      setSent(true)
    } catch (error) {
      setFailure(
        failureText(error, c, error instanceof ApiFailure && error.status === 503 ? c.unavailable : c.offline),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame revealed={1}>
      <Heading title={c.forgotTitle} subtitle={c.forgotSubtitle} />
      {sent ? (
        <p role="status" className="rounded-xl bg-sage px-4 py-3 font-semibold">
          {c.sent}
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <TextField label={c.email} type="email" value={email} onChange={setEmail} autoComplete="email" error={tried && !validEmail(email) ? c.needEmail : null} />
          {failure ? <FormError>{failure}</FormError> : null}
          <SubmitButton busy={busy}>{busy ? c.sending : c.sendLink}</SubmitButton>
        </form>
      )}
      <Link to="login" navigate={navigate}>
        {c.backToSignIn}
      </Link>
    </AuthFrame>
  )
}
