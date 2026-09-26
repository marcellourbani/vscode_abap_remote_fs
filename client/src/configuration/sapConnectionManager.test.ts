vi.mock("vscode", () => {
  const postMessageMock = vi.fn()
  const webviewMock = {
    html: "",
    postMessage: postMessageMock,
    onDidReceiveMessage: vi.fn(),
    cspSource: "none"
  }

  return {
    ViewColumn: { One: 1 },
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => p }),
      joinPath: vi.fn(function (...args: any[]) {
        return { fsPath: args.join("/") }
      })
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: vi.fn(),
      fs: {
        writeFile: vi.fn().mockResolvedValue(undefined)
      }
    }
  }
})

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

vi.mock("../config", () => ({
  validateNewConfigId: vi.fn(function () {
    return (id: string) => undefined
  }), // passes by default
  formatKey: vi.fn(function (k: string) {
    return k.toLowerCase()
  }),
  RemoteConfig: {}
}))

vi.mock("../services/abapCopilotLogger", () => ({
  logCommands: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

vi.mock("../lib", () => {
  const vaultInstance = {
    deletePassword: vi.fn().mockResolvedValue(true),
    setPassword: vi.fn().mockResolvedValue(true),
    getPassword: vi.fn().mockResolvedValue(null)
  }
  return {
    PasswordVault: {
      get: vi.fn(function () {
        return vaultInstance
      })
    }
  }
})

vi.mock("abap_cloud_platform", () => ({
  isAbapServiceKey: vi.fn(function () {
    return false
  }),
  cfCodeGrant: vi.fn(),
  getAbapSystemInfo: vi.fn(),
  getAbapUserInfo: vi.fn(),
  loginServer: vi.fn(),
  cfInfo: vi.fn(),
  cfPasswordGrant: vi.fn(),
  cfOrganizations: vi.fn(),
  cfSpaces: vi.fn(),
  cfServices: vi.fn(),
  cfServiceInstances: vi.fn(),
  cfInstanceServiceKeys: vi.fn()
}))

import * as vscode from "vscode"
import { SapConnectionManager } from "./sapConnectionManager"
import { validateNewConfigId } from "../config"
import { logTelemetry } from "../services/telemetry"
import * as __$mock_services_funMessenger from "../services/funMessenger"
import * as __$mock_lib from "../lib"
import * as __$mock_abap_cloud_platform from "abap_cloud_platform"
import type { Mock } from "vitest"

// ---- helpers ----------------------------------------------------------------

let postMessageMock: Mock
let disposeListenerMock: Mock
let receiveMessageHandler: ((msg: any) => void) | undefined

function makePanelMock() {
  postMessageMock = vi.fn()
  disposeListenerMock = vi.fn()
  receiveMessageHandler = undefined

  return {
    webview: {
      html: "",
      postMessage: postMessageMock,
      onDidReceiveMessage: vi.fn(function (handler: any) {
        receiveMessageHandler = handler
        return { dispose: vi.fn() }
      }),
      cspSource: "none"
    },
    onDidDispose: vi.fn(function (cb: any) {
      disposeListenerMock = cb
      return { dispose: vi.fn() }
    }),
    reveal: vi.fn(),
    dispose: vi.fn()
  }
}

function makeWorkspaceConfig(
  globalRemotes: Record<string, any> = {},
  workspaceRemotes: Record<string, any> = {}
) {
  return {
    inspect: vi.fn(function () {
      return {
        globalValue: globalRemotes,
        workspaceValue: workspaceRemotes
      }
    }),
    update: vi.fn().mockResolvedValue(undefined)
  }
}

function createManager(): { manager: SapConnectionManager; panel: any; extensionUri: vscode.Uri } {
  const panel = makePanelMock()
  ;(__$mock_services_funMessenger.funWindow.createWebviewPanel as Mock).mockReturnValue(panel)
  const extensionUri = vscode.Uri.file("/ext")
  SapConnectionManager.createOrShow(extensionUri)
  const manager = (SapConnectionManager as any).currentPanel as SapConnectionManager
  return { manager, panel, extensionUri }
}

// ---- setup/teardown ---------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  ;(SapConnectionManager as any).currentPanel = undefined
})

// ---- createOrShow -----------------------------------------------------------

describe("SapConnectionManager.createOrShow", () => {
  test("creates a new panel and stores it as currentPanel", () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.createWebviewPanel as Mock).mockReturnValue(makePanelMock())
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    expect((SapConnectionManager as any).currentPanel).toBeDefined()
  })

  test("reuses existing panel on second call (reveal)", () => {
    const { funWindow: w } = __$mock_services_funMessenger
    const panel = makePanelMock()
    ;(w.createWebviewPanel as Mock).mockReturnValue(panel)
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    // createWebviewPanel should only be called once
    expect(w.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(panel.reveal).toHaveBeenCalled()
  })

  test("clears currentPanel when panel is disposed", () => {
    const { funWindow: w } = __$mock_services_funMessenger
    const panel = makePanelMock()
    ;(w.createWebviewPanel as Mock).mockReturnValue(panel)
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    expect((SapConnectionManager as any).currentPanel).toBeDefined()
    // Trigger dispose listener
    disposeListenerMock?.()
    expect((SapConnectionManager as any).currentPanel).toBeUndefined()
  })
})

