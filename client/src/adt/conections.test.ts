vi.mock("vscode", () => ({
  CancellationError: class CancellationError extends Error {},
  FileSystemError: {
    FileNotFound: (msg: string) => new Error(`FileNotFound: ${msg}`)
  },
  workspace: {
    workspaceFolders: undefined
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: s.split("://")[0],
        authority: s.split("://")[1]?.split("/")[0],
        toString: () => s
      }
    })
  }
}))

vi.mock("../config", () => ({
  RemoteManager: { get: vi.fn() },
  createClient: vi.fn(),
  createAuthenticatedClient: vi.fn(),
  formatKey: (id: string) => id.toLowerCase()
}))

vi.mock("./debugger", () => ({ LogOutPendingDebuggers: vi.fn().mockReturnValue([]) }))
vi.mock("../services/sapSystemValidator", () => ({
  SapSystemValidator: {
    getInstance: vi
      .fn()
      .mockReturnValue({ validateSystemAccess: vi.fn().mockResolvedValue(undefined) })
  }
}))
vi.mock("../fs/LocalFsProvider", () => ({
  LocalFsProvider: { useLocalStorage: vi.fn().mockReturnValue(false) }
}))
vi.mock("../auth/browserSso", () => ({
  clearSsoCookies: vi.fn().mockResolvedValue(undefined),
  getSsoCookies: vi.fn().mockResolvedValue([]),
  captureBrowserSsoCookies: vi
    .fn()
    .mockResolvedValue(["MYSAPSSO2=fresh", "SAP_SESSIONID_DEV_100=new"]),
  cancelBrowserSsoCapture: vi.fn().mockResolvedValue(undefined),
  cancelAllBrowserSsoCaptures: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("vscode-abap-remote-fs-sharedapi", async () => {
  const actual = await vi.importActual<typeof import("vscode-abap-remote-fs-sharedapi")>(
    "vscode-abap-remote-fs-sharedapi"
  )
  const replaceBrowserSsoCookies = vi.fn()
  return {
    isBrowserSsoSessionExpired: actual.isBrowserSsoSessionExpired,
    replaceBrowserSsoCookies,
    onBrowserSsoAuthFailure: vi.fn(),
    loginWithBrowserSsoCookies: vi.fn(async (client: any, cookies: string[]) => {
      if (!cookies.length) return false
      replaceBrowserSsoCookies(client, cookies)
      replaceBrowserSsoCookies(client.statelessClone, cookies)
      try {
        await client.login()
        await client.statelessClone.login()
        return true
      } catch (error) {
        if (actual.isBrowserSsoSessionExpired(error)) return false
        throw error
      }
    })
  }
})
vi.mock("../lib", () => ({ log: Object.assign(vi.fn(), { debug: vi.fn() }) }))
vi.mock("abapfs", () => ({
  AFsService: class {},
  Root: class {
    constructor(readonly connId: string) {}

    lockManager = {
      lockedPaths: vi.fn().mockReturnValue(["/locked/source"]),
      requestUnlock: vi.fn().mockResolvedValue(undefined),
      dropall: vi.fn()
    }
  }
}))

import {
  ADTSCHEME,
  ADTURIPATTERN,
  abapUri,
  getClient,
  getOrCreateClient,
  getOrCreateRoot,
  getRoot,
  recoverBrowserSsoConnection,
  refreshBrowserSsoCookies,
  announceBrowserSsoLogin,
  rootIsConnected,
  disconnect,
  disconnectConnection,
  clearConnectionFailure,
  onBrowserSsoLogin
} from "./conections"
import * as __$mock_vscode from "vscode"
import { RemoteManager, createAuthenticatedClient } from "../config"
import { LogOutPendingDebuggers } from "./debugger"
import { captureBrowserSsoCookies, clearSsoCookies, getSsoCookies } from "../auth/browserSso"
import { onBrowserSsoAuthFailure, replaceBrowserSsoCookies } from "vscode-abap-remote-fs-sharedapi"

const csrfError = () =>
  Object.assign(new Error("CSRF token validation failed"), { typeID: Symbol.for("BAD CSRF") })

const ssoConnection = (name: string) =>
  vi.mocked(RemoteManager.get).mockReturnValue({
    byIdAsync: vi.fn().mockResolvedValue({
      name,
      url: "https://example.com",
      username: "developer",
      authMethod: "browser_sso"
    })
  } as any)

const ssoClient = () => ({
  login: vi.fn(),
  logout: vi.fn(),
  stateful: "stateful",
  statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
})

const recoveryFor = (client: unknown) => {
  const recover = vi
    .mocked(onBrowserSsoAuthFailure)
    .mock.calls.findLast(([target]) => target === client)?.[1]
  if (!recover) throw new Error("No Browser SSO recovery registered")
  return recover
}

describe("browser SSO recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSsoCookies).mockResolvedValue([])
  })

  it("logs in again with the saved cookies without opening the browser", async () => {
    const client = ssoClient()
    ssoConnection("silent-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("silent-sso")
    const listener = vi.fn()
    onBrowserSsoLogin(listener)
    vi.mocked(getSsoCookies).mockResolvedValue(["MYSAPSSO2=saved"])

    await expect(recoveryFor(client)(csrfError())).resolves.toBe(true)

    expect(captureBrowserSsoCookies).not.toHaveBeenCalled()
    expect(clearSsoCookies).not.toHaveBeenCalled()
    expect(replaceBrowserSsoCookies).toHaveBeenCalledWith(client, ["MYSAPSSO2=saved"])
    expect(replaceBrowserSsoCookies).toHaveBeenCalledWith(client.statelessClone, [
      "MYSAPSSO2=saved"
    ])
    expect(root.lockManager.dropall).toHaveBeenCalledWith(true)
    expect(client.stateful).toBe("stateless")
    expect(client.login).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledExactlyOnceWith("silent-sso")
  })

  it("renews an expired stateless clone without dropping main-session locks", async () => {
    const client = ssoClient()
    ssoConnection("clone-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("clone-sso")
    vi.mocked(getSsoCookies).mockResolvedValue(["MYSAPSSO2=saved"])

    await expect(recoveryFor(client.statelessClone)(csrfError())).resolves.toBe(true)

    expect(replaceBrowserSsoCookies).toHaveBeenCalledWith(client.statelessClone, [
      "MYSAPSSO2=saved"
    ])
    expect(replaceBrowserSsoCookies).not.toHaveBeenCalledWith(client, ["MYSAPSSO2=saved"])
    expect(root.lockManager.dropall).not.toHaveBeenCalled()
    expect(client.stateful).toBe("stateful")
    expect(client.login).toHaveBeenCalledOnce()
    expect(client.statelessClone.login).toHaveBeenCalledTimes(2)
  })

  it("does not reopen a cancelled stateless-clone login until Connect", async () => {
    const client = ssoClient()
    ssoConnection("cancelled-clone-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("cancelled-clone-sso")
    vi.mocked(getSsoCookies).mockResolvedValue(["MYSAPSSO2=stale"])
    client.statelessClone.login.mockRejectedValueOnce(csrfError())
    vi.mocked(captureBrowserSsoCookies).mockRejectedValueOnce(
      new __$mock_vscode.CancellationError()
    )
    const recoverClone = recoveryFor(client.statelessClone)

    await expect(recoverClone(csrfError())).rejects.toThrow(
      "Login to SAP system cancelled-clone-sso was cancelled. Run Connect to log in again."
    )
    await expect(recoverClone(csrfError())).resolves.toBe(false)
    await expect(recoveryFor(client)(csrfError())).resolves.toBe(false)
    expect(captureBrowserSsoCookies).toHaveBeenCalledOnce()

    await clearConnectionFailure("cancelled-clone-sso")
    await expect(recoverClone(csrfError())).resolves.toBe(true)
  })

  it("opens one browser login for concurrent failures when the saved cookies are rejected", async () => {
    const client = ssoClient()
    ssoConnection("recovery-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("recovery-sso")
    vi.mocked(createAuthenticatedClient).mockClear()
    vi.mocked(getSsoCookies).mockResolvedValue(["MYSAPSSO2=stale"])
    client.login.mockRejectedValueOnce(csrfError())
    let finishCapture!: (cookies: string[]) => void
    vi.mocked(captureBrowserSsoCookies).mockImplementationOnce(
      () => new Promise(resolve => (finishCapture = resolve))
    )
    const recover = recoveryFor(client)

    const first = recover(csrfError())
    const second = recoveryFor(client.statelessClone)(csrfError())
    await vi.waitFor(() => expect(captureBrowserSsoCookies).toHaveBeenCalled())
    const waitingRoot = getOrCreateRoot("RECOVERY-SSO")
    finishCapture(["MYSAPSSO2=fresh"])

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    await expect(waitingRoot).resolves.toBe(root)
    expect(captureBrowserSsoCookies).toHaveBeenCalledOnce()
    expect(createAuthenticatedClient).not.toHaveBeenCalled()
    expect(replaceBrowserSsoCookies).toHaveBeenLastCalledWith(client.statelessClone, [
      "MYSAPSSO2=fresh"
    ])
    expect(getClient("RECOVERY-SSO", false)).toBe(client)
  })

  it("re-captures cookies when cached SSO fails during initial login", async () => {
    const csrfError = Object.assign(new Error("CSRF token validation failed"), {
      typeID: Symbol.for("BAD CSRF")
    })
    const staleClient = {
      login: vi.fn().mockRejectedValue(csrfError),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    const freshClient = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "expired-at-start",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(staleClient as any)
      .mockResolvedValueOnce(freshClient as any)
    vi.mocked(clearSsoCookies).mockClear()

    await getOrCreateRoot("expired-at-start")

    expect(clearSsoCookies).toHaveBeenCalledWith("expired-at-start")
    expect(freshClient.login).toHaveBeenCalledOnce()
  })

  it("treats SAP session time-outs and 401 answers as expired logins", async () => {
    const client = ssoClient()
    ssoConnection("expired-session-400")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("EXPIRED-SESSION-400")
    const adtSessionTimeout = Object.assign(new Error("Session timed out"), {
      typeID: Symbol.for("ADT EXCEPTION"),
      err: 400
    })
    const httpSessionTimeout = Object.assign(new Error("Session timed out"), {
      typeID: Symbol.for("HTTP EXCEPTION"),
      status: 400
    })
    const adtUnauthorized = Object.assign(new Error("Unauthorized"), {
      typeID: Symbol.for("ADT EXCEPTION"),
      err: 401
    })

    for (const error of [adtSessionTimeout, httpSessionTimeout, adtUnauthorized])
      await expect(recoverBrowserSsoConnection("expired-session-400", error)).resolves.toBe(true)

    expect(captureBrowserSsoCookies).toHaveBeenCalledTimes(3)
    expect(client.login).toHaveBeenCalledTimes(4)
    expect(await getOrCreateRoot("expired-session-400")).toBe(root)
    expect(root.connId).toBe("EXPIRED-SESSION-400")
  })

  it("keeps the client after a cancelled renewal and renews it again on Connect", async () => {
    const client = ssoClient()
    ssoConnection("cancelled-renewal")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("cancelled-renewal")
    vi.mocked(createAuthenticatedClient).mockClear()
    vi.mocked(captureBrowserSsoCookies).mockRejectedValueOnce(
      new __$mock_vscode.CancellationError()
    )

    await expect(recoveryFor(client)(csrfError())).rejects.toThrow(
      "Login to SAP system cancelled-renewal was cancelled. Run Connect to log in again."
    )
    await expect(getOrCreateRoot("cancelled-renewal")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    expect(() => getClient("cancelled-renewal")).toThrow(/was cancelled\. Run Connect/)
    await expect(recoveryFor(client)(csrfError())).resolves.toBe(false)

    const listener = vi.fn()
    onBrowserSsoLogin(listener)
    await clearConnectionFailure("cancelled-renewal")
    await expect(getOrCreateRoot("cancelled-renewal")).resolves.toBe(root)

    expect(captureBrowserSsoCookies).toHaveBeenCalledTimes(2)
    expect(createAuthenticatedClient).not.toHaveBeenCalled()
    expect(getClient("cancelled-renewal", false)).toBe(client)
    expect(client.login).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledExactlyOnceWith("cancelled-renewal")
  })

  it("captures new cookies for the language server without restarting the editor session", async () => {
    const client = ssoClient()
    ssoConnection("server-refresh-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("server-refresh-sso")
    client.login.mockClear()

    const refreshes = [
      refreshBrowserSsoCookies("SERVER-REFRESH-SSO"),
      refreshBrowserSsoCookies("server-refresh-sso")
    ]

    await expect(Promise.all(refreshes)).resolves.toEqual([true, true])
    expect(captureBrowserSsoCookies).toHaveBeenCalledOnce()
    expect(client.login).not.toHaveBeenCalled()
    expect(replaceBrowserSsoCookies).not.toHaveBeenCalled()
    expect(root.lockManager.dropall).not.toHaveBeenCalled()
  })

  it("keeps the editor usable when a language server login is cancelled", async () => {
    const client = ssoClient()
    ssoConnection("server-cancel-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("server-cancel-sso")
    vi.mocked(captureBrowserSsoCookies).mockRejectedValueOnce(
      new __$mock_vscode.CancellationError()
    )

    await expect(refreshBrowserSsoCookies("server-cancel-sso")).resolves.toBe(false)

    expect(getClient("server-cancel-sso", false)).toBe(client)
  })

  it("does not start a cookie capture when disconnect finishes during the connection lookup", async () => {
    let finishLookup!: (connection: any) => void
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi
        .fn()
        .mockImplementationOnce(() => new Promise(resolve => (finishLookup = resolve)))
        .mockResolvedValue({
          name: "disconnect-during-sso-lookup",
          url: "https://example.com",
          username: "developer",
          authMethod: "browser_sso"
        })
    } as any)

    const refresh = refreshBrowserSsoCookies("disconnect-during-sso-lookup")
    await vi.waitFor(() => expect(finishLookup).toBeDefined())
    await disconnectConnection("disconnect-during-sso-lookup")
    finishLookup({
      name: "disconnect-during-sso-lookup",
      url: "https://example.com",
      username: "developer",
      authMethod: "browser_sso"
    })

    await expect(refresh).resolves.toBe(false)
    expect(captureBrowserSsoCookies).not.toHaveBeenCalled()
  })

  it("tries the renewal again after a network failure instead of blocking until Connect", async () => {
    const client = ssoClient()
    ssoConnection("network-blip-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("network-blip-sso")
    vi.mocked(getSsoCookies).mockResolvedValue(["MYSAPSSO2=saved"])
    client.login.mockRejectedValueOnce(new Error("socket hang up"))

    await expect(recoveryFor(client)(csrfError())).rejects.toThrow("socket hang up")

    await expect(getOrCreateRoot("network-blip-sso")).resolves.toBe(root)
    expect(client.login).toHaveBeenCalledTimes(3)
    expect(captureBrowserSsoCookies).not.toHaveBeenCalled()
  })

  it("does not open a browser login while disconnecting", async () => {
    const client = ssoClient()
    ssoConnection("closing-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const root = await getOrCreateRoot("closing-sso")
    let recovery: Promise<boolean> | undefined
    vi.mocked(root.lockManager.requestUnlock).mockImplementationOnce(async () => {
      recovery = recoveryFor(client)(csrfError())
      throw csrfError()
    })

    await expect(disconnect([], true)).rejects.toBeDefined()

    await expect(recovery).resolves.toBe(false)
    expect(captureBrowserSsoCookies).not.toHaveBeenCalled()
    expect(client.login).toHaveBeenCalledOnce()
  })

  it("logs out a login that finished after its folder was removed", async () => {
    ssoConnection("late-login-sso")
    const client = { ...ssoClient(), loggedin: false }
    client.statelessClone.loggedin = false
    let finishLogin!: () => void
    client.login.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishLogin = () => {
            client.loggedin = true
            resolve()
          }
        })
    )
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    const pending = getOrCreateRoot("late-login-sso")
    await vi.waitFor(() => expect(finishLogin).toBeDefined())

    await disconnectConnection("late-login-sso")
    finishLogin()

    await expect(pending).rejects.toBeInstanceOf(__$mock_vscode.CancellationError)
    expect(client.logout).toHaveBeenCalledOnce()
    expect(client.statelessClone.logout).not.toHaveBeenCalled()
  })

  it("wakes the language server after a cookie-only login and when the user runs Connect", async () => {
    const client = ssoClient()
    ssoConnection("wake-server-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("wake-server-sso")
    const listener = vi.fn()
    onBrowserSsoLogin(listener)

    await expect(refreshBrowserSsoCookies("wake-server-sso")).resolves.toBe(true)
    announceBrowserSsoLogin("WAKE-SERVER-SSO")
    announceBrowserSsoLogin("not-an-sso-connection")

    expect(listener.mock.calls).toEqual([["wake-server-sso"], ["wake-server-sso"]])
  })

  it("lets the language server wait for an editor renewal already in progress", async () => {
    const client = ssoClient()
    ssoConnection("joined-refresh-sso")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("joined-refresh-sso")
    let finishCapture!: (cookies: string[]) => void
    vi.mocked(captureBrowserSsoCookies).mockImplementationOnce(
      () => new Promise(resolve => (finishCapture = resolve))
    )

    const renewal = recoveryFor(client)(csrfError())
    await vi.waitFor(() => expect(captureBrowserSsoCookies).toHaveBeenCalled())
    const refresh = refreshBrowserSsoCookies("joined-refresh-sso")
    finishCapture(["MYSAPSSO2=fresh"])

    await expect(Promise.all([renewal, refresh])).resolves.toEqual([true, true])
    expect(captureBrowserSsoCookies).toHaveBeenCalledOnce()
  })

  it("does not repeatedly prompt after a failed SSO reauthentication", async () => {
    const csrfError = Object.assign(new Error("CSRF token validation failed"), {
      typeID: Symbol.for("BAD CSRF")
    })
    const staleClient = {
      login: vi.fn().mockRejectedValue(csrfError),
      statelessClone: { login: vi.fn() }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "cancelled-sso",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(staleClient as any)
      .mockRejectedValueOnce(new Error("Browser SSO cancelled"))
    vi.mocked(createAuthenticatedClient).mockClear()

    await expect(getOrCreateRoot("cancelled-sso")).rejects.toThrow("Browser SSO cancelled")
    await expect(getOrCreateRoot("cancelled-sso")).rejects.toThrow("Connection failed")
    expect(createAuthenticatedClient).toHaveBeenCalledTimes(2)
  })

  it("reports a timed-out login with one Connect retry hint", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "timed-out-sso",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockRejectedValueOnce(
      new Error("Browser SSO timed out. Run Connect again to retry.")
    )

    await expect(getOrCreateRoot("timed-out-sso")).rejects.toThrow("Browser SSO timed out")
    await expect(getOrCreateRoot("timed-out-sso")).rejects.toThrow(
      "Connection failed: Browser SSO timed out. Run Connect again to retry."
    )
  })

  it("stays quiet after Cancel login and does not prompt again until Connect", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "user-cancelled-sso",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockClear()
    vi.mocked(createAuthenticatedClient).mockRejectedValueOnce(
      new __$mock_vscode.CancellationError()
    )

    await expect(getOrCreateRoot("user-cancelled-sso")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    await expect(getOrCreateRoot("user-cancelled-sso")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    expect(() => getClient("user-cancelled-sso")).toThrow(__$mock_vscode.CancellationError)
    expect(createAuthenticatedClient).toHaveBeenCalledOnce()

    await clearConnectionFailure("USER-CANCELLED-SSO")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce({
      login: vi.fn(),
      statelessClone: { login: vi.fn() }
    } as any)
    await getOrCreateRoot("user-cancelled-sso")
    expect(createAuthenticatedClient).toHaveBeenCalledTimes(2)
  })

  it("reports each finished Browser SSO login", async () => {
    const listener = vi.fn()
    onBrowserSsoLogin(listener)
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "Notified-SSO",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce({
      login: vi.fn(),
      statelessClone: { login: vi.fn() }
    } as any)

    await getOrCreateRoot("Notified-SSO")

    expect(listener).toHaveBeenCalledExactlyOnceWith("notified-sso")
  })

  it("does not prompt for non-authentication failures", async () => {
    vi.mocked(clearSsoCookies).mockClear()
    const error = new Error("File not found")
    const unrelatedBadRequest = Object.assign(new Error("Invalid request"), {
      typeID: Symbol.for("ADT EXCEPTION"),
      err: 400
    })

    await expect(recoverBrowserSsoConnection("recovery-sso", error)).resolves.toBe(false)
    await expect(recoverBrowserSsoConnection("recovery-sso", unrelatedBadRequest)).resolves.toBe(
      false
    )

    expect(clearSsoCookies).not.toHaveBeenCalled()
  })

  it("does not attach Browser SSO recovery to other login types", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "isolated-cert-read",
        url: "https://example.com",
        username: "developer",
        authMethod: "cert"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)

    await getOrCreateRoot("isolated-cert-read")

    expect(onBrowserSsoAuthFailure).not.toHaveBeenCalled()
    await expect(refreshBrowserSsoCookies("isolated-cert-read")).resolves.toBe(false)
    expect(captureBrowserSsoCookies).not.toHaveBeenCalled()
  })

  it("preserves a Basic login error if SSO recovery cannot read configuration", async () => {
    const csrfError = Object.assign(new Error("CSRF token validation failed"), {
      typeID: Symbol.for("BAD CSRF")
    })
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi
        .fn()
        .mockResolvedValueOnce({
          name: "isolated-basic-login",
          url: "https://example.com",
          username: "developer",
          password: "password",
          authMethod: "basic"
        })
        .mockRejectedValue(new Error("configuration unavailable"))
    } as any)
    const { createClient } = await import("../config")
    vi.mocked(createClient).mockReturnValueOnce({
      login: vi.fn().mockRejectedValue(csrfError)
    } as any)
    vi.mocked(clearSsoCookies).mockClear()

    await expect(getOrCreateRoot("isolated-basic-login")).rejects.toBe(csrfError)

    expect(clearSsoCookies).not.toHaveBeenCalled()
  })
})

describe("disconnect", () => {
  it("keeps browser SSO cookies but ends its SAP sessions on ordinary deactivation", async () => {
    const ssoClient = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    const basicClient = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockImplementation(async id => ({
        name: id,
        url: "https://example.com",
        username: "developer",
        authMethod: id === "reload-sso" ? "browser_sso" : "cert"
      }))
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(ssoClient as any)
      .mockResolvedValueOnce(basicClient as any)
    vi.mocked(clearSsoCookies).mockClear()
    const root = await getOrCreateRoot("reload-sso")
    await getOrCreateRoot("reload-cert")

    await disconnect([], true)

    expect(root.lockManager.requestUnlock).toHaveBeenCalledWith("/locked/source", true)
    expect(ssoClient.logout).toHaveBeenCalledOnce()
    expect(ssoClient.statelessClone.logout).toHaveBeenCalledOnce()
    expect(clearSsoCookies).not.toHaveBeenCalledWith("reload-sso")
    expect(basicClient.logout).toHaveBeenCalledOnce()
  })

  it("logs out only the removed folder and leaves other clients usable", async () => {
    const removed = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: {
        login: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined),
        loggedin: true
      }
    }
    const remaining = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockImplementation(async id => ({
        name: id,
        url: "https://example.com",
        username: "developer",
        authMethod: id === "removed-sso" ? "browser_sso" : "cert"
      }))
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(removed as any)
      .mockResolvedValueOnce(remaining as any)
    vi.mocked(clearSsoCookies).mockClear()
    await getOrCreateRoot("removed-sso")
    const remainingRoot = await getOrCreateRoot("remaining-cert")

    await disconnectConnection("REMOVED-SSO")

    expect(removed.logout).toHaveBeenCalledOnce()
    expect(removed.statelessClone.logout).toHaveBeenCalledOnce()
    expect(clearSsoCookies).toHaveBeenCalledWith("removed-sso")
    expect(remaining.logout).not.toHaveBeenCalled()
    expect(getRoot("remaining-cert")).toBe(remainingRoot)
    expect(getClient("remaining-cert", false)).toBe(remaining)
    expect(() => getRoot("removed-sso")).toThrow()
  })

  it("logs out and forgets a non-SSO client on folder removal", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "isolated-basic-remove",
        url: "https://example.com",
        username: "developer",
        password: "password",
        authMethod: "basic"
      })
    } as any)
    const { createClient } = await import("../config")
    vi.mocked(createClient).mockReturnValueOnce(client as any)
    vi.mocked(clearSsoCookies).mockClear()
    await getOrCreateRoot("isolated-basic-remove")

    await disconnectConnection("isolated-basic-remove")

    expect(client.logout).toHaveBeenCalledOnce()
    expect(() => getRoot("isolated-basic-remove")).toThrow()
    expect(() => getClient("isolated-basic-remove")).toThrow(__$mock_vscode.CancellationError)
    await expect(getOrCreateRoot("isolated-basic-remove")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    expect(clearSsoCookies).not.toHaveBeenCalled()
  })

  it("does not reconnect a removed Browser SSO folder until Connect is requested", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "removed-sso-blocked",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockClear()

    await disconnectConnection("removed-sso-blocked")
    await expect(getOrCreateRoot("removed-sso-blocked")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    expect(createAuthenticatedClient).not.toHaveBeenCalled()

    await clearConnectionFailure("removed-sso-blocked")
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("removed-sso-blocked")
    expect(createAuthenticatedClient).toHaveBeenCalledOnce()
  })

  it("quietly cancels a login in flight when its folder is removed", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "pending-sso-removal",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    let finishAuth!: (client: any) => void
    vi.mocked(createAuthenticatedClient).mockImplementationOnce(
      () => new Promise(resolve => (finishAuth = resolve))
    )
    const pending = getOrCreateRoot("pending-sso-removal")
    await vi.waitFor(() => expect(createAuthenticatedClient).toHaveBeenCalled())
    await disconnectConnection("pending-sso-removal")
    const client = {
      login: vi.fn(),
      statelessClone: { login: vi.fn() }
    }
    finishAuth(client)

    await expect(pending).rejects.toBeInstanceOf(__$mock_vscode.CancellationError)
    expect(client.login).not.toHaveBeenCalled()
    expect(() => getRoot("pending-sso-removal")).toThrow()
  })

  it("waits for bounded cleanup before reconnecting the same folder", async () => {
    vi.useFakeTimers()
    try {
      const oldClient = {
        login: vi.fn(),
        logout: vi.fn(() => new Promise<void>(() => undefined)),
        statelessClone: { login: vi.fn(), loggedin: false }
      }
      const newClient = {
        login: vi.fn(),
        logout: vi.fn(),
        statelessClone: { login: vi.fn(), loggedin: false }
      }
      vi.mocked(RemoteManager.get).mockReturnValue({
        byIdAsync: vi.fn().mockResolvedValue({
          name: "quick-reconnect",
          url: "https://example.com",
          username: "developer",
          authMethod: "cert"
        })
      } as any)
      vi.mocked(createAuthenticatedClient)
        .mockResolvedValueOnce(oldClient as any)
        .mockResolvedValueOnce(newClient as any)
      await getOrCreateRoot("quick-reconnect")

      const cleanup = disconnectConnection("quick-reconnect")
      const reconnect = clearConnectionFailure("quick-reconnect")
      expect(() => getRoot("quick-reconnect")).toThrow()
      await vi.advanceTimersByTimeAsync(4999)
      expect(vi.mocked(createAuthenticatedClient)).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([cleanup, reconnect])

      await getOrCreateRoot("quick-reconnect")
      expect(getClient("quick-reconnect", false)).toBe(newClient)
      expect(vi.mocked(createAuthenticatedClient)).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("blocks reconnects while Disconnect logs out and keeps folderless systems reconnectable", async () => {
    let finishLogout!: () => void
    const mounted = {
      login: vi.fn(),
      logout: vi.fn(() => new Promise<void>(resolve => (finishLogout = resolve))),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: false }
    }
    const folderless = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: false }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockImplementation(async id => ({
        name: id,
        url: "https://example.com",
        username: "developer",
        authMethod: "cert"
      }))
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(mounted as any)
      .mockResolvedValueOnce(folderless as any)
    await getOrCreateRoot("mounted-disconnect")
    await getOrCreateRoot("folderless-disconnect")
    vi.mocked(createAuthenticatedClient).mockClear()

    const pending = disconnect(["MOUNTED-DISCONNECT"])
    await vi.waitFor(() => expect(finishLogout).toBeDefined())
    await expect(getOrCreateRoot("mounted-disconnect")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    await expect(getOrCreateRoot("folderless-disconnect")).rejects.toBeInstanceOf(
      __$mock_vscode.CancellationError
    )
    finishLogout()
    await pending

    expect(createAuthenticatedClient).not.toHaveBeenCalled()
    await expect(getOrCreateRoot("mounted-disconnect")).rejects.toThrow(/Run Connect/)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(folderless as any)
    await getOrCreateRoot("folderless-disconnect")
    expect(createAuthenticatedClient).toHaveBeenCalledOnce()
  })

  it("does not reuse an in-flight connection attempt after Disconnect All", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "pending-disconnect-all",
        url: "https://example.com",
        username: "developer",
        authMethod: "cert"
      })
    } as any)
    let finishOldAttempt!: (client: any) => void
    vi.mocked(createAuthenticatedClient).mockImplementationOnce(
      () => new Promise(resolve => (finishOldAttempt = resolve))
    )
    const oldAttempt = getOrCreateRoot("pending-disconnect-all")
    await vi.waitFor(() => expect(finishOldAttempt).toBeDefined())

    await disconnect(["pending-disconnect-all"])
    await clearConnectionFailure("pending-disconnect-all")

    const newClient = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: false }
    }
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(newClient as any)
    const newRoot = await getOrCreateRoot("pending-disconnect-all")

    finishOldAttempt({
      loggedin: false,
      logout: vi.fn(),
      statelessClone: { loggedin: false, logout: vi.fn() }
    })
    await expect(oldAttempt).rejects.toBeInstanceOf(__$mock_vscode.CancellationError)
    expect(getRoot("pending-disconnect-all")).toBe(newRoot)
    expect(getClient("pending-disconnect-all", false)).toBe(newClient)
    expect(createAuthenticatedClient).toHaveBeenCalledTimes(2)
  })

  it("finishes Disconnect All when a SAP logout never responds", async () => {
    vi.useFakeTimers()
    try {
      const client = {
        login: vi.fn(),
        logout: vi.fn(() => new Promise<void>(() => undefined)),
        statelessClone: { login: vi.fn(), loggedin: false }
      }
      vi.mocked(RemoteManager.get).mockReturnValue({
        byIdAsync: vi.fn().mockResolvedValue({
          name: "stuck-global-logout",
          url: "https://example.com",
          username: "developer",
          authMethod: "cert"
        })
      } as any)
      vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
      await getOrCreateRoot("stuck-global-logout")

      const cleanup = disconnect()
      await vi.advanceTimersByTimeAsync(5000)

      await expect(cleanup).resolves.toBeUndefined()
      expect(() => getRoot("stuck-global-logout")).toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not revive an old login after a removed folder reconnects", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "readded-during-login",
        url: "https://example.com",
        username: "developer",
        authMethod: "cert"
      })
    } as any)
    let finishOldLogin!: (client: any) => void
    vi.mocked(createAuthenticatedClient).mockImplementationOnce(
      () => new Promise(resolve => (finishOldLogin = resolve))
    )
    const oldLogin = getOrCreateRoot("readded-during-login")
    await vi.waitFor(() => expect(finishOldLogin).toBeDefined())
    await disconnectConnection("readded-during-login")
    await clearConnectionFailure("readded-during-login")
    finishOldLogin({ login: vi.fn(), statelessClone: { login: vi.fn() } })
    await expect(oldLogin).rejects.toBeInstanceOf(__$mock_vscode.CancellationError)

    const newClient = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), loggedin: false }
    }
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(newClient as any)
    await getOrCreateRoot("readded-during-login")
    expect(getClient("readded-during-login", false)).toBe(newClient)
  })

  it("disconnects a Basic client even when SSO cleanup cannot read configuration", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi
        .fn()
        .mockResolvedValueOnce({
          name: "isolated-basic-disconnect",
          url: "https://example.com",
          username: "developer",
          password: "password",
          authMethod: "basic"
        })
        .mockRejectedValue(new Error("configuration unavailable"))
    } as any)
    const { createClient } = await import("../config")
    vi.mocked(createClient).mockReturnValueOnce(client as any)
    vi.mocked(clearSsoCookies).mockClear()
    await getOrCreateRoot("isolated-basic-disconnect")

    await expect(disconnect()).resolves.toBeUndefined()

    expect(client.logout).toHaveBeenCalledOnce()
    expect(clearSsoCookies).not.toHaveBeenCalledWith("isolated-basic-disconnect")
  })

  it("clears SSO cookies on folder removal when no client was recreated", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({ authMethod: "browser_sso" })
    } as any)
    vi.mocked(clearSsoCookies).mockClear()

    await disconnectConnection("unloaded-sso")

    expect(clearSsoCookies).toHaveBeenCalledWith("unloaded-sso")
  })

  it("clears cookies and local state when logout fails", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error("logout failed")),
      statelessClone: {
        login: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined),
        loggedin: true
      }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "failed-logout",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    vi.mocked(clearSsoCookies).mockClear()
    await getOrCreateRoot("failed-logout")

    await expect(disconnectConnection("failed-logout")).resolves.toBeUndefined()

    expect(clearSsoCookies).toHaveBeenCalledWith("failed-logout")
    expect(() => getRoot("failed-logout")).toThrow()
  })

  it("reuses one client for mixed-case connection IDs", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "dev100",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)

    const [root, sameClient] = await Promise.all([
      getOrCreateRoot("DEV100"),
      getOrCreateClient("dev100", false)
    ])

    expect(sameClient).toBe(client)
    expect(root.connId).toBe("DEV100")
    expect(await getOrCreateRoot("dev100")).toBe(root)
    expect(getClient("DEV100", false)).toBe(client)
    expect(createAuthenticatedClient).toHaveBeenCalledTimes(1)
    expect(client.login).toHaveBeenCalledTimes(1)
  })

  it("clears cookies for a mounted SSO folder without an in-memory client", async () => {
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({ authMethod: "browser_sso" })
    } as any)
    vi.mocked(clearSsoCookies).mockClear()

    await disconnect(["mounted-sso"])

    expect(clearSsoCookies).toHaveBeenCalledWith("mounted-sso")
  })

  it("clears browser SSO cookies after logout but not during a preserved restart", async () => {
    const client = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({
        name: "browser-sso-cleared",
        url: "https://example.com",
        username: "developer",
        authMethod: "browser_sso"
      })
    } as any)
    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    vi.mocked(clearSsoCookies).mockClear()
    await getOrCreateRoot("browser-sso-cleared")

    await disconnect([], true)
    expect(clearSsoCookies).not.toHaveBeenCalled()

    vi.mocked(createAuthenticatedClient).mockResolvedValueOnce(client as any)
    await getOrCreateRoot("browser-sso-cleared")
    await disconnect()
    expect(client.logout).toHaveBeenCalledTimes(2)
    expect(clearSsoCookies).toHaveBeenCalledWith("browser-sso-cleared")
  })

  it("preserves Browser SSO and logs out other clients during deactivation", async () => {
    const preserved = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    const other = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockImplementation(async id => ({
        name: id,
        url: "https://example.com",
        username: "developer",
        authMethod: id === "preserved-sso" ? "browser_sso" : "cert"
      }))
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(preserved as any)
      .mockResolvedValueOnce(other as any)
    const root = await getOrCreateRoot("preserved-sso")
    await getOrCreateRoot("other-sso")

    await disconnect([], true)

    expect(preserved.logout).toHaveBeenCalledOnce()
    expect(preserved.statelessClone.logout).toHaveBeenCalledOnce()
    expect(other.logout).toHaveBeenCalledOnce()
    expect(other.statelessClone.logout).toHaveBeenCalledOnce()
    expect(root.lockManager.requestUnlock).toHaveBeenCalledWith("/locked/source", true)
    expect(LogOutPendingDebuggers).toHaveBeenCalled()
    expect(clearSsoCookies).not.toHaveBeenCalledWith("preserved-sso")
  })

  it("finishes shutdown cleanup when a lock release or debugger logout fails", async () => {
    const sso = {
      login: vi.fn(),
      logout: vi.fn(),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    const other = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      statelessClone: { login: vi.fn(), logout: vi.fn(), loggedin: true }
    }
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: vi.fn().mockImplementation(async id => ({
        name: id,
        url: "https://example.com",
        username: "developer",
        authMethod: id === "unlock-fails-sso" ? "browser_sso" : "cert"
      }))
    } as any)
    vi.mocked(createAuthenticatedClient)
      .mockResolvedValueOnce(sso as any)
      .mockResolvedValueOnce(other as any)
    const ssoRoot = await getOrCreateRoot("unlock-fails-sso")
    const otherRoot = await getOrCreateRoot("unlock-fails-cert")
    vi.mocked(ssoRoot.lockManager.requestUnlock).mockRejectedValueOnce(new Error("unlock failed"))
    let finishDebugger!: () => void
    const debuggerLogout = new Promise<void>(resolve => (finishDebugger = resolve))
    vi.mocked(LogOutPendingDebuggers).mockImplementationOnce(
      () => [debuggerLogout, Promise.reject(new Error("debugger failed"))] as any
    )

    let settled = false
    const shutdown = disconnect([], true).finally(() => (settled = true))
    await vi.waitFor(() => expect(other.logout).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(settled).toBe(false)
    finishDebugger()

    await expect(shutdown).rejects.toThrow("unlock failed")
    expect(otherRoot.lockManager.requestUnlock).not.toHaveBeenCalled()
    expect(() => getRoot("unlock-fails-cert")).toThrow()
    expect(() => getRoot("unlock-fails-sso")).toThrow()
  })
})

