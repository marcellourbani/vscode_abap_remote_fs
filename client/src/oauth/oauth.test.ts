vi.mock("vscode", () => ({}))

const { mockGetToken, mockSetToken, mockStrip } = vi.hoisted(() => {
  const mockGetToken = vi.fn()
  const mockSetToken = vi.fn()
  const mockStrip = vi.fn(function (x: any) {
    const { accessToken, refreshToken, tokenType } = x
    return { accessToken, refreshToken, tokenType }
  })
  return { mockGetToken, mockSetToken, mockStrip }
})
vi.mock("./grantStorage", () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  strip: mockStrip
}))

const { mockSavePassword, mockGetPassword, mockFormatKey } = vi.hoisted(() => {
  const mockSavePassword = vi.fn()
  const mockGetPassword = vi.fn()
  const mockFormatKey = vi.fn(function (x: string) {
    return x.toLowerCase()
  })
  return { mockSavePassword, mockGetPassword, mockFormatKey }
})
vi.mock("../config", () => ({
  formatKey: mockFormatKey,
  RemoteManager: {
    get: vi.fn(function () {
      return {
        savePassword: mockSavePassword,
        getPassword: mockGetPassword
      }
    })
  }
}))

const { mockLoginServer, mockCfCodeGrant } = vi.hoisted(() => {
  const mockLoginServer = vi.fn()
  const mockCfCodeGrant = vi.fn()
  return { mockLoginServer, mockCfCodeGrant }
})
vi.mock("abap_cloud_platform", () => ({
  loginServer: mockLoginServer,
  cfCodeGrant: mockCfCodeGrant
}))

vi.mock("../lib", () => ({
  after: vi.fn(function (ms: number) {
    return new Promise(() => {})
  }), // never resolves by default
  cache: vi.fn(function (fn: any) {
    return fn
  })
}))

// We need real fp-ts Option functions
vi.mock("fp-ts/lib/Option", () => ({
  some: (v: any) => ({ _tag: "Some", value: v }),
  none: { _tag: "None" },
  toUndefined: (o: any) => (o._tag === "Some" ? o.value : undefined)
}))

const mockCreateToken = vi.fn()
const mockRefresh = vi.fn()
const { MockClientOAuth2 } = vi.hoisted(() => {
  const MockClientOAuth2 = vi.fn().mockImplementation(function () {
    return {
      createToken: mockCreateToken
    }
  })
  return { MockClientOAuth2 }
})
vi.mock("client-oauth2", () => ({ default: MockClientOAuth2 }))

import { futureToken, oauthLogin } from "./oauth"
import type { RemoteConfig } from "../config"

describe("futureToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns accessToken when grant exists in store", async () => {
    mockGetToken.mockReturnValue({
      accessToken: "tok123",
      refreshToken: "ref",
      tokenType: "bearer"
    })
    const result = await futureToken("dev100")
    expect(result).toBe("tok123")
  })

  it("returns undefined when no token and no pending grant", async () => {
    mockGetToken.mockReturnValue(undefined)
    const result = await futureToken("dev100")
    expect(result).toBeUndefined()
  })

  it("calls getToken with the provided connId", async () => {
    mockGetToken.mockReturnValue(undefined)
    await futureToken("myConn")
    expect(mockGetToken).toHaveBeenCalledWith("myConn")
  })
})

