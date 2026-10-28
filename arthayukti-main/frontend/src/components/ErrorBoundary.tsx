import { Component, type ErrorInfo, type ReactNode } from 'react'
import { copy } from '../i18n/copy'

function savedLanguage(): 'en' | 'hi' {
  try {
    return window.localStorage.getItem('arthayukti.language') === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

/** Catches a screen that crashed and says so, instead of leaving a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const text = copy[savedLanguage()].common
    return (
      <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-4 p-6">
        <p role="alert" className="font-display text-[28px] font-semibold">
          {text.tryAgain}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-12 rounded-2xl bg-brand px-6 font-semibold text-white"
        >
          {text.retry}
        </button>
      </main>
    )
  }
}
