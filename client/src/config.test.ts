// Must mock vscode before any imports that reference it
jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(),
    workspaceFolders: [] as any[],
    onDidChangeConfiguration: jest.fn()
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  Uri: {
    parse: jest.fn((s: string) => ({ toString: () => s }))
  }
}), { virtual: true })

jest.mock("./services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showInputBox: jest.fn()
  }
}))
jest.mock("abap-adt-api", () => ({
  ADTClient: jest.fn().mockImplementation(() => ({})),
  createSSLConfig: jest.fn(() => ({})),
  LogCallback: jest.fn()
}))
const mockVault = {
  getPassword: jest.fn().mockResolvedValue(null),
  setPassword: jest.fn().mockResolvedValue(true),
  deletePassword: jest.fn().mockResolvedValue(true)
}
jest.mock("./lib", () => ({
  mongoApiLogger: jest.fn(() => undefined),
  mongoHttpLogger: jest.fn(() => undefined),
  PasswordVault: {
    get: jest.fn(() => mockVault)
  }
}))
jest.mock("method-call-logger", () => ({
  createProxy: jest.fn((client: any) => client)
}))
jest.mock("./oauth", () => ({ oauthLogin: jest.fn(() => undefined) }))
jest.mock("./adt/conections", () => ({ ADTSCHEME: "adt" }))
jest.mock("./adt/adtCommLog", () => ({
  CallLogger: { get: jest.fn(() => undefined) }
}))
jest.mock("vscode-abap-remote-fs-sharedapi", () => ({
  clientTraceUrl: jest.fn(() => undefined),
  httpTraceUrl: jest.fn(() => undefined),
  SOURCE_CLIENT: "client"
}))
jest.mock("fs", () => ({
  readFileSync: jest.fn(() => { throw new Error("not found") })
}))

import { workspace, ConfigurationTarget } from "vscode"
import {
  formatKey,
  connectedRoots,
  getConfig,
  validateNewConfigId,
  saveNewRemote,
  createClient,
  RemoteManager,
  RemoteConfig
} from "./config"

// ---- helpers ----------------------------------------------------------------

function mockWorkspaceConfig(remotes: Record<string, any> = {}, inspect?: any) {
  const configObject: any = {
    get: jest.fn((key: string, defaultVal?: any) => {
      if (key === "remote") return remotes
      return defaultVal
    }),
    update: jest.fn().mockResolvedValue(undefined),
    inspect: jest.fn((key: string) => inspect || {
      globalValue: remotes,
      workspaceValue: {},
      workspaceFolderValue: {}
    }),
    remote: remotes
  }
  ;(workspace.getConfiguration as jest.Mock).mockReturnValue(configObject)
  return configObject
}

// ---- formatKey --------------------------------------------------------------

describe("formatKey", () => {
  test("lowercases the key", () => {
    expect(formatKey("MYKEY")).toBe("mykey")
    expect(formatKey("MixedCase")).toBe("mixedcase")
    expect(formatKey("already_lower")).toBe("already_lower")
  })

  test("handles empty string", () => {
    expect(formatKey("")).toBe("")
  })
})

// ---- connectedRoots ---------------------------------------------------------

describe("connectedRoots", () => {
  test("returns empty map when no workspace folders", () => {
    ;(workspace as any).workspaceFolders = undefined
    const roots = connectedRoots()
    expect(roots.size).toBe(0)
  })

  test("returns empty map when folders have non-adt scheme", () => {
    ;(workspace as any).workspaceFolders = [
      { uri: { scheme: "file", authority: "local" }, name: "local" }
    ]
    const roots = connectedRoots()
    expect(roots.size).toBe(0)
  })

  test("returns map with adt-scheme folders keyed by lowercased authority", () => {
    ;(workspace as any).workspaceFolders = [
      { uri: { scheme: "adt", authority: "DEV100" }, name: "DEV100" },
      { uri: { scheme: "file", authority: "local" }, name: "local" }
    ]
    const roots = connectedRoots()
    expect(roots.size).toBe(1)
    expect(roots.has("dev100")).toBe(true)
  })

  test("lowercases authority keys", () => {
    ;(workspace as any).workspaceFolders = [
      { uri: { scheme: "adt", authority: "SYS_ONE" }, name: "SYS_ONE" }
    ]
    const roots = connectedRoots()
    expect(roots.has("sys_one")).toBe(true)
  })
})

// ---- getConfig --------------------------------------------------------------

describe("getConfig", () => {
  test("calls workspace.getConfiguration with 'abapfs'", () => {
    mockWorkspaceConfig()
    getConfig()
    expect(workspace.getConfiguration).toHaveBeenCalledWith("abapfs")
  })
})

// ---- validateNewConfigId ----------------------------------------------------

