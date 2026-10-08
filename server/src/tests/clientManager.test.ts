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
  createSSLConfig: vi.fn(() => ({})),
  isAdtError: vi.fn(() => false),
  isCsrfError: vi.fn(() => false),
  isHttpError: vi.fn(() => false),
  session_types: { stateful: "stateful", stateless: "stateless" }
}))
vi.mock("vscode-abap-remote-fs-sharedapi", () => ({
  getAuthMethod: (conf: { authMethod?: string }) => conf.authMethod ?? "basic",
  attachBrowserSsoCookies: vi.fn(),
  loginWithBrowserSsoCookies: vi.fn(),
  onBrowserSsoAuthFailure: vi.fn(),
  Methods: { getAuthHeaders: "getAuthHeaders", recoverBrowserSso: "recoverBrowserSso" }
}))

import { ADTClient } from "abap-adt-api"
import {
  attachBrowserSsoCookies,
  loginWithBrowserSsoCookies,
  onBrowserSsoAuthFailure
} from "vscode-abap-remote-fs-sharedapi"
import { browserSsoLoginCompleted, clientFromKey, connectionFolderChanged } from "../clientManager"

afterEach(() => {
  sendRequest.mockReset()
  readConfiguration.mockReset()
})

const recoveryFor = (client: unknown) => {
  const recover = vi
    .mocked(onBrowserSsoAuthFailure)
    .mock.calls.findLast(([target]) => target === client)?.[1]
  if (!recover) throw new Error("No Browser SSO recovery registered")
  return recover
}

async function serverSsoClient(name: string) {
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
    authMethod: "browser_sso"
  })
  sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=old" } })
  await clientFromKey(name)
  sendRequest.mockReset()
  vi.mocked(loginWithBrowserSsoCookies).mockReset()
  return main
}

