// Must mock vscode before any imports that reference it
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(),
    workspaceFolders: [] as any[],
    onDidChangeConfiguration: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s }
    })
  }
}))

vi.mock("./services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn()
  }
}))
vi.mock("abap-adt-api", () => ({
  ADTClient: vi.fn().mockImplementation(function () {
    return {}
  }),
  createSSLConfig: vi.fn(function () {
    return {}
  }),
  LogCallback: vi.fn(class {})
}))
const { mockVault } = vi.hoisted(() => {
  const mockVault = {
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn().mockResolvedValue(true),
    deletePassword: vi.fn().mockResolvedValue(true)
  }
  return { mockVault }
})
vi.mock("./lib", () => ({
  PasswordVault: {
    get: vi.fn(function () {
      return mockVault
    })
  }
}))
vi.mock("./oauth", () => ({
  oauthLogin: vi.fn(function () {
    return undefined
  })
}))
vi.mock("./adt/conections", () => ({ ADTSCHEME: "adt" }))
vi.mock("./adt/adtCommLog", () => ({
  CallLogger: {
    get: vi.fn(function () {
      return undefined
    })
  }
}))
vi.mock("vscode-abap-remote-fs-sharedapi", () => ({
  getAuthMethod: vi.fn(function (c: any) {
    return c.authMethod || "basic"
  }),
  hasCertAuthConfig: vi.fn(),
  hasOAuthOnPremConfig: vi.fn()
}))
vi.mock("fs", () => ({
  readFileSync: vi.fn(function () {
    throw new Error("not found")
  })
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
  type RemoteConfig
} from "./config"
import * as __$mock_abap_adt_api from "abap-adt-api"
import * as __$mock_oauth from "./oauth"
import * as __$mock_lib from "./lib"
import * as __$mock_services_funMessenger from "./services/funMessenger"
import type { Mock } from "vitest"

// ---- helpers ----------------------------------------------------------------

function mockWorkspaceConfig(remotes: Record<string, any> = {}, inspect?: any) {
  const configObject: any = {
    get: vi.fn(function (key: string, defaultVal?: any) {
      if (key === "remote") return remotes
      return defaultVal
    }),
    update: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn(function (key: string) {
      return (
        inspect || {
          globalValue: remotes,
          workspaceValue: {},
          workspaceFolderValue: {}
        }
      )
    }),
    remote: remotes
  }
  ;(workspace.getConfiguration as Mock).mockReturnValue(configObject)
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
    const { name, ...rest } = remote
    expect(cfg.update).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ mySystem: rest }),
      ConfigurationTarget.Global
    )
  })

  test("throws when validation fails (name too short)", async () => {
    mockWorkspaceConfig({}, { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} })
    const remote = { name: "ab", url: "https://host", username: "user" } as any
    await expect(saveNewRemote(remote, ConfigurationTarget.Global)).rejects.toThrow()
  })

  test("throws when key already exists", async () => {
    mockWorkspaceConfig(
      { taken: {} },
      { globalValue: { taken: {} }, workspaceValue: {}, workspaceFolderValue: {} }
    )
    const remote = { name: "taken", url: "https://host", username: "user" } as any
    await expect(saveNewRemote(remote, ConfigurationTarget.Global)).rejects.toThrow(
      /already in use/
    )
  })
})

// ---- createClient -----------------------------------------------------------

describe("createClient", () => {
  test("creates an ADTClient for an http URL", () => {
    const { ADTClient } = __$mock_abap_adt_api
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
    const { ADTClient, createSSLConfig } = __$mock_abap_adt_api
    ;(createSSLConfig as Mock).mockReturnValue({ rejectUnauthorized: true })
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
    const { ADTClient } = __$mock_abap_adt_api
    const { oauthLogin } = __$mock_oauth
    ;(oauthLogin as Mock).mockReturnValue("oauth-token")
    const conf: RemoteConfig = {
      name: "dev",
      url: "http://host",
      username: "user",
      password: "normalpass"
    } as any
    createClient(conf)
    const [, , password] = (ADTClient as unknown as Mock).mock.calls.at(-1)!
    expect(password).toBe("oauth-token")
  })

  test("falls back to conf.password when oauthLogin returns undefined", () => {
    const { ADTClient } = __$mock_abap_adt_api
    const { oauthLogin } = __$mock_oauth
    ;(oauthLogin as Mock).mockReturnValue(undefined)
    const conf: RemoteConfig = {
      name: "dev",
      url: "http://host",
      username: "user",
      password: "mypass"
    } as any
    createClient(conf)
    const [, , password] = (ADTClient as unknown as Mock).mock.calls.at(-1)!
    expect(password).toBe("mypass")
  })
})