describe("oauthLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFormatKey.mockImplementation(function (x: string) {
      return x.toLowerCase()
    })
  })

  it("returns undefined when conf.oauth is missing", () => {
    const conf = { name: "dev100" } as RemoteConfig
    const result = oauthLogin(conf)
    expect(result).toBeUndefined()
  })

  it("returns undefined when conf.oauth is undefined", () => {
    const conf = { name: "dev100", oauth: undefined } as any
    const result = oauthLogin(conf)
    expect(result).toBeUndefined()
  })

  it("returns a function when conf.oauth is present", () => {
    const conf = {
      name: "dev100",
      oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
    } as any
    const result = oauthLogin(conf)
    expect(typeof result).toBe("function")
  })

  describe("returned login function", () => {
    it("reuses existing token from store", async () => {
      const existingToken = {
        accessToken: "existing-tok",
        refreshToken: "ref",
        tokenType: "bearer"
      }
      mockGetToken.mockReturnValue(existingToken)

      const conf = {
        name: "DEV100",
        oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
      } as any

      const loginFn = oauthLogin(conf)!
      const result = await loginFn()

      expect(result).toBe("existing-tok")
      expect(mockSetToken).toHaveBeenCalled()
    })

    it("formats connId via formatKey", async () => {
      const existingToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
      mockGetToken.mockReturnValue(existingToken)

      const conf = {
        name: "DEV100",
        oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
      } as any

      const loginFn = oauthLogin(conf)!
      await loginFn()

      expect(mockFormatKey).toHaveBeenCalledWith("DEV100")
    })

    it("tries vault when saveCredentials is true and no local token", async () => {
      mockGetToken.mockReturnValue(undefined)
      // fromVault returns none (no saved token in vault)
      mockGetPassword.mockResolvedValue(undefined)

      // Set up login server and grant
      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "new-tok", refreshToken: "new-ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: {
          clientId: "cid",
          clientSecret: "csec",
          loginUrl: "https://login.example.com",
          saveCredentials: true
        }
      } as any

      const loginFn = oauthLogin(conf)!
      const result = await loginFn()

      expect(mockGetPassword).toHaveBeenCalled()
      expect(result).toBe("new-tok")
    })

    it("starts login flow when no cached or vault token", async () => {
      mockGetToken.mockReturnValue(undefined)

      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "granted-tok", refreshToken: "ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
      } as any

      const loginFn = oauthLogin(conf)!
      const result = await loginFn()

      expect(mockLoginServer).toHaveBeenCalled()
      expect(mockCfCodeGrant).toHaveBeenCalledWith(
        "https://login.example.com",
        "cid",
        "csec",
        mockServer
      )
      expect(result).toBe("granted-tok")
    })

    it("calls setToken with the grant result", async () => {
      mockGetToken.mockReturnValue(undefined)
      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
      } as any

      const loginFn = oauthLogin(conf)!
      await loginFn()

      expect(mockSetToken).toHaveBeenCalledWith("dev100", grantToken)
    })

    it("saves to vault when saveCredentials is true", async () => {
      mockGetToken.mockReturnValue(undefined)
      mockGetPassword.mockResolvedValue(undefined)
      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: {
          clientId: "cid",
          clientSecret: "csec",
          loginUrl: "https://login.example.com",
          saveCredentials: true
        }
      } as any

      const loginFn = oauthLogin(conf)!
      await loginFn()

      expect(mockSavePassword).toHaveBeenCalled()
    })

    it("does NOT save to vault when saveCredentials is falsy", async () => {
      mockGetToken.mockReturnValue(undefined)
      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: { clientId: "cid", clientSecret: "csec", loginUrl: "https://login.example.com" }
      } as any

      const loginFn = oauthLogin(conf)!
      await loginFn()

      expect(mockSavePassword).not.toHaveBeenCalled()
    })

    it("uses refreshed token from vault when available", async () => {
      mockGetToken.mockReturnValue(undefined)
      const vaultData = JSON.stringify({
        accessToken: "vault-tok",
        refreshToken: "vault-ref",
        tokenType: "bearer"
      })
      mockGetPassword.mockResolvedValue(vaultData)

      // The fromVault function creates a ClientOAuth2 instance and refreshes
      const refreshedToken = {
        accessToken: "refreshed-tok",
        refreshToken: "ref2",
        tokenType: "bearer"
      }
      mockCreateToken.mockReturnValue({ refresh: vi.fn().mockResolvedValue(refreshedToken) })
      mockStrip.mockImplementation(function (x: any) {
        const { accessToken, refreshToken, tokenType } = x
        return { accessToken, refreshToken, tokenType }
      })

      const conf = {
        name: "dev100",
        oauth: {
          clientId: "cid",
          clientSecret: "csec",
          loginUrl: "https://login.example.com",
          saveCredentials: true
        }
      } as any

      const loginFn = oauthLogin(conf)!
      const result = await loginFn()

      // fromVault should have been called and returned the refreshed token
      expect(mockGetPassword).toHaveBeenCalledWith("dev100", "cid")
      // The refreshed token should be set and its accessToken returned
      expect(mockSetToken).toHaveBeenCalled()
      expect(result).toBe("refreshed-tok")
    })

    it("falls through to login flow if vault refresh fails", async () => {
      mockGetToken.mockReturnValue(undefined)
      const vaultData = JSON.stringify({
        accessToken: "old",
        refreshToken: "old-ref",
        tokenType: "bearer"
      })
      mockGetPassword.mockResolvedValue(vaultData)

      // Refresh fails
      mockCreateToken.mockReturnValue({
        refresh: vi.fn().mockRejectedValue(new Error("refresh expired"))
      })

      // Login flow should kick in
      const mockServer = { server: { close: vi.fn() } }
      mockLoginServer.mockReturnValue(mockServer)
      const grantToken = { accessToken: "new-grant-tok", refreshToken: "ref", tokenType: "bearer" }
      mockCfCodeGrant.mockResolvedValue(grantToken)
      mockStrip.mockReturnValue(grantToken)

      const conf = {
        name: "dev100",
        oauth: {
          clientId: "cid",
          clientSecret: "csec",
          loginUrl: "https://login.example.com",
          saveCredentials: true
        }
      } as any

      const loginFn = oauthLogin(conf)!
      const result = await loginFn()

      // Should fall through to login flow since fromVault returned none
      expect(mockLoginServer).toHaveBeenCalled()
      expect(result).toBe("new-grant-tok")
    })
  })
})

