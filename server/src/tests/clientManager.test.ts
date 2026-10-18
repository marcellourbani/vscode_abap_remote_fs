const { sendRequest, readConfiguration, showWarningMessage } = vi.hoisted(() => ({
  sendRequest: vi.fn(),
  readConfiguration: vi.fn(),
  showWarningMessage: vi.fn()
}))

vi.mock("vscode-languageserver", () => ({
  ProposedFeatures: { all: {} },
  createConnection: () => ({
    sendRequest,
    sendNotification: vi.fn(),
    window: { showWarningMessage },
    console: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() }
  })
}))
vi.mock("../clientapis", () => ({ readConfiguration }))
vi.mock("abap-adt-api", () => ({
  ADTClient: vi.fn(),
  createCookieSessionOptions: vi.fn((options: any) => {
    let pending: Promise<string | undefined> | undefined
    return {
      session: {
        id: options.id,
        logoutMode: "local-only",
        async renew({ reason, error }: { reason: string; error?: unknown }) {
          if (reason === "csrf") return undefined
          if (reason === "initial-login") {
            const saved = await options.loadCookies()
            if (saved) return { cookieHeader: saved, replace: true }
          }
          pending ??= options
            .acquireCookies({ reason: "expired", error })
            .finally(() => (pending = undefined))
          const cookieHeader = await pending
          return cookieHeader ? { cookieHeader, replace: true } : undefined
        }
      },
      extensions: []
    }
  }),
  createSSLConfig: vi.fn(() => ({})),
  isAdtError: vi.fn(() => false),
  isCsrfError: vi.fn(() => false),
  isHttpError: vi.fn(() => false),
  session_types: { stateful: "stateful", stateless: "stateless" }
}))
vi.mock("vscode-abap-remote-fs-sharedapi", () => ({
  getAuthMethod: (conf: { authMethod?: string }) => conf.authMethod ?? "basic",
  Methods: {
    getAuthHeaders: "getAuthHeaders",
    recoverBrowserSso: "recoverBrowserSso",
    storeBrowserSsoCookies: "storeBrowserSsoCookies"
  }
}))

import { ADTClient, createCookieSessionOptions } from "abap-adt-api"
import { browserSsoLoginCompleted, clientFromKey, connectionFolderChanged } from "../clientManager"

afterEach(() => {
  sendRequest.mockReset()
  readConfiguration.mockReset()
})

async function serverSsoClient(name: string, authMethod = "browser_sso") {
  const main = {
    statelessClone: {},
    stateful: "stateless",
    logout: vi.fn().mockResolvedValue(undefined)
  }
  vi.mocked(ADTClient).mockImplementationOnce(function () {
    return main as any
  })
  readConfiguration.mockResolvedValueOnce({
    name,
    url: "https://sap.example.com",
    username: "developer",
    authMethod
  })
  sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=old" } })
  await clientFromKey(name)
  sendRequest.mockReset()
  return main
}

