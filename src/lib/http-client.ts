/**
 * Browser-side calls into our own API.
 *
 * Every route answers errors in one shape (`src/lib/http.ts`: `{ error: { code, message } }`),
 * so unwrapping it belongs in one place too. Without this, each component re-implements
 * "read the body, fall back to a generic string" and they drift — one shows the server's
 * message, the next shows "Request failed" for the same 400.
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

interface ApiErrorShape {
  error?: { code?: unknown; message?: unknown }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Pulls `error.message` / `error.code` out of a body that may be anything at all. */
function readErrorFields(body: unknown): { code: string; message: string | null } {
  if (!isRecord(body)) return { code: 'request_failed', message: null }

  const { error } = body as ApiErrorShape
  if (!isRecord(error)) return { code: 'request_failed', message: null }

  return {
    code: typeof error.code === 'string' ? error.code : 'request_failed',
    message: typeof error.message === 'string' ? error.message : null,
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  // A 204 or an HTML error page must not blow up as a JSON parse error: the status is
  // what decides success, and the body is best-effort context.
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const { code, message } = readErrorFields(body)
    throw new ApiRequestError(message ?? `Request failed (${response.status})`, response.status, code)
  }

  return body as T
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET', headers: { accept: 'application/json' } })
}

export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function patchJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