describe("validateNewConfigId", () => {
  beforeEach(() => {
    mockWorkspaceConfig(
      { existingKey: {} },
      {
        globalValue: { existingKey: {} },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
  })

  test("rejects names shorter than 3 characters", () => {
    const validator = validateNewConfigId(ConfigurationTarget.Global)
    expect(validator("ab")).toMatch(/3 characters/)
  })

  test("rejects names with special characters", () => {
    const validator = validateNewConfigId(ConfigurationTarget.Global)
    expect(validator("abc!@#")).toMatch(/Unexpected character/)
  })

  test("rejects duplicate keys (case-insensitive)", () => {
    const validator = validateNewConfigId(ConfigurationTarget.Global)
    expect(validator("EXISTINGKEY")).toMatch(/already in use/)
    expect(validator("existingkey")).toMatch(/already in use/)
  })

  test("accepts valid new keys", () => {
    const validator = validateNewConfigId(ConfigurationTarget.Global)
    expect(validator("NewSystem123")).toBeUndefined()
    expect(validator("my-system_v2")).toBeUndefined()
  })

  test("accepts keys with hyphens and underscores", () => {
    const validator = validateNewConfigId(ConfigurationTarget.Global)
    expect(validator("my-conn_01")).toBeUndefined()
  })

  test("uses workspace config for WorkspaceFolder target", () => {
    mockWorkspaceConfig(
      {},
      {
        globalValue: {},
        workspaceValue: {},
        workspaceFolderValue: { wfkey: {} }
      }
    )
    const validator = validateNewConfigId(ConfigurationTarget.WorkspaceFolder)
    expect(validator("wfkey")).toMatch(/already in use/)
  })

  test("uses workspace value for Workspace target", () => {
    mockWorkspaceConfig(
      {},
      {
        globalValue: {},
        workspaceValue: { wskey: {} },
        workspaceFolderValue: {}
      }
    )
    const validator = validateNewConfigId(ConfigurationTarget.Workspace)
    expect(validator("wskey")).toMatch(/already in use/)
  })
})

// ---- saveNewRemote ----------------------------------------------------------

describe("saveNewRemote", () => {
  beforeEach(() => {
    mockWorkspaceConfig(
      {},
      {
        globalValue: {},
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
  })

  test("saves a new valid remote config", async () => {
    const cfg = mockWorkspaceConfig(
      {},
      { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} }
    )
    const remote: RemoteConfig = {
      name: "mySystem",
      url: "https://host:8443",
      username: "user1",
      password: ""
    } as any

    await saveNewRemote(remote, ConfigurationTarget.Global)
    expect(cfg.update).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ mySystem: remote }),
      ConfigurationTarget.Global
    )
  })

  test("throws when validation fails (name too short)", async () => {
    mockWorkspaceConfig(
      {},
      { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} }
    )
    const remote = { name: "ab", url: "https://host", username: "user" } as any
    await expect(saveNewRemote(remote, ConfigurationTarget.Global)).rejects.toThrow()
  })

  test("throws when key already exists", async () => {
    mockWorkspaceConfig(
      { taken: {} },
      { globalValue: { taken: {} }, workspaceValue: {}, workspaceFolderValue: {} }
    )
    const remote = { name: "taken", url: "https://host", username: "user" } as any
    await expect(saveNewRemote(remote, ConfigurationTarget.Global)).rejects.toThrow(/already in use/)
  })
})

// ---- createClient -----------------------------------------------------------

describe("createClient", () => {
  test("creates an ADTClient for an http URL", () => {
    const { ADTClient } = require("abap-adt-api")
    const conf: RemoteConfig = {
      name: "dev",
      url: "http://host:50000",
      username: "user",
      password: "pass",
      client: "100",
      language: "EN"
    } as any
    createClient(conf)
    expect(ADTClient).toHaveBeenCalledWith(
      "http://host:50000",
      "user",
      expect.anything(),
      "100",
      "EN",
      expect.any(Object)
    )
  })

  test("creates an ADTClient for an https URL with SSL config", () => {
    const { ADTClient, createSSLConfig } = require("abap-adt-api")
    ;(createSSLConfig as jest.Mock).mockReturnValue({ rejectUnauthorized: true })
    const conf: RemoteConfig = {
      name: "dev",
      url: "https://host:8443",
      username: "user",
      password: "pass",
      client: "100",
      language: "EN",
      allowSelfSigned: false
    } as any
    createClient(conf)
    expect(createSSLConfig).toHaveBeenCalledWith(false, undefined)
    expect(ADTClient).toHaveBeenCalled()
  })

  test("uses oauth password when oauthLogin returns a value", () => {
    const { ADTClient } = require("abap-adt-api")
    const { oauthLogin } = require("./oauth")
    ;(oauthLogin as jest.Mock).mockReturnValue("oauth-token")
    const conf: RemoteConfig = {
      name: "dev",
      url: "http://host",
      username: "user",
      password: "normalpass"
    } as any
    createClient(conf)
    const [, , password] = (ADTClient as jest.Mock).mock.calls.at(-1)
    expect(password).toBe("oauth-token")
  })

  test("falls back to conf.password when oauthLogin returns undefined", () => {
    const { ADTClient } = require("abap-adt-api")
    const { oauthLogin } = require("./oauth")
    ;(oauthLogin as jest.Mock).mockReturnValue(undefined)
    const conf: RemoteConfig = {
      name: "dev",
      url: "http://host",
      username: "user",
      password: "mypass"
    } as any
    createClient(conf)
    const [, , password] = (ADTClient as jest.Mock).mock.calls.at(-1)
    expect(password).toBe("mypass")
  })
})

