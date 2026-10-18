import { ADTClient, session_types } from "abap-adt-api"
import { HttpClientException, type HttpClientOptions } from "abap-adt-api/build/AdtHTTP"
import { createBrowserSsoClientOptions } from "vscode-abap-remote-fs-sharedapi"

const LOGIN_URL = "/sap/bc/adt/compatibility/graph"

test("renews a stateful session without replaying the failed request", async () => {
  const renew = vi.fn(async () => ({ cookieHeader: "MYSAPSSO2=fresh", replace: true as const }))
  const onStatefulFailure = vi.fn((client: { stateful: session_types }) => {
    client.stateful = session_types.stateless
  })
  const options = createBrowserSsoClientOptions("dev100", renew, onStatefulFailure)
  const client = new ADTClient(
    "https://sap.example.com",
    "developer",
    "browser-sso",
    "100",
    "EN",
    options
  )
  const transport = (client.httpClient as any).httpclient
  const writes: HttpClientOptions[] = []
  transport.request = vi.fn(async (request: HttpClientOptions) => {
    if (request.url === LOGIN_URL)
      return { status: 200, statusText: "OK", body: "", headers: { "x-csrf-token": "token" } }
    writes.push(request)
    throw new HttpClientException("Unauthorized", undefined, 401, undefined, request, {
      status: 401,
      statusText: "Unauthorized",
      body: "",
      headers: {}
    })
  })
  await client.login()
  renew.mockClear()
  client.stateful = session_types.stateful

  await expect(client.httpClient.request("/save", { method: "POST" })).rejects.toBeDefined()

  expect(writes).toHaveLength(1)
  expect(renew).toHaveBeenCalledOnce()
  expect(renew).toHaveBeenCalledWith(expect.objectContaining({ reason: "expired" }))
  expect(onStatefulFailure).toHaveBeenCalledOnce()
  expect(client.stateful).toBe(session_types.stateless)
})

test("does not renew a session for a non-authentication failure", async () => {
  const renew = vi.fn(async () => ({ cookieHeader: "MYSAPSSO2=fresh", replace: true as const }))
  const client = new ADTClient(
    "https://sap.example.com",
    "developer",
    "browser-sso",
    "100",
    "EN",
    createBrowserSsoClientOptions("dev100", renew)
  )
  const transport = (client.httpClient as any).httpclient
  transport.request = vi.fn(async (request: HttpClientOptions) => {
    if (request.url === LOGIN_URL)
      return { status: 200, statusText: "OK", body: "", headers: { "x-csrf-token": "token" } }
    throw new HttpClientException("Not found", undefined, 404, undefined, request, {
      status: 404,
      statusText: "Not Found",
      body: "",
      headers: {}
    })
  })
  await client.login()
  renew.mockClear()

  await expect(client.httpClient.request("/missing")).rejects.toBeDefined()
  expect(renew).not.toHaveBeenCalled()
})