test("configures a session provider without pinning the Browser SSO Cookie header", async () => {
  vi.useFakeTimers()
  try {
    const clone = {}
    const main = { statelessClone: clone, stateful: "stateless" }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return main as any
    })
    readConfiguration.mockResolvedValueOnce({
      name: "dev100",
      url: "https://sap.example.com",
      username: "developer",
      client: "100",
      authMethod: "browser_sso"
    })
    sendRequest.mockResolvedValueOnce({
      httpHeaders: { Cookie: "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=old", "X-Test": "ok" }
    })

    await clientFromKey("dev100")

    expect(vi.mocked(ADTClient).mock.calls[0][5]).toHaveProperty("session.logoutMode", "local-only")
    expect(vi.mocked(ADTClient).mock.calls[0][5]).not.toHaveProperty("headers.Cookie")
    expect(createCookieSessionOptions).toHaveBeenCalledOnce()
    const provider = vi.mocked(ADTClient).mock.calls[0]?.[5]?.session
    if (!provider) throw new Error("Browser SSO session provider was not configured")
    await expect(provider.renew({ reason: "initial-login", client: main as any })).resolves.toEqual(
      {
        cookieHeader: "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=old",
        replace: true
      }
    )
    const cookieOptions = vi.mocked(createCookieSessionOptions).mock.calls[0]?.[0]
    if (!cookieOptions) throw new Error("Cookie-session callbacks were not configured")
    expect(cookieOptions.id).toBe("browser-sso:dev100")
    await cookieOptions.onCookiesChanged?.("MYSAPSSO2=rotated")
    expect(sendRequest).toHaveBeenCalledWith("storeBrowserSsoCookies", {
      connId: "dev100",
      cookieHeader: "MYSAPSSO2=rotated"
    })
    expect(main.stateful).toBe("stateful")
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("coalesces server recovery while the extension captures fresh cookies", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("server-recovery-sso")
    let finishRecovery!: (value: string) => void
    sendRequest.mockImplementation(async (method: string) => {
      if (method === "recoverBrowserSso") return new Promise(resolve => (finishRecovery = resolve))
      return { httpHeaders: { Cookie: "MYSAPSSO2=fresh" } }
    })
    const provider = vi.mocked(ADTClient).mock.calls.at(-1)?.[5]?.session
    if (!provider) throw new Error("Browser SSO session provider was not configured")
    const context = { reason: "expired" as const, client: main as any }
    const first = provider.renew(context)
    const second = provider.renew(context)
    await vi.waitFor(() => expect(finishRecovery).toBeDefined())
    finishRecovery("MYSAPSSO2=fresh")

    await expect(Promise.all([first, second])).resolves.toEqual([
      { cookieHeader: "MYSAPSSO2=fresh", replace: true },
      { cookieHeader: "MYSAPSSO2=fresh", replace: true }
    ])
    expect(sendRequest.mock.calls.filter(([method]) => method === "recoverBrowserSso")).toEqual([
      ["recoverBrowserSso", "server-recovery-sso"]
    ])
    expect(await clientFromKey("server-recovery-sso")).toBe(main)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("a declined browser login pauses the server until the next editor login", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("declined-sso")
    sendRequest.mockImplementation(async (method: string) =>
      method === "recoverBrowserSso" ? undefined : { httpHeaders: { Cookie: "MYSAPSSO2=stale" } }
    )
    const provider = vi.mocked(ADTClient).mock.calls.at(-1)?.[5]?.session
    if (!provider) throw new Error("Browser SSO session provider was not configured")

    await expect(provider.renew({ reason: "expired", client: {} as any })).resolves.toBeUndefined()

    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("Run Connect"))
    expect(await clientFromKey("declined-sso")).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await expect(
      provider.renew({ reason: "expired", client: main as any })
    ).resolves.toBeUndefined()
    expect(
      sendRequest.mock.calls.filter(([method]) => method === "recoverBrowserSso")
    ).toHaveLength(1)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("keeps Kerberos headers and client setup unchanged", async () => {
  vi.useFakeTimers()
  try {
    const main = { statelessClone: {}, stateful: "stateless" }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return main as any
    })
    readConfiguration.mockResolvedValueOnce({
      name: "kerberos100",
      url: "https://sap.example.com",
      username: "developer",
      client: "100",
      authMethod: "kerberos"
    })
    sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=ticket" } })

    await clientFromKey("kerberos100")

    expect(vi.mocked(ADTClient).mock.calls.at(-1)?.[5]).toHaveProperty(
      "headers.Cookie",
      "MYSAPSSO2=ticket"
    )
    expect(main.stateful).toBe("stateful")
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("a failed provider renewal pauses features until Browser SSO completes", async () => {
  vi.useFakeTimers()
  try {
    const conf = {
      name: "relogin-sso",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    }
    const first = { statelessClone: {}, stateful: "stateless" }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return first as any
    })
    readConfiguration.mockResolvedValueOnce(conf)
    await clientFromKey("relogin-sso")
    sendRequest.mockImplementation(async (method: string) =>
      method === "recoverBrowserSso" ? undefined : { httpHeaders: { Cookie: "MYSAPSSO2=stale" } }
    )
    const provider = vi.mocked(ADTClient).mock.calls.at(-1)?.[5]?.session
    if (!provider) throw new Error("Browser SSO session provider was not configured")
    await expect(
      provider.renew({ reason: "expired", client: first as any })
    ).resolves.toBeUndefined()
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("Run Connect"))
    expect(await clientFromKey("relogin-sso")).toBeUndefined()

    const refreshed = { statelessClone: {}, stateful: "stateless" }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return refreshed as any
    })
    readConfiguration.mockResolvedValueOnce(conf)

    await browserSsoLoginCompleted("RELOGIN-SSO")
    expect(await clientFromKey("relogin-sso")).toBe(refreshed)
    expect(vi.getTimerCount()).toBe(1)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("a login notice leaves a working server client alone", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("working-sso")
    vi.mocked(ADTClient).mockClear()
    readConfiguration.mockClear()

    await browserSsoLoginCompleted("working-sso")

    expect(ADTClient).not.toHaveBeenCalled()
    expect(readConfiguration).not.toHaveBeenCalled()
    expect(await clientFromKey("working-sso")).toBe(main)
    expect(main.logout).not.toHaveBeenCalled()
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("folder removal cancels refresh and prevents later client creation", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    const main = {
      statelessClone: {},
      stateful: "stateless",
      logout: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return main as any
    })
    readConfiguration.mockResolvedValueOnce({
      name: "removed-dev100",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    })
    sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=ticket" } })

    await clientFromKey("removed-dev100")
    expect(vi.getTimerCount()).toBe(1)
    connectionFolderChanged([], ["REMOVED-DEV100"])
    expect(vi.getTimerCount()).toBe(0)
    expect(main.logout).toHaveBeenCalledOnce()
    expect(main.stateful).toBe("stateless")
    expect(await clientFromKey("Removed-DEV100")).toBeUndefined()
    expect(ADTClient).toHaveBeenCalledTimes(1)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("concurrent first requests share one client and leave no timer after folder removal", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    const main = {
      statelessClone: {},
      stateful: "stateless",
      logout: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return main as any
    })
    let finishConfiguration!: (value: unknown) => void
    readConfiguration.mockImplementationOnce(
      () => new Promise(resolve => (finishConfiguration = resolve))
    )

    const first = clientFromKey("CONCURRENT-DEV100")
    const second = clientFromKey("concurrent-dev100")
    finishConfiguration({
      name: "concurrent-dev100",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    })
    sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=ticket" } })

    expect(await Promise.all([first, second])).toEqual([main, main])
    expect(readConfiguration).toHaveBeenCalledTimes(1)
    expect(ADTClient).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    connectionFolderChanged([], ["concurrent-dev100"])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("folder removal invalidates an in-flight auth-header lookup even if the folder is re-added", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    readConfiguration.mockResolvedValueOnce({
      name: "pending-dev100",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "kerberos"
    })
    let finishAuth!: (value: unknown) => void
    sendRequest.mockImplementationOnce(() => new Promise(resolve => (finishAuth = resolve)))

    const pending = clientFromKey("pending-dev100")
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalled())
    connectionFolderChanged([], ["pending-dev100"])
    connectionFolderChanged(["pending-dev100"], [])
    finishAuth({ httpHeaders: { Cookie: "MYSAPSSO2=ticket" } })

    expect(await pending).toBeUndefined()
    expect(ADTClient).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("removing a folder whose name is percent-encoded stops its server client", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("my%20sys")
    expect(vi.getTimerCount()).toBe(1)

    connectionFolderChanged([], ["My%20Sys"])

    expect(vi.getTimerCount()).toBe(0)
    expect(main.logout).toHaveBeenCalledOnce()
    expect(await clientFromKey("my sys")).toBeUndefined()
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("overlapping refreshes log out every replaced server client", async () => {
  vi.useFakeTimers()
  try {
    const first = await serverSsoClient("overlap-sso", "kerberos")
    const newClient = () => ({
      statelessClone: {},
      stateful: "stateless",
      logout: vi.fn().mockResolvedValue(undefined)
    })
    const second = newClient()
    const third = newClient()
    vi.mocked(ADTClient)
      .mockImplementationOnce(function () {
        return second as any
      })
      .mockImplementationOnce(function () {
        return third as any
      })
    let finishSlowAuth!: (value: unknown) => void
    sendRequest
      .mockImplementationOnce(() => new Promise(resolve => (finishSlowAuth = resolve)))
      .mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=fresh" } })

    await vi.advanceTimersByTimeAsync(240000)
    await vi.advanceTimersByTimeAsync(240000)
    finishSlowAuth({ httpHeaders: { Cookie: "MYSAPSSO2=old" } })
    await vi.advanceTimersByTimeAsync(2000)

    expect(await clientFromKey("overlap-sso")).toBe(third)
    expect(first.logout).toHaveBeenCalledOnce()
    expect(second.logout).toHaveBeenCalledOnce()
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