// ---- message: ready / loadConnections ---------------------------------------

describe("message handling: ready / loadConnections", () => {
  test("sends connections to webview on 'ready' message", async () => {
    const cfg = makeWorkspaceConfig({ dev: { url: "https://h", username: "u" } })
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    createManager()

    await receiveMessageHandler!({ type: "ready" })

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "connections" }))
  })

  test("sends connections to webview on 'loadConnections' message", async () => {
    const cfg = makeWorkspaceConfig({})
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    createManager()

    await receiveMessageHandler!({ type: "loadConnections" })

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "connections" }))
  })

  test("connections message includes both user and workspace remotes", async () => {
    const cfg = makeWorkspaceConfig(
      { global_conn: { url: "https://g", username: "ug" } },
      { ws_conn: { url: "https://w", username: "uw" } }
    )
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    createManager()

    await receiveMessageHandler!({ type: "ready" })

    const call = postMessageMock.mock.calls.find((c: any[]) => c[0].type === "connections")
    expect(call![0].data.user).toHaveProperty("global_conn")
    expect(call![0].data.workspace).toHaveProperty("ws_conn")
  })
})

// ---- message: saveConnection - new connection -------------------------------

describe("message handling: saveConnection (new)", () => {
  test("saves new connection and sends success message", async () => {
    ;(validateNewConfigId as Mock).mockReturnValue((_id: string) => undefined)

    const connection = {
      url: "https://host:8443",
      username: "user",
      password: "",
      language: "en",
      allowSelfSigned: false,
      diff_formatter: "ADT formatter"
    }

    // First config call: get current remotes; second: verify save
    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: { newConn: connection }, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "saveConnection",
      connectionId: "newConn",
      connection,
      target: "user",
      isEdit: false
    })

    expect(cfg.update).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ newConn: expect.any(Object) }),
      vscode.ConfigurationTarget.Global
    )
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }))
    expect(logTelemetry).toHaveBeenCalledWith("command_connection_manager_save_called")
  })

  test("sends formValidationError when new connection id is invalid", async () => {
    ;(validateNewConfigId as Mock).mockReturnValue((_id: string) => "Key already in use")

    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: { newConn: {} }, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "saveConnection",
      connectionId: "newConn",
      connection: { url: "https://h", username: "u" },
      target: "user",
      isEdit: false
    })

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "formValidationError" })
    )
    expect(cfg.update).not.toHaveBeenCalled()
  })

  test("rolls back and sends error when save verification fails", async () => {
    ;(validateNewConfigId as Mock).mockReturnValue((_id: string) => undefined)

    const connection = { url: "https://h", username: "u" }

    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }), // missing after save
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "saveConnection",
      connectionId: "failConn",
      connection,
      target: "user",
      isEdit: false
    })

    // handleMessage is async but not awaited by the onDidReceiveMessage handler,
    // so we need to flush microtasks to let saveConnection complete
    await new Promise(r => setImmediate(r))

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })

  test("saves to workspace target when target is 'workspace'", async () => {
    ;(validateNewConfigId as Mock).mockReturnValue((_id: string) => undefined)

    const connection = { url: "https://h", username: "u" }
    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: { wsConn: connection } }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "saveConnection",
      connectionId: "wsConn",
      connection,
      target: "workspace",
      isEdit: false
    })

    expect(cfg.update).toHaveBeenCalledWith(
      "remote",
      expect.any(Object),
      vscode.ConfigurationTarget.Workspace
    )
  })

  // Regression guard for #385: cloud flow once passed an object as connectionId,
  // which corrupted settings.json with an "[object Object]" key.
  test("refuses to save when connectionId is an object (regression guard for #385)", async () => {
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "saveConnection",
      connectionId: { name: "oops", url: "https://h" } as any,
      connection: { url: "https://h", username: "u" },
      target: "user",
      isEdit: true
    })

    expect(cfg.update).not.toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "formValidationError",
        message: expect.stringContaining("invalid connection id")
      })
    )
  })

  test("refuses to save when connectionId is an empty string", async () => {
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "saveConnection",
      connectionId: "",
      connection: { url: "https://h", username: "u" },
      target: "user",
      isEdit: false
    })

    expect(cfg.update).not.toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "formValidationError" })
    )
  })
})