describe("ADTSCHEME", () => {
  it("is 'adt'", () => {
    expect(ADTSCHEME).toBe("adt")
  })
})

describe("ADTURIPATTERN", () => {
  it("matches ADT URI paths", () => {
    expect(ADTURIPATTERN.test("/sap/bc/adt/programs/programs/zprog")).toBe(true)
    expect(ADTURIPATTERN.test("/sap/bc/adt/classes/classes/zcl_test/source/main")).toBe(true)
  })

  it("does not match non-ADT paths", () => {
    expect(ADTURIPATTERN.test("/some/other/path")).toBe(false)
    expect(ADTURIPATTERN.test("/sap/bc/gui")).toBe(false)
  })
})

describe("abapUri", () => {
  it("returns true for adt:// URIs", () => {
    const uri = { scheme: "adt" } as any
    expect(abapUri(uri)).toBe(true)
  })

  it("returns false for file:// URIs", () => {
    const uri = { scheme: "file" } as any
    expect(abapUri(uri)).toBe(false)
  })

  it("returns false/undefined for undefined", () => {
    expect(abapUri(undefined)).toBeFalsy()
  })

  it("returns false for untitled scheme", () => {
    const uri = { scheme: "untitled" } as any
    expect(abapUri(uri)).toBeFalsy()
  })
})

