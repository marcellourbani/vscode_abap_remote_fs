// Tests for oauth/grantStorage.ts
jest.mock("../extension", () => ({
  context: {
    globalState: {
      get: jest.fn(() => []),
      update: jest.fn()
    }
  }
}))

jest.mock("../lib", () => ({
  PasswordVault: {
    get: jest.fn(() => ({
      setPassword: jest.fn(),
      deletePassword: jest.fn(),
      getPassword: jest.fn()
    }))
  },
  log: jest.fn()
}))

import { getToken, setToken, strip, storeTokens, clearTokens, loadTokens, TokenData } from "./grantStorage"
import { PasswordVault, log } from "../lib"
import { context } from "../extension"

const makeToken = (id = "test"): TokenData => ({
  tokenType: "Bearer",
  accessToken: `access-${id}`,
  refreshToken: `refresh-${id}`
})

describe("grantStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the in-memory tokens map by clearing known entries
    clearTokens().catch(() => {})
  })

  describe("strip", () => {
    it("keeps only tokenType, accessToken, refreshToken", () => {
      const full = { tokenType: "Bearer", accessToken: "a", refreshToken: "r", extra: "x" } as any
      const result = strip(full)
      expect(result).toEqual({ tokenType: "Bearer", accessToken: "a", refreshToken: "r" })
      expect((result as any).extra).toBeUndefined()
    })

    it("returns a new object", () => {
      const token = makeToken()
      const result = strip(token)
      expect(result).not.toBe(token)
    })
  })

  describe("getToken / setToken", () => {
    it("returns undefined for unknown connId", () => {
      expect(getToken("unknown-conn")).toBeUndefined()
    })

    it("stores and retrieves a token", () => {
      const token = makeToken()
      setToken("conn1", token)
      const retrieved = getToken("conn1")
      expect(retrieved).toEqual({ tokenType: "Bearer", accessToken: "access-test", refreshToken: "refresh-test" })
    })

    it("setToken strips the token (only keeps required fields)", () => {
      const extendedToken = { ...makeToken(), extra: "should-be-removed" } as any
      setToken("conn2", extendedToken)
      const retrieved = getToken("conn2")
      expect((retrieved as any)?.extra).toBeUndefined()
    })

    it("overwrites existing token for same connId", () => {
      setToken("conn3", makeToken("v1"))
      setToken("conn3", { tokenType: "Bearer", accessToken: "access-v2", refreshToken: "refresh-v2" })
      expect(getToken("conn3")?.accessToken).toBe("access-v2")
    })
  })

  describe("storeTokens", () => {
    it("stores tokens via PasswordVault", async () => {
      const vault = { setPassword: jest.fn(), deletePassword: jest.fn() }
      ;(PasswordVault.get as jest.Mock).mockReturnValue(vault)
      ;(context.globalState.update as jest.Mock).mockResolvedValue(undefined)

      setToken("conn-store", makeToken("store"))
      await storeTokens()

      expect(vault.setPassword).toHaveBeenCalledWith(
        "oauth-tokens",
        "conn-store",
        expect.stringContaining("access-store")
      )
    })

    it("falls back to globalState on vault error", async () => {
      ;(PasswordVault.get as jest.Mock).mockReturnValue({
        setPassword: jest.fn().mockRejectedValue(new Error("vault error"))
      })
      ;(context.globalState.update as jest.Mock).mockResolvedValue(undefined)

      setToken("conn-fallback", makeToken("fallback"))
      await storeTokens()

      expect(context.globalState.update).toHaveBeenCalled()
    })
  })

  describe("clearTokens", () => {
    it("removes all tokens from vault and memory", async () => {
      const vault = { setPassword: jest.fn(), deletePassword: jest.fn() }
      ;(PasswordVault.get as jest.Mock).mockReturnValue(vault)
      ;(context.globalState.update as jest.Mock).mockResolvedValue(undefined)

      setToken("conn-clear", makeToken("clear"))
      await clearTokens()

      expect(vault.deletePassword).toHaveBeenCalledWith("oauth-tokens", "conn-clear")
      expect(getToken("conn-clear")).toBeUndefined()
    })

    it("falls back gracefully on vault error", async () => {
      ;(PasswordVault.get as jest.Mock).mockReturnValue({
        deletePassword: jest.fn().mockRejectedValue(new Error("delete error"))
      })
      ;(context.globalState.update as jest.Mock).mockResolvedValue(undefined)

      setToken("conn-err", makeToken())
      await expect(clearTokens()).resolves.not.toThrow()
    })
  })

  describe("loadTokens", () => {
    it("migrates legacy tokens from globalState to vault", async () => {
      const legacyToken = makeToken("legacy")
      ;(context.globalState.get as jest.Mock).mockReturnValue([
        ["legacy-conn", legacyToken]
      ])
      const vault = { setPassword: jest.fn(), deletePassword: jest.fn() }
      ;(PasswordVault.get as jest.Mock).mockReturnValue(vault)
      ;(context.globalState.update as jest.Mock).mockResolvedValue(undefined)

      await loadTokens()

      expect(getToken("legacy-conn")).toBeDefined()
      expect(vault.setPassword).toHaveBeenCalled()
      expect(context.globalState.update).toHaveBeenCalledWith("oauth_grants", undefined)
    })

    it("handles empty globalState gracefully", async () => {
      ;(context.globalState.get as jest.Mock).mockReturnValue([])
      ;(PasswordVault.get as jest.Mock).mockReturnValue({ setPassword: jest.fn() })

      await expect(loadTokens()).resolves.not.toThrow()
    })

    it("falls back to legacy load on vault error", async () => {
      ;(PasswordVault.get as jest.Mock).mockReturnValue({
        setPassword: jest.fn().mockRejectedValue(new Error("vault broken"))
      })
      const fallbackToken = makeToken("fb")
      ;(context.globalState.get as jest.Mock).mockReturnValue([["fb-conn", fallbackToken]])

      await loadTokens()
      // Should not throw, and token loaded via fallback
      expect(getToken("fb-conn")).toBeDefined()
    })
  })
})