// ---- message: deleteConnection ----------------------------------------------

describe("message handling: deleteConnection", () => {
  test("deletes connection and sends success message", async () => {
    const existing = { dev: { url: "https://h", username: "u" } }

    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }), // verified deleted
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "deleteConnection",
      connectionId: "dev",
      target: "user"
    })

    // handleMessage is async but not awaited by the onDidReceiveMessage handler
    await new Promise(r => setImmediate(r))

    expect(cfg.update).toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }))
    expect(logTelemetry).toHaveBeenCalledWith("command_connection_manager_delete_called")
  })

  test("rolls back and sends error when connection still exists after deletion", async () => {
    const existing = { dev: { url: "https://h", username: "u" } }

    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} }), // still there!
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "deleteConnection",
      connectionId: "dev",
      target: "user"
    })

    await new Promise(r => setImmediate(r))

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })

  test("clears password from vault when deleting", async () => {
    const vault = __$mock_lib.PasswordVault.get()
    const existing = { dev: { url: "https://h", username: "myuser" } }

    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "deleteConnection",
      connectionId: "dev",
      target: "user"
    })

    await new Promise(r => setImmediate(r))

    expect(vault.deletePassword).toHaveBeenCalledWith("vscode.abapfs.dev", "myuser")
  })
})

// ---- message: importFromJson ------------------------------------------------

describe("message handling: importFromJson", () => {
  test("merges imported connections and sends success", async () => {
    const existing = { dev1: { url: "https://h1", username: "u1" } }
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    const newConns = { dev2: { url: "https://h2", username: "u2", client: "100" } }
    await receiveMessageHandler!({
      type: "importFromJson",
      jsonContent: JSON.stringify(newConns),
      target: "user"
    })

    expect(cfg.update).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ dev1: expect.any(Object), dev2: expect.any(Object) }),
      vscode.ConfigurationTarget.Global
    )
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }))
  })

  test("sends error message when JSON is invalid", async () => {
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "importFromJson",
      jsonContent: "not-valid-json{{",
      target: "user"
    })

    expect(cfg.update).not.toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })
})

// ---- message: confirmDeleteConnection ---------------------------------------

describe("message handling: confirmDeleteConnection", () => {
  test("calls deleteConnection when user confirms", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue("Delete")

    const existing = { dev: { url: "https://h", username: "u" } }
    const cfg = {
      inspect: vi
        .fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "confirmDeleteConnection",
      connectionId: "dev",
      target: "user"
    })

    expect(cfg.update).toHaveBeenCalled()
  })

  test("does not delete when user cancels", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "confirmDeleteConnection",
      connectionId: "dev",
      target: "user"
    })

    expect(cfg.update).not.toHaveBeenCalled()
  })
})

// ---- message: bulkDelete ----------------------------------------------------

describe("message handling: bulkDelete", () => {
  test("removes multiple connections", async () => {
    const existing = {
      conn1: { url: "https://h1", username: "u1" },
      conn2: { url: "https://h2", username: "u2" },
      keep: { url: "https://h3", username: "u3" }
    }
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "bulkDelete",
      connectionNames: ["conn1", "conn2"],
      target: "user"
    })

    const savedRemotes = cfg.update.mock.calls[0][1]
    expect(savedRemotes).not.toHaveProperty("conn1")
    expect(savedRemotes).not.toHaveProperty("conn2")
    expect(savedRemotes).toHaveProperty("keep")
  })
})

// ---- message: requestBulkUsernameEdit / bulkEditUsername --------------------

