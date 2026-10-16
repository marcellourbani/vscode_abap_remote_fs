import { ADTClient, session_types } from "abap-adt-api"
import { HttpClientException, type HttpClientOptions } from "abap-adt-api/build/AdtHTTP"
import {
  attachBrowserSsoCookies,
  isBrowserSsoSessionExpired,
  loginWithBrowserSsoCookies,
  onBrowserSsoAuthFailure,
  replaceBrowserSsoCookies
} from "vscode-abap-remote-fs-sharedapi"

type Reply = { status?: number; body?: string; headers?: Record<string, string | string[]> }
type Handler = (options: HttpClientOptions) => Reply | Promise<Reply>

const LOGIN_URL = "/sap/bc/adt/compatibility/graph"

function fakeTransport(handler: Handler = () => ({})) {
  const calls: HttpClientOptions[] = []
  const transport = {
    handler,
    calls,
    request: vi.fn(async (options: HttpClientOptions) => {
      calls.push({ ...options, headers: { ...options.headers } })
      const reply = await transport.handler(options)
      const loginReply = options.url === LOGIN_URL ? { "x-csrf-token": "token" } : {}
      return {
        status: reply.status ?? 200,
        statusText: "",
        body: reply.body ?? "",
        headers: { ...loginReply, ...reply.headers }
      }
    })
  }
  return transport
}

function ssoClient(cookies = ["MYSAPSSO2=ticket"]) {
  const client = new ADTClient("http://sap.test", "developer", "browser-sso-auth", "100", "EN")
  const main = fakeTransport()
  const clone = fakeTransport()
  ;(client.httpClient as any).httpclient = main
  ;(client.statelessClone.httpClient as any).httpclient = clone
  attachBrowserSsoCookies(client, cookies)
  attachBrowserSsoCookies(client.statelessClone, cookies)
  return { client, main, clone }
}

const cookieHeader = (options: HttpClientOptions) => options.headers?.Cookie

test("sends the captured cookies, follows SAP cookie updates and never sends a password", async () => {
  const { client, main } = ssoClient(["MYSAPSSO2=ticket", " SAP_SESSIONID_DEV_100=browser"])
  main.handler = options =>
    options.url === "/first"
      ? {
          headers: {
            "set-cookie": ["sap-contextid=ctx; path=/", "SAP_SESSIONID_DEV_100=; max-age=0"]
          }
        }
      : {}

  await client.httpClient.request("/first")
  await client.httpClient.request("/second")

  const [, first, second] = main.calls
  expect(first.auth).toBeUndefined()
  expect(cookieHeader(first)).toBe("MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=browser")
  expect(cookieHeader(second)).toBe("MYSAPSSO2=ticket; sap-contextid=ctx")
})

test("a new login leaves the old stateful session behind", async () => {
  const { client, main } = ssoClient()
  main.handler = () => ({ headers: { "set-cookie": ["sap-contextid=old"] } })
  await client.login()
  await client.httpClient.request("/work")
  expect(cookieHeader(main.calls.at(-1)!)).toContain("sap-contextid=old")

  await client.login()

  expect(cookieHeader(main.calls.at(-1)!)).toBe("MYSAPSSO2=ticket")
})

test("logout ends only this client's session, not the browser login", async () => {
  const { client, main } = ssoClient()

  await client.logout()

  expect(main.calls.at(-1)?.url).toBe(LOGIN_URL)
  expect(main.calls.at(-1)?.headers?.["X-sap-adt-sessiontype"]).toBe("stateless")
  expect(main.calls.some(call => call.url === "/sap/public/bc/icf/logoff")).toBe(false)
})

test("treats a login answered with an identity provider page as an expired login", async () => {
  const { client, main } = ssoClient()
  // An identity provider page carries no ADT token
  main.handler = () => ({ body: "<html>sign in</html>", headers: { "x-csrf-token": [] } })

  const error = await client.login().catch(e => e)

  expect(isBrowserSsoSessionExpired(error)).toBe(true)
  await expect(loginWithBrowserSsoCookies(client, ["MYSAPSSO2=stale"])).resolves.toBe(false)
})