describe("token serialization edge cases", () => {
  // deserializeToken and serializeToken are not exported directly,
  // but we can test their behavior through the vault round-trip path.
  // The fromVault function calls deserializeToken internally.

  it("fromVault handles undefined password gracefully", async () => {
    mockGetToken.mockReturnValue(undefined)
    mockGetPassword.mockResolvedValue(undefined)

    const mockServer = { server: { close: vi.fn() } }
    mockLoginServer.mockReturnValue(mockServer)
    const grantToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
    mockCfCodeGrant.mockResolvedValue(grantToken)
    mockStrip.mockReturnValue(grantToken)

    const conf = {
      name: "dev100",
      oauth: {
        clientId: "cid",
        clientSecret: "csec",
        loginUrl: "https://login.example.com",
        saveCredentials: true
      }
    } as any

    const loginFn = oauthLogin(conf)!
    // Should not throw - falls through to login flow
    const result = await loginFn()
    expect(result).toBe("tok")
  })

  it("fromVault handles malformed JSON in password store", async () => {
    mockGetToken.mockReturnValue(undefined)
    mockGetPassword.mockResolvedValue("not-json")

    // createToken should never be called since JSON.parse throws
    // and fromVault's catch returns none

    const mockServer = { server: { close: vi.fn() } }
    mockLoginServer.mockReturnValue(mockServer)
    const grantToken = { accessToken: "tok", refreshToken: "ref", tokenType: "bearer" }
    mockCfCodeGrant.mockResolvedValue(grantToken)
    mockStrip.mockReturnValue(grantToken)

    const conf = {
      name: "dev100",
      oauth: {
        clientId: "cid",
        clientSecret: "csec",
        loginUrl: "https://login.example.com",
        saveCredentials: true
      }
    } as any

    const loginFn = oauthLogin(conf)!
    // Should not throw - JSON.parse failure in fromVault is caught
    const result = await loginFn()
    expect(result).toBe("tok")
  })

  it("fromVault ignores token data missing required fields", async () => {
    mockGetToken.mockReturnValue(undefined)
    // Missing refreshToken
    mockGetPassword.mockResolvedValue(JSON.stringify({ accessToken: "tok", tokenType: "bearer" }))
    mockStrip.mockReturnValueOnce(undefined as any)

    const mockServer = { server: { close: vi.fn() } }
    mockLoginServer.mockReturnValue(mockServer)
    const grantToken = { accessToken: "fallback", refreshToken: "ref", tokenType: "bearer" }
    mockCfCodeGrant.mockResolvedValue(grantToken)
    mockStrip.mockReturnValue(grantToken)

    const conf = {
      name: "dev100",
      oauth: {
        clientId: "cid",
        clientSecret: "csec",
        loginUrl: "https://login.example.com",
        saveCredentials: true
      }
    } as any

    const loginFn = oauthLogin(conf)!
    const result = await loginFn()
    // Should fall through to login flow since deserialized token is incomplete
    expect(mockLoginServer).toHaveBeenCalled()
    expect(result).toBe("fallback")
  })
})
