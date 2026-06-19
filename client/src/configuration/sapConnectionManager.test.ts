jest.mock("vscode", () => {
  const postMessageMock = jest.fn()
  const webviewMock = {
    html: "",
    postMessage: postMessageMock,
    onDidReceiveMessage: jest.fn(),
    cspSource: "none"
  }

  return {
    ViewColumn: { One: 1 },
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => p }),
      joinPath: jest.fn((...args: any[]) => ({ fsPath: args.join("/") }))
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: jest.fn(),
      fs: {
        writeFile: jest.fn().mockResolvedValue(undefined)
      }
    }
  }
}, { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: jest.fn(),
    showWarningMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    showSaveDialog: jest.fn()
  }
}))

jest.mock("../config", () => ({
  validateNewConfigId: jest.fn(() => (id: string) => undefined), // passes by default
  formatKey: jest.fn((k: string) => k.toLowerCase()),
  RemoteConfig: {}
}))

jest.mock("../services/abapCopilotLogger", () => ({
  logCommands: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}))

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

jest.mock("../lib", () => {
  const vaultInstance = {
    deletePassword: jest.fn().mockResolvedValue(true),
    setPassword: jest.fn().mockResolvedValue(true),
    getPassword: jest.fn().mockResolvedValue(null)
  }
  return {
    PasswordVault: {
      get: jest.fn(() => vaultInstance)
    }
  }
})

jest.mock("abap_cloud_platform", () => ({
  isAbapServiceKey: jest.fn(() => false),
  cfCodeGrant: jest.fn(),
  getAbapSystemInfo: jest.fn(),
  getAbapUserInfo: jest.fn(),
  loginServer: jest.fn(),
  cfInfo: jest.fn(),
  cfPasswordGrant: jest.fn(),
  cfOrganizations: jest.fn(),
  cfSpaces: jest.fn(),
  cfServices: jest.fn(),
  cfServiceInstances: jest.fn(),
  cfInstanceServiceKeys: jest.fn()
}))

import * as vscode from "vscode"
import { SapConnectionManager } from "./sapConnectionManager"
import { validateNewConfigId } from "../config"
import { logTelemetry } from "../services/telemetry"

// ---- helpers ----------------------------------------------------------------

let postMessageMock: jest.Mock
let disposeListenerMock: jest.Mock
let receiveMessageHandler: ((msg: any) => void) | undefined

function makePanelMock() {
  postMessageMock = jest.fn()
  disposeListenerMock = jest.fn()
  receiveMessageHandler = undefined

  return {
    webview: {
      html: "",
      postMessage: postMessageMock,
      onDidReceiveMessage: jest.fn((handler: any) => {
        receiveMessageHandler = handler
        return { dispose: jest.fn() }
      }),
      cspSource: "none"
    },
    onDidDispose: jest.fn((cb: any) => {
      disposeListenerMock = cb
      return { dispose: jest.fn() }
    }),
    reveal: jest.fn(),
    dispose: jest.fn()
  }
}

function makeWorkspaceConfig(
  globalRemotes: Record<string, any> = {},
  workspaceRemotes: Record<string, any> = {}
) {
  return {
    inspect: jest.fn(() => ({
      globalValue: globalRemotes,
      workspaceValue: workspaceRemotes
    })),
    update: jest.fn().mockResolvedValue(undefined)
  }
}

function createManager(): { manager: SapConnectionManager; panel: any; extensionUri: vscode.Uri } {
  const panel = makePanelMock()
  ;(require("../services/funMessenger").funWindow.createWebviewPanel as jest.Mock).mockReturnValue(
    panel
  )
  const extensionUri = vscode.Uri.file("/ext")
  SapConnectionManager.createOrShow(extensionUri)
  const manager = (SapConnectionManager as any).currentPanel as SapConnectionManager
  return { manager, panel, extensionUri }
}

// ---- setup/teardown ---------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
  ;(SapConnectionManager as any).currentPanel = undefined
})

// ---- createOrShow -----------------------------------------------------------

