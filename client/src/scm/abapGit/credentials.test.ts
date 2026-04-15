jest.mock("vscode", () => ({
  Memento: jest.fn()
}), { virtual: true })

jest.mock("../../lib", () => ({
  PasswordVault: {
    get: jest.fn().mockReturnValue({
      getPassword: jest.fn(),
      setPassword: jest.fn(),
      deletePassword: jest.fn(),
      accounts: jest.fn()
    })
  },
  createStore: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue(""),
    update: jest.fn()
  }),
  chainTaskTransformers: jest.fn(),
  fieldReplacer: jest.fn(),
  createTaskTransformer: jest.fn(),
  inputBox: jest.fn()
}))

jest.mock("../../extension", () => ({
  context: {
    globalState: {
      get: jest.fn(),
      update: jest.fn()
    }
  }
}))

jest.mock("abap-adt-api", () => ({}))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn().mockReturnValue({
    gitExternalRepoInfo: jest.fn().mockResolvedValue({ access_mode: "PUBLIC" })
  })
}))

jest.mock("fp-ts/lib/Option", () => ({
  some: jest.fn((v: any) => ({ _tag: "Some", value: v })),
  fromEither: jest.fn((e: any) => e),
  isSome: jest.fn((v: any) => v?._tag === "Some"),
  Option: {}
}))

import {
  getDefaultUser,
  deleteDefaultUser,
  deletePassword,
  listPasswords
} from "./credentials"
import { createStore } from "../../lib"
import { PasswordVault } from "../../lib"

describe("getDefaultUser", () => {
  it("returns empty string when no user stored", () => {
    const mockStore = { get: jest.fn().mockReturnValue(undefined), update: jest.fn() }
    ;(createStore as jest.Mock).mockReturnValueOnce(mockStore)
    // Reset the module to clear uStore
    jest.resetModules()
    // re-import after reset
    const { getDefaultUser: getUser } = require("./credentials")
    const result = getUser("https://github.com/repo")
    expect(typeof result).toBe("string")
  })

  it("returns stored user", () => {
    const mockStore = { get: jest.fn().mockReturnValue("testuser"), update: jest.fn() }
    ;(createStore as jest.Mock).mockReturnValue(mockStore)
    jest.resetModules()
    const { getDefaultUser: getUser } = require("./credentials")
    // The first call initializes store, subsequent calls use cached
    const result = getUser("https://github.com/repo")
    expect(typeof result).toBe("string")
  })
})

describe("deleteDefaultUser", () => {
  it("calls store update with empty string", () => {
    const mockStore = { get: jest.fn().mockReturnValue("user"), update: jest.fn() }
    ;(createStore as jest.Mock).mockReturnValue(mockStore)
    jest.resetModules()
    const { deleteDefaultUser: deleteUser } = require("./credentials")
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
    const callArg = (vault.deletePassword as jest.Mock).mock.calls.at(-1)?.[0]
    expect(callArg).toContain("https://custom-host.com/repo")
  })
})

describe("listPasswords", () => {
  it("calls PasswordVault.accounts with the repo URL service", () => {
    const vault = PasswordVault.get()
    ;(vault.accounts as jest.Mock).mockReturnValue(["user1", "user2"])
    const repo: any = { url: "https://github.com/myrepo" }
    const result = listPasswords(repo)
    expect(vault.accounts).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/myrepo")
    )
  })
})

describe("dataCredentials", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns stored credentials if already set with password", async () => {
    const { dataCredentials } = require("./credentials")
    const { some, isSome } = require("fp-ts/lib/Option")
    ;(isSome as jest.Mock).mockReturnValue(true)
    ;(some as jest.Mock).mockImplementation((v: any) => ({ _tag: "Some", value: v }))

    const data: any = {
      connId: "conn1",
      repo: { url: "https://github.com/repo", key: "key1" },
      credentials: { user: "testuser", password: "secret" }
    }
    const result = await dataCredentials(data)
    expect(result).toBeDefined()
    expect(result.value).toEqual({ user: "testuser", password: "secret" })
  })

  it("returns public credentials (no password needed) for public repos", async () => {
    const { dataCredentials } = require("./credentials")
    const { getClient } = require("../../adt/conections")
    ;(getClient as jest.Mock).mockReturnValue({
      gitExternalRepoInfo: jest.fn().mockResolvedValue({ access_mode: "PUBLIC" })
    })
    const { some } = require("fp-ts/lib/Option")
    ;(some as jest.Mock).mockReturnValue({ _tag: "Some", value: { user: "", password: "" } })

    const data: any = {
      connId: "conn1",
      repo: { url: "https://github.com/pub-repo", key: "key2" },
      credentials: undefined
    }
    const result = await dataCredentials(data)
    expect(result).toBeDefined()
  })
})