// ---- RemoteManager singleton -----------------------------------------------

describe("RemoteManager", () => {
  // Reset singleton between tests
  beforeEach(() => {
    ;(RemoteManager as any).instance = undefined
    ;(workspace.onDidChangeConfiguration as Mock).mockReturnValue({ dispose: vi.fn() })
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
    mockWorkspaceConfig({}, { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} })
    ;(RemoteManager as any).instance = undefined
    const manager = RemoteManager.get()
    const result = await manager.byIdAsync("ghost")
    expect(result).toBeUndefined()
  })

  test("savePassword stores password in vault and updates cached conn", async () => {
    const vault = __$mock_lib.PasswordVault.get()
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
    expect(vault.setPassword).toHaveBeenCalledWith("vscode.abapfs.dev", "user", "secret")
    expect(manager.byId("dev")?.password).toBe("secret")
  })

  test("byIdAsync ignores a password in settings when loading basic auth", async () => {
    const vault = __$mock_lib.PasswordVault.get()
    ;(vault.getPassword as Mock).mockResolvedValue("vault-pass")
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "settings-pass" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "settings-pass" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    ;(RemoteManager as any).instance = undefined
    const manager = RemoteManager.get()

    const connection = await manager.byIdAsync("dev")

    expect(vault.getPassword).toHaveBeenCalledWith("vscode.abapfs.dev", "user")
    expect(connection?.password).toBe("vault-pass")
  })

  test("byIdAsync refreshes the vault password for a cached basic connection", async () => {
    const vault = __$mock_lib.PasswordVault.get()
    ;(vault.getPassword as Mock).mockResolvedValueOnce("settings-era-pass")
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "settings-pass" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "settings-pass" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    ;(RemoteManager as any).instance = undefined
    const manager = RemoteManager.get()
    const connection = await manager.byIdAsync("dev")

    ;(vault.getPassword as Mock).mockResolvedValueOnce("new-vault-pass")
    await manager.byIdAsync("dev")

    expect(connection?.password).toBe("new-vault-pass")
  })

  test("getPassword returns empty string when vault has no password", async () => {
    const vault = __$mock_lib.PasswordVault.get()
    ;(vault.getPassword as Mock).mockResolvedValue(null)
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig()
    const manager = RemoteManager.get()
    const pwd = await manager.getPassword("dev", "user")
    expect(pwd).toBe("")
  })

  test("clearPassword removes password from vault", async () => {
    const vault = __$mock_lib.PasswordVault.get()
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig()
    const manager = RemoteManager.get()
    const result = await manager.clearPassword("dev", "user")
    expect(result).toBe(true)
    expect(vault.deletePassword).toHaveBeenCalledWith("vscode.abapfs.dev", "user")
  })

  test("askPassword returns undefined when user cancels", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showInputBox as Mock).mockResolvedValue(undefined)
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
    mockWorkspaceConfig({}, { globalValue: {}, workspaceValue: {}, workspaceFolderValue: {} })
    const manager = RemoteManager.get()
    // remoteList throws if no remote key
    const mockCfg = {
      get: vi.fn(),
      update: vi.fn(),
      inspect: vi.fn(),
      remote: undefined // no remote key
    }
    ;(workspace.getConfiguration as Mock).mockReturnValue(mockCfg)
    await expect(manager.selectConnection()).rejects.toThrow()
  })

  test("selectConnection returns metadata without loading a password", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(RemoteManager as any).instance = undefined
    mockWorkspaceConfig(
      { dev: { url: "https://host", username: "user", password: "" } },
      {
        globalValue: { dev: { url: "https://host", username: "user", password: "" } },
        workspaceValue: {},
        workspaceFolderValue: {}
      }
    )
    const vault = __$mock_lib.PasswordVault.get()
    ;(vault.getPassword as Mock).mockResolvedValue("stored-pass")
    ;(vault.getPassword as Mock).mockClear()
    const manager = RemoteManager.get()
    const { remote, userCancel } = await manager.selectConnection()
    expect(w.showQuickPick).not.toHaveBeenCalled()
    expect(remote).toBeDefined()
    expect(remote?.password).toBe("")
    expect(vault.getPassword).not.toHaveBeenCalled()
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
    const vault = __$mock_lib.PasswordVault.get()
    ;(vault.getPassword as Mock).mockResolvedValue("")
    const { funWindow: w } = __$mock_services_funMessenger
    const manager = RemoteManager.get()
    const { remote, userCancel } = await manager.selectConnection("dev1")
    expect(w.showQuickPick).not.toHaveBeenCalled()
    expect(remote?.name).toBe("dev1")
    expect(userCancel).toBe(false)
  })
})
