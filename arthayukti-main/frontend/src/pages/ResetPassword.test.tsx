import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { parseRoute } from '../lib/route'

const TOKEN = 'tok_' + 'a'.repeat(40)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function serve(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function fill(password: string, again = password) {
  fireEvent.change(await screen.findByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: again } })
}

beforeEach(() => {
  window.location.hash = `/reset-password?token=${TOKEN}`
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reset password screen', () => {
  it('treats the query string as part of the link, not the route name', () => {
    expect(parseRoute(`#/reset-password?token=${TOKEN}`)).toBe('reset-password')
    expect(parseRoute('#/plan?x=1')).toBe('plan')
  })

  it('opens from the e-mailed link without a plan, and removes the token from the address bar', async () => {
    const fetchMock = serve(() => json({}))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Choose a new password.' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe('#/reset-password'))
    expect(window.location.href).not.toContain(TOKEN)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the password locally before sending anything', async () => {
    const fetchMock = serve(() => json({}))
    render(<App />)
    for (const [password, again, message] of [
      ['short1', 'short1', 'at least 10 characters'],
      ['onlyletterslong', 'onlyletterslong', 'one letter and one number'],
      ['Valid-Pass-123', 'Different-Pass-1', 'not the same'],
    ] as const) {
      await fill(password, again)
      fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the token and the new password, then confirms', async () => {
    const fetchMock = serve(() => json({ message: 'Password has been reset successfully.' }))
    render(<App />)
    await fill('Fresh-Pass-12345')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByRole('heading', { name: 'Your password is changed.' })).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/auth\/password-reset\/confirm$/)
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN, new_password: 'Fresh-Pass-12345' })
  })

  it('says the link is no longer valid when the server refuses it, and keeps no success message', async () => {
    serve(() => json({ error: { code: 'http_error', message: 'Reset token is invalid or has expired.' } }, 400))
    render(<App />)
    await fill('Fresh-Pass-12345')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid any more')
    expect(screen.queryByText('Your password is changed.')).toBeNull()
  })

  it('reports a rejected password and an unreachable server differently', async () => {
    serve(() => json({ error: { code: 'validation_error', message: 'The request is invalid.' } }, 422))
    render(<App />)
    await fill('Fresh-Pass-12345')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not accepted')
    cleanup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    window.location.hash = `/reset-password?token=${TOKEN}`
    render(<App />)
    await fill('Fresh-Pass-12345')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the calculator')
  })

  it('asks for the e-mail link when opened without a token, and reads in Hindi', async () => {
    window.location.hash = '/reset-password'
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('needs the link from your reset e-mail')
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }))
    expect(await screen.findByRole('heading', { name: 'नया पासवर्ड चुनें।' })).toBeInTheDocument()
  })
})