describe("SapConnectionManager.createOrShow", () => {
  test("creates a new panel and stores it as currentPanel", () => {
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.createWebviewPanel as jest.Mock).mockReturnValue(makePanelMock())
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    expect((SapConnectionManager as any).currentPanel).toBeDefined()
  })

  test("reuses existing panel on second call (reveal)", () => {
    const { funWindow: w } = require("../services/funMessenger")
    const panel = makePanelMock()
    ;(w.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    SapConnectionManager.createOrShow(vscode.Uri.file("/ext"))
    // createWebviewPanel should only be called once
    expect(w.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(panel.reveal).toHaveBeenCalled()
  })

  test("clears currentPanel when panel is disposed", () => {
    const { funWindow: w } = require("../services/funMessenger")
    const panel = makePanelMock()
    ;(w.createWebviewPanel as jest.Mock).mockReturnValue(panel)
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
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)
    createManager()

    await receiveMessageHandler!({ type: "ready" })

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "connections" })
    )
  })

  test("sends connections to webview on 'loadConnections' message", async () => {
    const cfg = makeWorkspaceConfig({})
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)
    createManager()

    await receiveMessageHandler!({ type: "loadConnections" })

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "connections" })
    )
  })

  test("connections message includes both user and workspace remotes", async () => {
    const cfg = makeWorkspaceConfig(
      { global_conn: { url: "https://g", username: "ug" } },
      { ws_conn: { url: "https://w", username: "uw" } }
    )
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)
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
    ;(validateNewConfigId as jest.Mock).mockReturnValue((_id: string) => undefined)

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
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: { newConn: connection }, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    )
    expect(logTelemetry).toHaveBeenCalledWith("command_connection_manager_save_called")
  })

  test("sends formValidationError when new connection id is invalid", async () => {
    ;(validateNewConfigId as jest.Mock).mockReturnValue((_id: string) => "Key already in use")

    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: { newConn: {} }, workspaceValue: {} }),
      update: jest.fn()
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    ;(validateNewConfigId as jest.Mock).mockReturnValue((_id: string) => undefined)

    const connection = { url: "https://h", username: "u" }

    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }), // missing after save
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })

  test("saves to workspace target when target is 'workspace'", async () => {
    ;(validateNewConfigId as jest.Mock).mockReturnValue((_id: string) => undefined)

    const connection = { url: "https://h", username: "u" }
    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: { wsConn: connection } }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
})

// ---- message: deleteConnection ----------------------------------------------

describe("message handling: deleteConnection", () => {
  test("deletes connection and sends success message", async () => {
    const existing = { dev: { url: "https://h", username: "u" } }

    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }), // verified deleted
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "deleteConnection",
      connectionId: "dev",
      target: "user"
    })

    // handleMessage is async but not awaited by the onDidReceiveMessage handler
    await new Promise(r => setImmediate(r))

    expect(cfg.update).toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    )
    expect(logTelemetry).toHaveBeenCalledWith("command_connection_manager_delete_called")
  })

  test("rolls back and sends error when connection still exists after deletion", async () => {
    const existing = { dev: { url: "https://h", username: "u" } }

    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} }), // still there!
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    receiveMessageHandler!({
      type: "deleteConnection",
      connectionId: "dev",
      target: "user"
    })

    await new Promise(r => setImmediate(r))

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })

  test("clears password from vault when deleting", async () => {
    const vault = require("../lib").PasswordVault.get()
    const existing = { dev: { url: "https://h", username: "myuser" } }

    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
      inspect: jest.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    const newConns = { dev2: { url: "https://h2", username: "u2" } }
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
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    )
  })

  test("sends error message when JSON is invalid", async () => {
    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn()
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "importFromJson",
      jsonContent: "not-valid-json{{",
      target: "user"
    })

    expect(cfg.update).not.toHaveBeenCalled()
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })
})

// ---- message: confirmDeleteConnection ---------------------------------------

describe("message handling: confirmDeleteConnection", () => {
  test("calls deleteConnection when user confirms", async () => {
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue("Delete")

    const existing = { dev: { url: "https://h", username: "u" } }
    const cfg = {
      inspect: jest.fn()
        .mockReturnValueOnce({ globalValue: existing, workspaceValue: {} })
        .mockReturnValueOnce({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "confirmDeleteConnection",
      connectionId: "dev",
      target: "user"
    })

    expect(cfg.update).toHaveBeenCalled()
  })

  test("does not delete when user cancels", async () => {
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn()
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
      inspect: jest.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showInputBox as jest.Mock).mockResolvedValue("newuser")

    const existing = {
      conn1: { url: "https://h1", username: "old1" },
      conn2: { url: "https://h2", username: "old2" }
    }
    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showInputBox as jest.Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn()
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
      inspect: jest.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue("Delete All")

    const existing = { a: { url: "https://h1", username: "u" }, b: { url: "https://h2", username: "u" } }
    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: existing, workspaceValue: {} }),
      update: jest.fn().mockResolvedValue(undefined)
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    const { funWindow: w } = require("../services/funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

    const cfg = {
      inspect: jest.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} }),
      update: jest.fn()
    }
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

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
    const { isAbapServiceKey } = require("abap_cloud_platform")
    ;(isAbapServiceKey as jest.Mock).mockReturnValue(false)

    const cfg = makeWorkspaceConfig()
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: JSON.stringify({ url: "https://h" }),
      target: "user"
    })

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })

  test("sends error for malformed JSON service key", async () => {
    const cfg = makeWorkspaceConfig()
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg)

    createManager()

    await receiveMessageHandler!({
      type: "createCloudConnection",
      cloudType: "serviceKey",
      serviceKey: "not-json{",
      target: "user"
    })

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })
})