test("runs one recovery and repeats a request whose old-login answer arrived after it", async () => {
  const { client, main } = ssoClient(["MYSAPSSO2=old"])
  await client.login()
  let openLateAnswer!: () => void
  const lateAnswer = new Promise<void>(resolve => (openLateAnswer = resolve))
  main.handler = async options => {
    if (options.url === LOGIN_URL || cookieHeader(options) !== "MYSAPSSO2=old") return {}
    if (options.url === "/late") await lateAnswer
    return { status: 401 }
  }
  let finishRecovery!: () => void
  const recover = vi.fn(async () => {
    await new Promise<void>(resolve => (finishRecovery = resolve))
    replaceBrowserSsoCookies(client, ["MYSAPSSO2=new"])
    return true
  })
  onBrowserSsoAuthFailure(client, recover)

  const first = client.httpClient.request("/first")
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
  const late = client.httpClient.request("/late")
  await vi.waitFor(() => expect(main.calls.some(call => call.url === "/late")).toBe(true))
  finishRecovery()
  await expect(first).resolves.toHaveProperty("status", 200)
  openLateAnswer()

  await expect(late).resolves.toHaveProperty("status", 200)
  expect(recover).toHaveBeenCalledOnce()
  expect(cookieHeader(main.calls.at(-1)!)).toBe("MYSAPSSO2=new")
})

test("does not repeat a stateful call after its session was replaced by a stateless one", async () => {
  const { client, main } = ssoClient()
  client.stateful = session_types.stateful
  await client.login()
  main.handler = options => (options.url === "/lock" ? { status: 401 } : {})
  onBrowserSsoAuthFailure(client, async () => {
    client.stateful = session_types.stateless
    replaceBrowserSsoCookies(client, ["MYSAPSSO2=new"])
    return true
  })

  await expect(client.httpClient.request("/lock", { method: "POST" })).rejects.toBeDefined()

  expect(main.calls.filter(call => call.url === "/lock")).toHaveLength(1)
})

test("leaves errors that are not login failures alone", async () => {
  const { client, main } = ssoClient()
  await client.login()
  main.handler = () => ({ status: 404 })
  const recover = vi.fn(async () => true)
  onBrowserSsoAuthFailure(client, recover)

  await expect(client.httpClient.request("/missing")).rejects.toBeDefined()

  expect(recover).not.toHaveBeenCalled()
})

test("logs both clients in with new cookies and reports a rejected login", async () => {
  const { client, main, clone } = ssoClient()

  await expect(loginWithBrowserSsoCookies(client, ["MYSAPSSO2=fresh"])).resolves.toBe(true)
  expect(cookieHeader(main.calls.at(-1)!)).toBe("MYSAPSSO2=fresh")
  expect(cookieHeader(clone.calls.at(-1)!)).toBe("MYSAPSSO2=fresh")

  main.handler = () => ({ status: 401 })
  await expect(loginWithBrowserSsoCookies(client, ["MYSAPSSO2=stale"])).resolves.toBe(false)
  await expect(loginWithBrowserSsoCookies(client, [""])).resolves.toBe(false)

  main.handler = () => ({ status: 500, body: "server down" })
  await expect(loginWithBrowserSsoCookies(client, ["MYSAPSSO2=fresh"])).rejects.toBeDefined()
})

test("recognises the SAP answers that mean the login or session ended", () => {
  const adt = (err: number, message = "") =>
    Object.assign(new Error(message), { typeID: Symbol.for("ADT EXCEPTION"), err })
  expect(isBrowserSsoSessionExpired(adt(401))).toBe(true)
  expect(isBrowserSsoSessionExpired(adt(400, "Session timed out"))).toBe(true)
  expect(isBrowserSsoSessionExpired({ typeID: Symbol.for("BAD CSRF") })).toBe(true)
  expect(isBrowserSsoSessionExpired(adt(400, "Invalid request"))).toBe(false)
  expect(isBrowserSsoSessionExpired(adt(404))).toBe(false)
  expect(isBrowserSsoSessionExpired(new Error("network down"))).toBe(false)
})

test("recognises a session time-out that SAP reports with an HTML page", async () => {
  const client = new ADTClient("http://sap.test", "developer", "browser-sso-auth", "100", "EN")
  ;(client.httpClient as any).httpclient = {
    request: async (options: HttpClientOptions) => {
      if (options.url === LOGIN_URL)
        return { status: 200, statusText: "OK", body: "", headers: { "x-csrf-token": "token" } }
      const response = {
        status: 400,
        statusText: "Session timed out",
        body: "<html><body>Logon expired</body></html>",
        headers: {}
      }
      throw new HttpClientException("Request failed", undefined, 400, undefined, options, response)
    }
  }

  const error = await client.httpClient.request("/sap/bc/adt/discovery").catch(e => e)

  expect(isBrowserSsoSessionExpired(error)).toBe(true)
})
