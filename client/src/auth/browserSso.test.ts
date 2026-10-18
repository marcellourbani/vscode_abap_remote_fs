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

vi.mock("vscode-abap-remote-fs-sharedapi", () => ({
  renewBrowserSsoCookies: vi.fn(async (_client, _id, cachedCookieHeader, capture) => {
    if (cachedCookieHeader) return { cookieHeader: cachedCookieHeader, replace: true }
    const cookies = await capture()
    return cookies.length ? { cookieHeader: cookies.join("; "), replace: true } : undefined
  })
}))

import * as vscode from "vscode"
import { PasswordVault } from "../lib"
import { renewBrowserSsoCookies } from "vscode-abap-remote-fs-sharedapi"
import {
  cancelBrowserSsoCapture,
  captureBrowserSsoCookies,
  createBrowserSsoSessionProvider,
  getSsoCookies,
  startCookieCaptureServer,
  storeSsoCookies
} from "./browserSso"

describe("Browser SSO session provider", () => {
  test("uses saved cookies for initial login without opening the browser", async () => {
    const vault = {
      getPassword: vi.fn().mockResolvedValue('["MYSAPSSO2=ticket"]'),
      setPassword: vi.fn(),
      deletePassword: vi.fn()
    }
    vi.mocked(PasswordVault.get).mockReturnValue(vault as any)
    const onCookiesCaptured = vi.fn()
    const provider = createBrowserSsoSessionProvider(
      "DEV100",
      "https://sap.example.com",
      "100",
      onCookiesCaptured
    )

    await expect(provider.renew({ reason: "initial-login", client: {} as any })).resolves.toEqual({
      cookieHeader: "MYSAPSSO2=ticket",
      replace: true
    })

    expect(provider).toMatchObject({ id: "browser-sso:dev100", logoutMode: "local-only" })
    expect(vscode.env.openExternal).not.toHaveBeenCalled()
    expect(onCookiesCaptured).not.toHaveBeenCalled()
  })

  test("tries saved cookies first for an expired session", async () => {
    const vault = {
      getPassword: vi.fn().mockResolvedValue('["MYSAPSSO2=ticket"]'),
      setPassword: vi.fn(),
      deletePassword: vi.fn()
    }
    vi.mocked(PasswordVault.get).mockReturnValue(vault as any)
    const provider = createBrowserSsoSessionProvider("DEV100", "https://sap.example.com", "100")

    await expect(provider.renew({ reason: "expired", client: {} as any })).resolves.toEqual({
      cookieHeader: "MYSAPSSO2=ticket",
      replace: true
    })
    expect(renewBrowserSsoCookies).toHaveBeenCalledOnce()
    expect(vscode.env.openExternal).not.toHaveBeenCalled()
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
    const capture = captureBrowserSsoCookies("removed-capture", "https://sap.example.com", "100")
    const cancelled = expect(capture).rejects.toBeInstanceOf(vscode.CancellationError)
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
    await expect(capture).rejects.toThrow("Browser SSO timed out")
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