describe("message handling: requestBulkUsernameEdit / bulkEditUsername", () => {
  test("prompts for username and updates connections", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showInputBox as Mock).mockResolvedValue("newuser")

    const existing = {
      conn1: { url: "https://h1", username: "old1" },
      conn2: { url: "https://h2", username: "old2" }
    }
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "requestBulkUsernameEdit",
      connectionNames: ["conn1", "conn2"],
      target: "user"
    })

    const saved = cfg.update.mock.calls[0][1]
    expect(saved.conn1.username).toBe("newuser")
    expect(saved.conn2.username).toBe("newuser")
  })

  test("does not update when user cancels the username prompt", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showInputBox as Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "requestBulkUsernameEdit",
      connectionNames: ["conn1"],
      target: "user"
    })

    expect(cfg.update).not.toHaveBeenCalled()
  })

  test("bulkEditUsername directly updates usernames", async () => {
    const existing = { conn1: { url: "https://h", username: "old" } }
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "bulkEditUsername",
      connectionNames: ["conn1"],
      newUsername: "brandnew",
      target: "user"
    })

    expect(cfg.update.mock.calls[0][1].conn1.username).toBe("brandnew")
  })
})

// ---- message: confirmBulkDelete ---------------------------------------------

describe("message handling: confirmBulkDelete", () => {
  test("deletes after confirmation", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue("Delete All")

    const existing = {
      a: { url: "https://h1", username: "u" },
      b: { url: "https://h2", username: "u" }
    }
    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: vi.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "confirmBulkDelete",
      connectionNames: ["a", "b"],
      target: "user"
    })

    const saved = cfg.update.mock.calls[0][1]
    expect(saved).not.toHaveProperty("a")
    expect(saved).not.toHaveProperty("b")
  })

  test("does not delete when user cancels bulk confirm", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: vi.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: vi.fn()
    }
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "confirmBulkDelete",
      connectionNames: ["a"],
      target: "user"
    })

    expect(cfg.update).not.toHaveBeenCalled()
  })
})

// ---- createCloudConnection: invalid service key ----------------------------