test("seeds both server clients without pinning the Browser SSO Cookie header", async () => {
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

    expect(vi.mocked(ADTClient).mock.calls[0][5]).toHaveProperty("headers.X-Test", "ok")
    expect(vi.mocked(ADTClient).mock.calls[0][5]).not.toHaveProperty("headers.Cookie")
    expect(attachBrowserSsoCookies).toHaveBeenCalledWith(main, [
      "MYSAPSSO2=ticket",
      " SAP_SESSIONID_DEV_100=old"
    ])
    expect(attachBrowserSsoCookies).toHaveBeenCalledWith(clone, [
      "MYSAPSSO2=ticket",
      " SAP_SESSIONID_DEV_100=old"
    ])
    expect(main.stateful).toBe("stateful")
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("recovers the server session with the saved cookies without asking the editor", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("saved-login-sso")
    sendRequest.mockResolvedValue({ httpHeaders: { Cookie: "MYSAPSSO2=saved; SAP_X=1" } })
    vi.mocked(loginWithBrowserSsoCookies).mockResolvedValue(true)

    await expect(recoveryFor(main)(new Error("expired"))).resolves.toBe(true)

    expect(sendRequest).not.toHaveBeenCalledWith("recoverBrowserSso", expect.anything())
    expect(loginWithBrowserSsoCookies).toHaveBeenCalledExactlyOnceWith(main, [
      "MYSAPSSO2=saved",
      " SAP_X=1"
    ])
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("concurrent server failures ask the editor for one browser login when saved cookies fail", async () => {
  vi.useFakeTimers()
  try {
    const main = await serverSsoClient("server-recovery-sso")
    let finishRecovery!: (value: boolean) => void
    sendRequest.mockImplementation(async (method: string) => {
      if (method === "recoverBrowserSso") return new Promise(resolve => (finishRecovery = resolve))
      return { httpHeaders: { Cookie: "MYSAPSSO2=fresh" } }
    })
    vi.mocked(loginWithBrowserSsoCookies).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const first = recoveryFor(main)(new Error("expired"))
    const second = recoveryFor(main.statelessClone)(new Error("expired"))
    await vi.waitFor(() => expect(finishRecovery).toBeDefined())
    finishRecovery(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(sendRequest.mock.calls.filter(([method]) => method === "recoverBrowserSso")).toEqual([
      ["recoverBrowserSso", "server-recovery-sso"]
    ])
    expect(loginWithBrowserSsoCookies).toHaveBeenCalledTimes(2)
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
      method === "recoverBrowserSso" ? false : { httpHeaders: { Cookie: "MYSAPSSO2=stale" } }
    )
    vi.mocked(loginWithBrowserSsoCookies).mockResolvedValue(false)

    await expect(recoveryFor(main)(new Error("expired"))).resolves.toBe(false)

    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("Run Connect"))
    expect(await clientFromKey("declined-sso")).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await expect(recoveryFor(main)(new Error("expired"))).resolves.toBe(false)
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
    vi.mocked(attachBrowserSsoCookies).mockClear()
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
    expect(attachBrowserSsoCookies).not.toHaveBeenCalled()
    expect(main.stateful).toBe("stateful")
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("does not construct or refresh a Browser SSO client without cookies", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    readConfiguration.mockResolvedValueOnce({
      name: "missing-sso",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    })
    sendRequest.mockResolvedValueOnce(undefined)

    await expect(clientFromKey("missing-sso")).rejects.toThrow("next Browser SSO login")
    expect(ADTClient).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("an empty Browser SSO Cookie header blocks later background retries", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    readConfiguration.mockResolvedValueOnce({
      name: "empty-sso",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    })
    sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "" } })

    await expect(clientFromKey("empty-sso")).rejects.toThrow("next Browser SSO login")
    expect(await clientFromKey("empty-sso")).toBeUndefined()
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(ADTClient).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("a finished Browser SSO login unblocks the language server", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    const conf = {
      name: "relogin-sso",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    }
    readConfiguration.mockResolvedValueOnce(conf)
    sendRequest.mockResolvedValueOnce(undefined)
    await expect(clientFromKey("relogin-sso")).rejects.toThrow("next Browser SSO login")

    const main = { statelessClone: {}, stateful: "stateless" }
    vi.mocked(ADTClient).mockImplementationOnce(function () {
      return main as any
    })
    readConfiguration.mockResolvedValueOnce(conf)
    sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=fresh" } })

    await browserSsoLoginCompleted("RELOGIN-SSO")
    expect(await clientFromKey("relogin-sso")).toBe(main)
    expect(vi.getTimerCount()).toBe(1)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

test("keeps a live Browser SSO client and retries after a temporary cookie lookup failure", async () => {
  vi.useFakeTimers()
  try {
    const conf = {
      name: "temporary-sso",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
    }
    const first = {
      statelessClone: {},
      stateful: "stateless",
      logout: vi.fn().mockResolvedValue(undefined)
    }
    const second = {
      statelessClone: {},
      stateful: "stateless",
      logout: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(ADTClient)
      .mockImplementationOnce(function () {
        return first as any
      })
      .mockImplementationOnce(function () {
        return second as any
      })
    readConfiguration.mockResolvedValueOnce(conf)
    sendRequest
      .mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=valid" } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ httpHeaders: { Cookie: "MYSAPSSO2=valid" } })
    await clientFromKey("temporary-sso")

    await vi.advanceTimersByTimeAsync(240000)
    expect(await clientFromKey("temporary-sso")).toBe(first)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(240000)
    expect(await clientFromKey("temporary-sso")).toBe(second)
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

test("folder removal invalidates an in-flight auth response even if the folder is re-added", async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(ADTClient).mockClear()
    readConfiguration.mockResolvedValueOnce({
      name: "pending-dev100",
      url: "https://sap.example.com",
      username: "developer",
      authMethod: "browser_sso"
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
    const first = await serverSsoClient("overlap-sso")
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