// ---- RemoteManager singleton -----------------------------------------------

describe("RemoteManager", () => {
  // Reset singleton between tests
  beforeEach(() => {
    ;(RemoteManager as any).instance = undefined
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
    ;(workspace as any).workspaceFolders = []
  })

  test("get() returns singleton instance", () => {
    mockWorkspaceConfig()
    const a = RemoteManager.get()
    const b = RemoteManager.get()
    expect(a).toBe(b)
  })

  test("byId returns undefined for unknown connection", () => {
    mockWorkspaceConfig()
    const manager = RemoteManager.get()
    expect(manager.byId("nonexistent")).toBeUndefined()
  })

  test("byId is case-insensitive", async () => {
    mockWorkspaceConfig(
      {
        DEV100: { url: "https://host", username: "user", password: "" }
      },
      {
        globalValue: { DEV100: { url: "https://host", username: "user", password: "" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    const manager = RemoteManager.get()
    // First load via byIdAsync
    await manager.byIdAsync("DEV100")
    expect(manager.byId("dev100")).toBeDefined()
    expect(manager.byId("DEV100")).toBeDefined()
  })

  test("byIdAsync returns undefined for completely missing connection", async () => {
    mockWorkspaceConfig(
      {},
      { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} }
    )
    ;(RemoteManager as any).instance = undefined
    const manager = RemoteManager.get()
    const result = await manager.byIdAsync("ghost")
    expect(result).toBeUndefined()
  })

  test("savePassword stores password in vault and updates cached conn", async () => {
    const vault = require("./lib").PasswordVault.get()
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    ;(RemoteManager as any).instance = undefined
    const manager = RemoteManager.get()
    await manager.byIdAsync("dev")
    await manager.savePassword("dev", "user", "secret")
    expect(vault.setPassword).toHaveBeenCalledWith(
      "vscode.abapfs.dev",
      "user",
      "secret"
    )
    expect(manager.byId("dev")?.password).toBe("secret")
  })

  test("getPassword returns empty string when vault has no password", async () => {
    const vault = require("./lib").PasswordVault.get()
    ;(vault.getPassword as jest.Mock).mockResolvedValue(null)
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig()
    const manager = RemoteManager.get()
    const pwd = await manager.getPassword("dev", "user")
    expect(pwd).toBe("")
  })

  test("clearPassword removes password from vault", async () => {
    const vault = require("./lib").PasswordVault.get()
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig()
    const manager = RemoteManager.get()
    const result = await manager.clearPassword("dev", "user")
    expect(result).toBe(true)
    expect(vault.deletePassword).toHaveBeenCalledWith("vscode.abapfs.dev", "user")
  })

  test("askPassword returns undefined when user cancels", async () => {
    const { funWindow: w } = require("./services/funMessenger")
    ;(w.showInputBox as jest.Mock).mockResolvedValue(undefined)
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    const manager = RemoteManager.get()
    await manager.byIdAsync("dev")
    const pwd = await manager.askPassword("dev")
    expect(pwd).toBeUndefined()
  })

  test("selectConnection with empty remote list throws", async () => {
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig(
      {},
      { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} }
    )
    const manager = RemoteManager.get()
    // remoteList throws if no remote key
    const mockCfg = {
      get: jest.fn(),
      update: jest.fn(),
      inspect: jest.fn(),
      remote: undefined // no remote key
    }
    ;(workspace.getConfiguration as jest.Mock).mockReturnValue(mockCfg)
    await expect(manager.selectConnection()).rejects.toThrow()
  })

  test("selectConnection returns first remote without prompting when only one", async () => {
    const { funWindow: w } = require("./services/funMessenger")
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    const vault = require("./lib").PasswordVault.get()
    ;(vault.getPassword as jest.Mock).mockResolvedValue("stored-pass")
    const manager = RemoteManager.get()
    const { remote, userCancel } = await manager.selectConnection()
    expect(w.showQuickPick).not.toHaveBeenCalled()
    expect(remote).toBeDefined()
    expect(userCancel).toBe(false)
  })

  test("selectConnection uses connectionId to skip quick pick", async () => {
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig(
      {
        dev1: { url: "https://h1", username: "u1", password: "" },
        dev2: { url: "https://h2", username: "u2", password: "" }
      },
      {
        globalValue: {
          dev1: { url: "https://h1", username: "u1", password: "" },
          dev2: { url: "https://h2", username: "u2", password: "" }
        },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    const vault = require("./lib").PasswordVault.get()
    ;(vault.getPassword as jest.Mock).mockResolvedValue("")
    const { funWindow: w } = require("./services/funMessenger")
    const manager = RemoteManager.get()
    const { remote, userCancel } = await manager.selectConnection("dev1")
    expect(w.showQuickPick).not.toHaveBeenCalled()
    expect(remote?.name).toBe("dev1")
    expect(userCancel).toBe(false)
  })
})