describe("message handling: createCloudConnection (service key)", () => {
  test("sends error for invalid service key format", async () => {
    const { isAbapServiceKey } = __$mock_abap_cloud_platform
    ;(isAbapServiceKey as unknown as Mock).mockReturnValue(false)

    const cfg = makeWorkspaceConfig()
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: JSON.stringify({ url: "https://h" }),
      target: "user"
    })

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })

  test("sends error for malformed JSON service key", async () => {
    const cfg = makeWorkspaceConfig()
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: "not-json{",
      target: "user"
    })

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })

  // ---- issue #385: a4c_api_session fails on productive Steampunk systems ----
  // The pre-fill must fall back to service key + JWT claims so the user can
  // finish the wizard manually.

  function makeServiceKey() {
    return JSON.stringify({
      url: "https://abc.abap.eu10.hana.ondemand.com",
      systemid: "ABC",
      uaa: {
        clientid: "sb-xyz",
        clientsecret: "shh",
        url: "https://abc.authentication.eu10.hana.ondemand.com"
      }
    })
  }

  function makeJwt(claims: Record<string, unknown>) {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    return `${header}.${payload}.sig`
  }

  function setupServiceKeyMocks(accessToken: string) {
    const cloud = __$mock_abap_cloud_platform
    ;(cloud.isAbapServiceKey as unknown as Mock).mockReturnValue(true)
    ;(cloud.loginServer as Mock).mockReturnValue({
      server: { close: vi.fn() }
    })
    ;(cloud.cfCodeGrant as Mock).mockResolvedValue({ accessToken })
    return cloud
  }

  test("falls back to service key + JWT when a4c_api_session returns 403", async () => {
    const cloud = setupServiceKeyMocks(makeJwt({ user_name: "PETER" }))
    ;(cloud.getAbapUserInfo as Mock).mockRejectedValue(
      Object.assign(new Error("Response code 403 (Unified Connectivity: Forbidden)"), {
        response: { statusCode: 403 }
      })
    )
    ;(cloud.getAbapSystemInfo as Mock).mockRejectedValue(new Error("not reached"))

    const cfg = makeWorkspaceConfig()
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: makeServiceKey(),
      target: "user"
    })
    await new Promise(r => setImmediate(r))

    const createdMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "cloudConnectionCreated")
    expect(createdMsg).toBeDefined()
    expect(createdMsg.connection.name).toBe("ABC")
    expect(createdMsg.connection.username).toBe("PETER")
    expect(createdMsg.connection.client).toBe("100")
    expect(createdMsg.connection.url).toBe("https://abc.abap.eu10.hana.ondemand.com")
    expect(createdMsg.connection.oauth.clientId).toBe("sb-xyz")
    expect(createdMsg.availableLanguages).toEqual(["en"])

    // user gets a warning that fields are best-effort
    const warnMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "error" && /review the pre-filled/i.test(m.message))
    expect(warnMsg).toBeDefined()
  })

  test("falls back to email claim when user_name is missing", async () => {
    const cloud = setupServiceKeyMocks(makeJwt({ email: "peter@example.com" }))
    ;(cloud.getAbapUserInfo as Mock).mockRejectedValue(new Error("403"))
    ;(cloud.getAbapSystemInfo as Mock).mockRejectedValue(new Error("403"))
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(makeWorkspaceConfig())
    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: makeServiceKey(),
      target: "user"
    })
    await new Promise(r => setImmediate(r))

    const createdMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "cloudConnectionCreated")
    expect(createdMsg).toBeDefined()
    expect(createdMsg.connection.username).toBe("peter@example.com")
  })

  test("leaves username empty when JWT has no usable claim and a4c_api_session fails", async () => {
    const cloud = setupServiceKeyMocks("not-a-jwt")
    ;(cloud.getAbapUserInfo as Mock).mockRejectedValue(new Error("403"))
    ;(cloud.getAbapSystemInfo as Mock).mockRejectedValue(new Error("403"))
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(makeWorkspaceConfig())
    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: makeServiceKey(),
      target: "user"
    })
    await new Promise(r => setImmediate(r))

    const createdMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "cloudConnectionCreated")
    expect(createdMsg).toBeDefined()
    expect(createdMsg.connection.username).toBe("")
    expect(createdMsg.connection.name).toBe("ABC") // still works via systemid
  })

  test("uses a4c_api_session values when available (happy path)", async () => {
    const cloud = setupServiceKeyMocks(makeJwt({ user_name: "PETER" }))
    ;(cloud.getAbapUserInfo as Mock).mockResolvedValue({ UNAME: "DEVELOPER", MANDT: "200" })
    ;(cloud.getAbapSystemInfo as Mock).mockResolvedValue({
      SYSID: "DEV",
      INSTALLED_LANGUAGES: [{ ISOLANG: "EN" }, { ISOLANG: "DE" }]
    })
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(makeWorkspaceConfig())
    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: makeServiceKey(),
      target: "user"
    })
    await new Promise(r => setImmediate(r))

    const createdMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "cloudConnectionCreated")
    expect(createdMsg).toBeDefined()
    expect(createdMsg.connection.name).toBe("DEV")
    expect(createdMsg.connection.username).toBe("DEVELOPER")
    expect(createdMsg.connection.client).toBe("200")
    expect(createdMsg.availableLanguages).toEqual(["en", "de"])

    // no warning when a4c_api_session worked
    const warnMsg = postMessageMock.mock.calls.map(c => c[0]).find(m => m && m.type === "error")
    expect(warnMsg).toBeUndefined()
  })

  test("errors out when neither a4c_api_session nor service key provide a system name", async () => {
    const cloud = setupServiceKeyMocks(makeJwt({ user_name: "PETER" }))
    ;(cloud.getAbapUserInfo as Mock).mockRejectedValue(new Error("403"))
    ;(cloud.getAbapSystemInfo as Mock).mockRejectedValue(new Error("403"))

    const keyNoSysid = JSON.stringify({
      url: "https://abc.abap.eu10.hana.ondemand.com",
      uaa: {
        clientid: "sb-xyz",
        clientsecret: "shh",
        url: "https://abc.authentication.eu10.hana.ondemand.com"
      }
    })

    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(makeWorkspaceConfig())
    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: keyNoSysid,
      target: "user"
    })
    await new Promise(r => setImmediate(r))

    const createdMsg = postMessageMock.mock.calls
      .map(c => c[0])
      .find(m => m && m.type === "cloudConnectionCreated")
    expect(createdMsg).toBeUndefined()

    const errMsg = postMessageMock.mock.calls.map(c => c[0]).find(m => m && m.type === "error")
    expect(errMsg).toBeDefined()
    expect(errMsg.message).toMatch(/Failed to create cloud connection/)
  })
})
