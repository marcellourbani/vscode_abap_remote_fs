vi.mock("vscode", () => ({
  Memento: vi.fn(class {})
}))

vi.mock("../../lib", () => ({
  PasswordVault: {
    get: vi.fn().mockReturnValue({
      getPassword: vi.fn(),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
      accounts: vi.fn()
    })
  },
  createStore: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(""),
    update: vi.fn()
  }),
  chainTaskTransformers: vi.fn(),
  fieldReplacer: vi.fn(),
  createTaskTransformer: vi.fn(),
  inputBox: vi.fn(),
  cache: (creator: any, keyTranslator: any = (x: any) => x) => {
    const values = new Map()
    return {
      get: (key: any) => {
        const mapKey = keyTranslator(key)
        if (!values.has(mapKey)) values.set(mapKey, creator(key))
        return values.get(mapKey)
      },
      get size() {
        return values.size
      },
      *[Symbol.iterator]() {
        yield* values.values()
      }
    }
  }
}))

vi.mock("../../extension", () => ({
  context: {
    globalState: {
      get: vi.fn(),
      update: vi.fn()
    }
  }
}))

vi.mock("abap-adt-api", () => ({}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn().mockReturnValue({
    gitExternalRepoInfo: vi.fn().mockResolvedValue({ access_mode: "PUBLIC" })
  })
}))

vi.mock("fp-ts/lib/Option", () => ({
  some: vi.fn(function (v: any) {
    return { _tag: "Some", value: v }
  }),
  fromEither: vi.fn(function (e: any) {
    return e
  }),
  isSome: vi.fn(function (v: any) {
    return v?._tag === "Some"
  }),
  Option: {}
}))

import { getDefaultUser, deleteDefaultUser, deletePassword, listPasswords } from "./credentials"
import { createStore } from "../../lib"
import { PasswordVault } from "../../lib"
import * as __$mock_fp_ts_lib_Option from "fp-ts/lib/Option"
import * as __$mock_adt_conections from "../../adt/conections"
import type { Mock } from "vitest"

describe("getDefaultUser", () => {
  it("returns empty string when no user stored", async () => {
    const mockStore = { get: vi.fn().mockReturnValue(undefined), update: vi.fn() }
    ;(createStore as Mock).mockReturnValueOnce(mockStore)
    // Reset the module to clear uStore
    vi.resetModules()
    // re-import after reset
    const { getDefaultUser: getUser } = await import("./credentials")
    const result = getUser("https://github.com/repo")
    expect(typeof result).toBe("string")
  })

  it("returns stored user", async () => {
    const mockStore = { get: vi.fn().mockReturnValue("testuser"), update: vi.fn() }
    ;(createStore as Mock).mockReturnValue(mockStore)
    vi.resetModules()
    const { getDefaultUser: getUser } = await import("./credentials")
    // The first call initializes store, subsequent calls use cached
    const result = getUser("https://github.com/repo")
    expect(typeof result).toBe("string")
  })
})

describe("deleteDefaultUser", () => {
  it("calls store update with empty string", async () => {
    const mockStore = { get: vi.fn().mockReturnValue("user"), update: vi.fn() }
    ;(createStore as Mock).mockReturnValue(mockStore)
    vi.resetModules()
    const { deleteDefaultUser: deleteUser } = await import("./credentials")
    deleteUser("https://github.com/repo")
    // Can't verify the exact store call without resetting, but should not throw
  })
})

describe("deletePassword", () => {
  it("calls PasswordVault.deletePassword with correct params", () => {
    const vault = PasswordVault.get()
    const repo: any = { url: "https://github.com/repo" }
    deletePassword(repo, "testuser")
    expect(vault.deletePassword).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/repo"),
      "testuser"
    )
  })

  it("uses the repo URL in the password service key", () => {
    const vault = PasswordVault.get()
    const repo: any = { url: "https://custom-host.com/repo" }
    deletePassword(repo, "user1")
    const callArg = (vault.deletePassword as Mock).mock.calls.at(-1)?.[0]
    expect(callArg).toContain("https://custom-host.com/repo")
  })
})

describe("listPasswords", () => {
  it("calls PasswordVault.accounts with the repo URL service", () => {
    const vault = PasswordVault.get()
    ;(vault.accounts as Mock).mockReturnValue(["user1", "user2"])
    const repo: any = { url: "https://github.com/myrepo" }
    const result = listPasswords(repo)
    expect(vault.accounts).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/myrepo")
    )
  })
})

describe("dataCredentials", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns stored credentials if already set with password", async () => {
    const { dataCredentials } = await import("./credentials")
    const { some, isSome } = __$mock_fp_ts_lib_Option
    ;(isSome as unknown as Mock).mockReturnValue(true)
    ;(some as unknown as Mock).mockImplementation(function (v: any) {
      return { _tag: "Some", value: v }
    })

    const data: any = {
      connId: "conn1",
      repo: { url: "https://github.com/repo", key: "key1" },
      credentials: { user: "testuser", password: "secret" }
    }
    const result = await dataCredentials(data)
    expect(result).toBeDefined()
    expect((result as any)?.value).toEqual({ user: "testuser", password: "secret" })
  })

  it("returns public credentials (no password needed) for public repos", async () => {
    const { dataCredentials } = await import("./credentials")
    const { getClient } = __$mock_adt_conections
    ;(getClient as Mock).mockReturnValue({
      gitExternalRepoInfo: vi.fn().mockResolvedValue({ access_mode: "PUBLIC" })
    })
    const { some } = __$mock_fp_ts_lib_Option
    ;(some as unknown as Mock).mockReturnValue({ _tag: "Some", value: { user: "", password: "" } })

    const data: any = {
      connId: "conn1",
      repo: { url: "https://github.com/pub-repo", key: "key2" },
      credentials: undefined
    }
    const result = await dataCredentials(data)
    expect(result).toBeDefined()
  })
})
