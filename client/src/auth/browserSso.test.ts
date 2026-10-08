vi.mock("vscode", () => ({
  CancellationError: class CancellationError extends Error {},
  Uri: { parse: vi.fn((url: string) => ({ toString: () => url })) },
  env: { openExternal: vi.fn().mockResolvedValue(true) },
  window: { showInformationMessage: vi.fn() }
}))

vi.mock("../config", () => ({ formatKey: (id: string) => id.toLowerCase() }))

vi.mock("../lib", () => ({
  PasswordVault: { get: vi.fn() },
  log: Object.assign(vi.fn(), { debug: vi.fn() })
}))

import * as vscode from "vscode"
import { ADTClient } from "abap-adt-api"
import {
  attachBrowserSsoCookies,
  onBrowserSsoAuthFailure,
  replaceBrowserSsoCookies
} from "vscode-abap-remote-fs-sharedapi"
import {
  HttpClientException,
  type HttpClientOptions,
  type HttpClientResponse
} from "abap-adt-api/build/AdtHTTP"
import { PasswordVault } from "../lib"
import {
  buildBrowserSsoAuth,
  cancelBrowserSsoCapture,
  getSsoCookies,
  startCookieCaptureServer,
  storeSsoCookies
} from "./browserSso"

describe("Browser SSO ADT cookies", () => {
  test("repeats reads and writes that SAP refused because the login expired", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const transport = (client.httpClient as any).httpclient
    let renewed = false
    transport.request = vi.fn(async (options: HttpClientOptions) => {
      if (options.url === "/sap/bc/adt/compatibility/graph")
        return { status: 200, statusText: "OK", body: "", headers: { "x-csrf-token": "token" } }
      if (renewed)
        return { status: 200, statusText: "OK", body: options.method ?? "GET", headers: {} }
      throw new HttpClientException("Unauthorized", undefined, 401, undefined, options, {
        status: 401,
        statusText: "Unauthorized",
        body: "",
        headers: {}
      })
    })
    attachBrowserSsoCookies(client, ["MYSAPSSO2=expired"])
    const recover = vi.fn(async () => {
      renewed = true
      replaceBrowserSsoCookies(client, ["MYSAPSSO2=fresh"])
      return true
    })
    onBrowserSsoAuthFailure(client, recover)

    expect((await client.httpClient.request("/sap/bc/adt/discovery")).body).toBe("GET")
    renewed = false
    expect((await client.httpClient.request("/sap/bc/adt/save", { method: "POST" })).body).toBe(
      "POST"
    )
    expect(recover).toHaveBeenCalledTimes(2)
  })

  test("reports one failed ADT request after the library's login attempt", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const transport = (client.httpClient as any).httpclient
    transport.request = vi.fn(async (options: HttpClientOptions) => {
      expect(options.auth).toBeUndefined()
      throw new HttpClientException("Unauthorized", undefined, 401, undefined, options, {
        status: 401,
        statusText: "Unauthorized",
        body: "",
        headers: {}
      })
    })
    attachBrowserSsoCookies(client, ["MYSAPSSO2=expired"])
    const recover = vi.fn().mockResolvedValue(undefined)
    onBrowserSsoAuthFailure(client, recover)

    await expect(client.httpClient.request("/sap/bc/adt/discovery")).rejects.toThrow()
    expect(recover).toHaveBeenCalledOnce()
  })

  test("follows SAP session rotation through a CSRF relogin without replacing the SSO ticket", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const clone = client.statelessClone
    const sent: string[] = []
    let logins = 0
    let posts = 0
    const transport = (client.httpClient as any).httpclient
    transport.request = vi.fn(async (options: HttpClientOptions): Promise<HttpClientResponse> => {
      expect(options.auth).toBeUndefined()
      sent.push(options.headers?.Cookie ?? "")
      if (options.url === "/sap/bc/adt/compatibility/graph") {
        logins++
        return {
          status: 200,
          statusText: "OK",
          body: "",
          headers: {
            "x-csrf-token": "token",
            "set-cookie": [`SAP_SESSIONID_DEV_100=session-${logins}; Path=/`]
          }
        }
      }
      posts++
      if (posts === 1)
        throw new HttpClientException("Forbidden", undefined, 403, undefined, options, {
          status: 403,
          statusText: "Forbidden",
          body: "CSRF validation failed",
          headers: { "set-cookie": ["SAP_SESSIONID_DEV_100=failed-request; Path=/"] }
        })
      return { status: 200, statusText: "OK", body: "done", headers: {} }
    })
    const cloneTransport = (clone.httpClient as any).httpclient
    const cloneSent: string[] = []
    cloneTransport.request = vi.fn(async (options: HttpClientOptions) => {
      expect(options.auth).toBeUndefined()
      cloneSent.push(options.headers?.Cookie ?? "")
      return {
        status: 200,
        statusText: "OK",
        body: "",
        headers: { "x-csrf-token": "token", "set-cookie": ["SAP_SESSIONID_DEV_100=clone; Path=/"] }
      }
    })

    attachBrowserSsoCookies(client, ["MYSAPSSO2=ticket", "SAP_SESSIONID_DEV_100=old"])
    attachBrowserSsoCookies(clone, ["MYSAPSSO2=ticket", "SAP_SESSIONID_DEV_100=old"])
    await client.login()
    await clone.login()
    await client.httpClient.request("/sap/bc/adt/repository/nodestructure", { method: "POST" })

    expect(sent).toEqual([
      "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=old",
      "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=session-1",
      "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=failed-request",
      "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=session-2"
    ])
    expect(cloneSent).toEqual(["MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=old"])
    await clone.httpClient.request("/sap/bc/adt/discovery")
    expect(cloneSent[1]).toBe("MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=clone")
  })

  test("removes a server-expired session cookie", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const sent: string[] = []
    const transport = (client.httpClient as any).httpclient
    transport.request = vi.fn(async (options: HttpClientOptions) => {
      expect(options.auth).toBeUndefined()
      sent.push(options.headers?.Cookie ?? "")
      return {
        status: 200,
        statusText: "OK",
        body: "",
        headers: {
          "x-csrf-token": "token",
          "set-cookie": ["SAP_SESSIONID_DEV_100=; Max-Age=0; Path=/"]
        }
      }
    })
    attachBrowserSsoCookies(client, ["MYSAPSSO2=ticket", "SAP_SESSIONID_DEV_100=old"])

    await client.login()
    await client.httpClient.request("/sap/bc/adt/discovery")
    await client.httpClient.request("/sap/bc/adt/discovery")

    expect(sent).toEqual([
      "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=old",
      "MYSAPSSO2=ticket",
      "MYSAPSSO2=ticket"
    ])
  })

  test("does not send the placeholder when every captured cookie has expired", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const transport = (client.httpClient as any).httpclient
    let requests = 0
    transport.request = vi.fn(async (options: HttpClientOptions) => {
      requests++
      expect(options.auth).toBeUndefined()
      expect(options.headers?.Cookie).toBeUndefined()
      return { status: 401, statusText: "Unauthorized", body: "", headers: {} }
    })
    attachBrowserSsoCookies(client, [])

    await expect(client.login()).rejects.toThrow()
    expect(requests).toBe(1)
  })

  test("replaces every cookie of the same client after a new capture", async () => {
    const client = new ADTClient("https://sap.example.com", "developer", "browser-sso")
    const sent: string[] = []
    const transport = (client.httpClient as any).httpclient
    transport.request = vi.fn(async (options: HttpClientOptions) => {
      sent.push(options.headers?.Cookie ?? "")
      return {
        status: 200,
        statusText: "OK",
        body: "",
        headers: {
          "x-csrf-token": "token",
          "set-cookie": ["SAP_SESSIONID_DEV_100=rotated; Path=/"]
        }
      }
    })
    attachBrowserSsoCookies(client, ["MYSAPSSO2=expired"])
    await client.httpClient.request("/sap/bc/adt/discovery")

    replaceBrowserSsoCookies(client, ["MYSAPSSO2=fresh"])
    await client.httpClient.request("/sap/bc/adt/discovery")

    expect(sent).toEqual([
      "MYSAPSSO2=expired",
      "MYSAPSSO2=expired; SAP_SESSIONID_DEV_100=rotated",
      "MYSAPSSO2=fresh",
      "MYSAPSSO2=fresh; SAP_SESSIONID_DEV_100=rotated"
    ])
    expect(() => replaceBrowserSsoCookies(client.statelessClone, [])).toThrow("never attached")
  })
})

