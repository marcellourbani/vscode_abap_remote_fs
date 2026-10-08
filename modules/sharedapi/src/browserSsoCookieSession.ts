import { isAdtError, isCsrfError, isHttpError, type ADTClient } from "abap-adt-api"
import { isHttpClientException, type HttpClient } from "abap-adt-api/build/AdtHTTP"

const FETCH_CSRF_TOKEN = "fetch"
const LOGOFF_URL = "/sap/public/bc/icf/logoff"
const SESSION_URL = "/sap/bc/adt/compatibility/graph"

type Recover = (error: unknown) => Promise<boolean>

interface CookieSession {
  version: number
  replace: (cookies: readonly string[]) => void
  recover?: Recover
}

const sessions = new WeakMap<ADTClient, CookieSession>()
// Keyed by callback so a client and its stateless clone share one recovery
const recoveries = new WeakMap<Recover, Promise<boolean>>()

function startRecovery(recover: Recover, error: unknown) {
  let pending = recoveries.get(recover)
  if (!pending) {
    pending = recover(error).finally(() => recoveries.delete(recover))
    recoveries.set(recover, pending)
  }
  return pending
}

function sessionOf(client: ADTClient) {
  const session = sessions.get(client)
  if (!session) throw new Error("Browser SSO cookies were never attached to this client")
  return session
}

// SAP sends "Session timed out" as the HTTP status text, which some errors keep only on the response
const statusText = (error: unknown) => {
  const failure = error as { response?: { statusText?: unknown }; parent?: unknown } | undefined
  const parent = failure?.parent as { response?: { statusText?: unknown } } | undefined
  return String(parent?.response?.statusText ?? failure?.response?.statusText ?? "")
}

const loginRejected = (status: unknown, error: { message: string }) =>
  status === 401 ||
  (status === 400 && /Session.*timed.*out/i.test(`${error.message} ${statusText(error)}`))

/** SAP refused the request because the login or session ended, so it did not run it. */
export function isBrowserSsoSessionExpired(error: unknown): boolean {
  if (isCsrfError(error)) return true
  if (isHttpError(error)) return loginRejected(error.status, error)
  return isAdtError(error) && loginRejected(error.err, error)
}

/** Swap a client's Browser SSO cookies for a new set; the next request starts a new SAP session. */
export function replaceBrowserSsoCookies(client: ADTClient, capturedCookies: readonly string[]) {
  sessionOf(client).replace(capturedCookies)
}

export function onBrowserSsoAuthFailure(client: ADTClient, recover: Recover) {
  sessionOf(client).recover = recover
}

/** Log both clients in with these cookies. False when SAP rejects them. */
export async function loginWithBrowserSsoCookies(client: ADTClient, cookies: readonly string[]) {
  if (!cookies.some(cookie => cookie.includes("="))) return false
  replaceBrowserSsoCookies(client, cookies)
  replaceBrowserSsoCookies(client.statelessClone, cookies)
  try {
    await client.login()
    await client.statelessClone.login()
    return true
  } catch (error) {
    if (isBrowserSsoSessionExpired(error)) return false
    throw error
  }
}

function updateCookies(
  cookies: Map<string, string>,
  values: readonly string[],
  fromResponse = false
) {
  for (const rawCookie of values) {
    const cookie = rawCookie.replace(/[\r\n\x00-\x1f]/g, "").trim()
    const [pair, ...attributes] = cookie.split(";")
    const separator = pair.indexOf("=")
    if (separator < 1) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1)
    if (
      fromResponse &&
      (!value ||
        attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute)) ||
        attributes.some(attribute => {
          const expires = /^\s*expires\s*=\s*(.*)$/i.exec(attribute)?.[1]
          return expires !== undefined && Date.parse(expires) <= Date.now()
        }))
    ) {
      cookies.delete(name)
    } else {
      cookies.set(name, `${name}=${value}`)
    }
  }
}

const setCookieValues = (header: string | string[] | undefined) =>
  header === undefined ? [] : Array.isArray(header) ? header : [header]

// Identifies one stateful SAP session; the login cookies around it outlive it
const dropSessionContext = (cookies: Map<string, string>) => {
  for (const name of cookies.keys()) if (/^sap-contextid$/i.test(name)) cookies.delete(name)
}

export function attachBrowserSsoCookies(client: ADTClient, capturedCookies: readonly string[]) {
  const http = client.httpClient
  let cookies = new Map<string, string>()
  updateCookies(cookies, capturedCookies)

  const session: CookieSession = {
    version: 0,
    replace: values => {
      cookies = new Map()
      updateCookies(cookies, values)
      session.version++
      http.csrfToken = FETCH_CSRF_TOKEN
    }
  }
  sessions.set(client, session)

  // The library logs in again after a CSRF failure; that must not rejoin the old stateful session
  const login = http.login.bind(http)
  http.login = async () => {
    dropSessionContext(cookies)
    const result = await login()
    // An identity provider answers an expired login with its own page instead of an error
    if (!http.loggedin)
      throw Object.assign(new Error("SAP did not accept the Browser SSO login"), {
        typeID: Symbol.for("BAD CSRF")
      })
    return result
  }

  const transport = (http as unknown as { httpclient: HttpClient }).httpclient
  const send = transport.request.bind(transport)
  transport.request = async options => {
    delete options.auth
    // The cookies came from the user's browser; a logoff would end that login everywhere
    if (options.url === LOGOFF_URL) options.url = SESSION_URL
    const header = [...cookies.values()].join("; ")
    const headers = { ...options.headers }
    if (header) headers.Cookie = header
    else delete headers.Cookie
    options.headers = headers
    try {
      const response = await send(options)
      updateCookies(cookies, setCookieValues(response.headers["set-cookie"]), true)
      return response
    } catch (error) {
      if (isHttpClientException(error))
        updateCookies(cookies, setCookieValues(error.response?.headers["set-cookie"]), true)
      throw error
    }
  }

  const request = http.request.bind(http)
  http.request = async (url, options) => {
    const version = session.version
    const wasStateful = http.isStateful
    try {
      return await request(url, options)
    } catch (error) {
      if (!isBrowserSsoSessionExpired(error)) throw error
      const { recover } = session
      const running = recover && recoveries.get(recover)
      const renewed = running
        ? await running
        : session.version !== version || (!!recover && (await startRecovery(recover, error)))
      // Repeating a stateful call in the stateless session that replaced it would lose its locks
      if (!renewed || (wasStateful && !http.isStateful)) throw error
      return request(url, options)
    }
  }
}
