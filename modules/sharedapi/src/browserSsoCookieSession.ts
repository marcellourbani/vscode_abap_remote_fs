import {
  ADTClient,
  AdtSessionFailure,
  fromException,
  isAuthenticationFailure,
  isCsrfError,
  type AdtCookieImport,
  type AdtSessionProvider,
  type ClientOptions
} from "abap-adt-api"
import type { AdtExtension, AdtNext } from "abap-adt-api/build/AdtExtensions"
import type { AdtHTTP, HttpClient } from "abap-adt-api/build/AdtHTTP"

export async function renewBrowserSsoCookies(
  client: AdtHTTP,
  id: string,
  cachedCookieHeader: string | undefined,
  capture: () => Promise<readonly string[]>,
  options: ClientOptions = {}
): Promise<{ cookieHeader: string; replace: true } | undefined> {
  if (!cachedCookieHeader) {
    const cookies = await capture()
    return cookies.length ? { cookieHeader: cookies.join("; "), replace: true } : undefined
  }

  const provider: AdtSessionProvider = {
    id: `${id}:cookie-probe`,
    logoutMode: "local-only",
    async renew({ reason }) {
      if (reason === "csrf") return undefined
      if (reason === "initial-login") return { cookieHeader: cachedCookieHeader, replace: true }
      const cookies = await capture()
      return cookies.length ? { cookieHeader: cookies.join("; "), replace: true } : undefined
    }
  }
  const transport = (client as unknown as { httpclient: HttpClient }).httpclient
  const probe = new ADTClient(
    transport,
    client.username,
    "browser-sso",
    client.client,
    client.language,
    { ...options, session: provider }
  )
  try {
    await probe.login()
    const cookieHeader = probe.session.cookieHeader()
    return cookieHeader ? { cookieHeader, replace: true } : undefined
  } finally {
    await probe.logout().catch(() => undefined)
  }
}

export function createBrowserSsoClientOptions(
  id: string,
  renew: AdtSessionProvider["renew"],
  onStatefulFailure?: (client: Pick<AdtHTTP, "stateful">) => void
) {
  const session: AdtSessionProvider = { id, logoutMode: "local-only", renew }
  const extensions: AdtExtension[] = [
    {
      id: `${id}:stateful-session-recovery`,
      async handle(context, next: AdtNext) {
        try {
          return await next()
        } catch (error) {
          if (!context.isStateful || !isAuthenticationFailure(error)) throw error
          const exception = fromException(error)
          const reason = isCsrfError(exception) ? "csrf" : "expired"
          onStatefulFailure?.(context.client)
          await context.client.renewSession(reason, error)
          throw new AdtSessionFailure(reason, true, exception)
        }
      }
    }
  ]
  return {
    session,
    extensions
  }
}