describe("browser SSO cookie cache", () => {
  test("uses saved cookies regardless of their old timestamp", async () => {
    const vault = {
      getPassword: vi.fn().mockResolvedValue('["MYSAPSSO2=ticket"]'),
      setPassword: vi.fn(),
      deletePassword: vi.fn()
    }
    vi.mocked(PasswordVault.get).mockReturnValue(vault as any)

    expect(await getSsoCookies("DEV100")).toEqual(["MYSAPSSO2=ticket"])
    await storeSsoCookies("DEV100", ["MYSAPSSO2=ticket"])

    expect(vault.getPassword).toHaveBeenCalledTimes(1)
    expect(vault.setPassword).toHaveBeenCalledTimes(1)
    expect(vault.deletePassword).not.toHaveBeenCalled()
  })
})

describe("browser SSO capture", () => {
  beforeEach(() => vi.mocked(vscode.env.openExternal).mockClear())

  test("disconnect cancels capture without saving a late cookie paste", async () => {
    const vault = {
      getPassword: vi.fn().mockResolvedValue(undefined),
      setPassword: vi.fn(),
      deletePassword: vi.fn()
    }
    vi.mocked(PasswordVault.get).mockReturnValue(vault as any)
    const login = buildBrowserSsoAuth("removed-capture", "https://sap.example.com", "100")
    const cancelled = expect(login).rejects.toBeInstanceOf(vscode.CancellationError)
    await vi.waitFor(() => expect(vscode.env.openExternal).toHaveBeenCalled())
    const url = vi.mocked(vscode.env.openExternal).mock.calls[0][0].toString()

    await cancelBrowserSsoCapture("removed-capture")
    await cancelled
    await expect(
      fetch(`${url}/cookies`, {
        method: "POST",
        body: JSON.stringify({ cookies: "MYSAPSSO2=too-late" })
      })
    ).rejects.toThrow()
    expect(vault.setPassword).not.toHaveBeenCalled()
  })

  test("keeps the helper usable after an invalid cookie paste", async () => {
    const capture = startCookieCaptureServer("https://sap.example.com/login", 2000)
    await vi.waitFor(() => expect(vscode.env.openExternal).toHaveBeenCalled())
    const url = vi.mocked(vscode.env.openExternal).mock.calls[0][0].toString()

    const html = await fetch(url).then(response => response.text())
    expect(html).toContain("if (!d.captured)")
    const invalid = await fetch(`${url}/cookies`, {
      method: "POST",
      body: JSON.stringify({ cookies: "not-a-cookie" })
    }).then(response => response.json())
    expect(invalid).toMatchObject({
      captured: false,
      message: expect.stringContaining("No cookies")
    })

    const valid = await fetch(`${url}/cookies`, {
      method: "POST",
      body: JSON.stringify({ cookies: "MYSAPSSO2=ticket" })
    }).then(response => response.json())
    expect(valid.captured).toBe(true)
    expect(await capture).toEqual(["MYSAPSSO2=ticket"])
  })

  test("extends the server deadline before expiry and accepts cookies afterward", async () => {
    const capture = startCookieCaptureServer("https://sap.example.com/login", 500)
    await vi.waitFor(() => expect(vscode.env.openExternal).toHaveBeenCalled())
    const url = vi.mocked(vscode.env.openExternal).mock.calls[0][0].toString()

    const html = await fetch(url).then(response => response.text())
    expect(html).toContain('id="timer"')
    expect(html).toContain("extendTimer()")
    const originalDeadline = Number(html.match(/var deadline = (\d+);/)?.[1])
    await new Promise(resolve => setTimeout(resolve, 200))

    const extended = await fetch(`${url}/extend`, { method: "POST" }).then(response =>
      response.json()
    )
    expect(extended.deadline).toBeGreaterThan(originalDeadline)
    await new Promise(resolve => setTimeout(resolve, 350))

    await fetch(`${url}/cookies`, {
      method: "POST",
      body: JSON.stringify({ cookies: "MYSAPSSO2=ticket" })
    })
    expect(await capture).toEqual(["MYSAPSSO2=ticket"])
  })

  test("closes the capture server after the deadline without an extension", async () => {
    const capture = startCookieCaptureServer("https://sap.example.com/login", 30)
    const expired = expect(capture).rejects.toThrow("Browser SSO timed out")

    await expired
  })

  test("cancels capture from the helper without waiting for VS Code reload", async () => {
    const capture = startCookieCaptureServer("https://sap.example.com/login", 500)
    const cancelled = expect(capture).rejects.toBeInstanceOf(vscode.CancellationError)
    await vi.waitFor(() => expect(vscode.env.openExternal).toHaveBeenCalled())
    const url = vi.mocked(vscode.env.openExternal).mock.calls[0][0].toString()

    await fetch(`${url}/cancel`, { method: "POST" })

    await cancelled
  })
})
