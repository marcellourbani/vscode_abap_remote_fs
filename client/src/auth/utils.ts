import type { AuthHttpHeaders } from "vscode-abap-remote-fs-sharedapi"

const CONTROL_CHAR_PATTERN = /[\r\n\x00-\x1f]/g

export function sanitizeHeaderValue(value: string): string {
  return value.replace(CONTROL_CHAR_PATTERN, "")
}

export function sanitizeCookie(cookie: string): string {
  return sanitizeHeaderValue(cookie).trim()
}

export function sanitizeCookies(cookies: readonly string[]): string[] {
  return cookies.map(sanitizeCookie).filter(cookie => cookie.length > 0)
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export function buildCookieHeaders(cookies: readonly string[]): AuthHttpHeaders | undefined {
  const sanitizedCookies = sanitizeCookies(cookies)
  return sanitizedCookies.length > 0 ? { Cookie: sanitizedCookies.join("; ") } : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}