describe("getClient", () => {
  it("throws when connection not established", () => {
    expect(() => getClient("nonexistent_conn")).toThrow()
  })

  it("throws with helpful message about inaccessible system", () => {
    expect(() => getClient("nonexistent_conn")).toThrow(/not accessible|not found/i)
  })
})

describe("getRoot", () => {
  it("throws FileNotFound when root not established", () => {
    expect(() => getRoot("nonexistent_conn")).toThrow(/FileNotFound/)
  })
})

describe("rootIsConnected", () => {
  it("returns false when workspaceFolders is undefined", () => {
    const { workspace } = __$mock_vscode
    Object.defineProperty(workspace, "workspaceFolders", { value: undefined, configurable: true })
    expect(rootIsConnected("myconn")).toBe(false)
  })

  it("returns false when no matching ADT folder", () => {
    const { workspace } = __$mock_vscode
    Object.defineProperty(workspace, "workspaceFolders", {
      value: [{ uri: { scheme: "file", authority: "myconn" } }],
      configurable: true
    })
    expect(rootIsConnected("myconn")).toBe(false)
  })

  it("returns true when matching ADT folder exists", () => {
    const { workspace } = __$mock_vscode
    Object.defineProperty(workspace, "workspaceFolders", {
      value: [{ uri: { scheme: "adt", authority: "myconn" } }],
      configurable: true
    })
    expect(rootIsConnected("myconn")).toBe(true)
  })

  it("is case-insensitive for connId", () => {
    const { workspace } = __$mock_vscode
    Object.defineProperty(workspace, "workspaceFolders", {
      value: [{ uri: { scheme: "adt", authority: "myconn" } }],
      configurable: true
    })
    expect(rootIsConnected("MYCONN")).toBe(true)
  })
})
