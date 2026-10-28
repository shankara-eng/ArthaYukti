import { vi } from 'vitest'

type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const unauthorized = () => json({ error: { code: 'unauthorized', message: 'Token has expired or is invalid' } }, 401)

export interface Call {
  method: string
  path: string
  body: unknown
  auth: string | null
}

/**
 * Stubs fetch with handlers keyed "METHOD /path" (the path after /api/v1). Anything not listed
 * is a 404, so a screen that calls an endpoint the test did not expect fails loudly.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(/^.*\/api\/v1/, '').split('?')[0]
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    let body: unknown = undefined
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    calls.push({ method, path, body, auth: headers.get('Authorization') })
    const handler = handlers[`${method} ${path}`]
    return handler ? handler(init, url) : json({ error: { code: 'not_found', message: 'no such route in the test' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}
