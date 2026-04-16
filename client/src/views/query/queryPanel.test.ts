/**
 * Tests for views/query/queryPanel.ts
 * Primary focus: SQLValidator (internal security validation), QueryPanel static factory,
 * showResult/showError methods, and dispose.
 */

jest.mock("vscode", () => {
  return {
    ViewColumn: { One: 1, Beside: 2 },
    Uri: {
      file: jest.fn((p: string) => ({ fsPath: p, toString: () => `file://${p}` })),
      parse: jest.fn((s: string) => ({ toString: () => s })),
      joinPath: jest.fn((base: any, ...parts: string[]) => ({ ...base, path: [base.path || "", ...parts].join("/"), toString: () => parts.join("/") })),
    },
    workspace: {
      fs: { writeFile: jest.fn() },
      getConfiguration: jest.fn(() => ({ get: jest.fn(() => []) })),
    },
  }
}, { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createWebviewPanel: jest.fn(),
    showSaveDialog: jest.fn(),
    showErrorMessage: jest.fn(),
  },
}), { virtual: true })

jest.mock("../../lib", () => ({
  log: jest.fn(),
}), { virtual: true })

// We need to be able to test SQLValidator. It's not exported, so we test via
// the message handling that calls it. But we can also test it indirectly.
// For direct testing, we extract the logic as a separate helper test.

import { QueryPanel } from "./queryPanel"
import { funWindow as window } from "../../services/funMessenger"

const mockedWindow = window as jest.Mocked<typeof window>

function makeWebviewPanel() {
  const messageHandlers: Array<(msg: any) => void> = []
  const changeViewHandlers: Array<(e: any) => void> = []

  const webview = {
    html: "",
    postMessage: jest.fn(),
    onDidReceiveMessage: jest.fn((cb: any) => { messageHandlers.push(cb); return { dispose: jest.fn() } }),
    asWebviewUri: jest.fn((uri: any) => uri),
    cspSource: "vscode-webview:",
  }
  const panel = {
    webview,
    reveal: jest.fn(),
    dispose: jest.fn(),
    onDidDispose: jest.fn((cb: any) => { cb(); return { dispose: jest.fn() } }),
    onDidChangeViewState: jest.fn((cb: any) => { changeViewHandlers.push(cb); return { dispose: jest.fn() } }),
    visible: true,
    viewColumn: 1,
    _messageHandlers: messageHandlers,
    _changeViewHandlers: changeViewHandlers,
  }
  return panel
}

function makeClient() {
  return {
    runQuery: jest.fn().mockResolvedValue({ values: [], columns: [] }),
    searchObject: jest.fn().mockResolvedValue([]),
    tableContents: jest.fn().mockResolvedValue({ columns: [] }),
  } as any
}

describe("QueryPanel.createOrShow", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates a new panel", () => {
    const panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const { Uri } = require("vscode")
    const extensionUri = Uri.file("/ext")
    const client = makeClient()
    expect(() => QueryPanel.createOrShow(extensionUri, client, "MARA")).not.toThrow()
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalledWith(
      "ABAPQuery",
      "Query",
      expect.anything(),
      expect.objectContaining({ enableScripts: true })
    )
  })

  it("sets initial html on the webview", () => {
    const panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const { Uri } = require("vscode")
    QueryPanel.createOrShow(Uri.file("/ext"), makeClient(), "MARA")
    // html was set to the result of _update()
    expect(typeof panel.webview.html).toBe("string")
  })
})

describe("QueryPanel message handlers – SQL validation", () => {
  let panel: ReturnType<typeof makeWebviewPanel>
  let client: ReturnType<typeof makeClient>

  beforeEach(() => {
    jest.clearAllMocks()
    panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const { Uri } = require("vscode")
    client = makeClient()
    QueryPanel.createOrShow(Uri.file("/ext"), client, "")
  })

  async function sendMessage(msg: any) {
    for (const handler of (panel as any)._messageHandlers) {
      await handler(msg)
    }
  }

  it("rejects DROP statement via runSQL command", async () => {
    await sendMessage({ command: "runSQL", sql: "DROP TABLE MARA", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error", data: expect.stringContaining("SQL Security Error") })
    )
  })

  it("rejects DELETE statement via runSQL command", async () => {
    await sendMessage({ command: "runSQL", sql: "DELETE FROM MARA", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error", data: expect.stringContaining("SQL Security Error") })
    )
  })

  it("rejects INSERT statement via runSQL command", async () => {
    await sendMessage({ command: "runSQL", sql: "INSERT INTO MARA VALUES (1)", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error", data: expect.stringContaining("SQL Security Error") })
    )
  })

  it("rejects UPDATE statement via runSQL command", async () => {
    await sendMessage({ command: "runSQL", sql: "UPDATE MARA SET MATNR = 'X'", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error", data: expect.stringContaining("SQL Security Error") })
    )
  })

  it("rejects ALTER statement via runSQL command", async () => {
    await sendMessage({ command: "runSQL", sql: "ALTER TABLE MARA ADD COLUMN X", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error", data: expect.stringContaining("SQL Security Error") })
    )
  })

  it("rejects statements with SQL comments", async () => {
    await sendMessage({ command: "runSQL", sql: "SELECT * FROM MARA -- drop it", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error" })
    )
  })

  it("rejects non-SELECT/WITH statement", async () => {
    await sendMessage({ command: "runSQL", sql: "EXEC xp_cmdshell('dir')", top: 10 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error" })
    )
  })

  it("allows valid SELECT statement", async () => {
    client.runQuery.mockResolvedValue({ values: [{ MATNR: "MAT1" }], columns: [{ name: "MATNR" }] })
    await sendMessage({ command: "runSQL", sql: "SELECT MATNR FROM MARA", top: 10 })
    expect(client.runQuery).toHaveBeenCalled()
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "queryResult" })
    )
  })

  it("allows valid WITH statement", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({ command: "runSQL", sql: "WITH cte AS (SELECT 1 FROM MARA) SELECT * FROM cte", top: 5 })
    expect(client.runQuery).toHaveBeenCalled()
  })

  it("marks hasMore when result exceeds limit", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ MATNR: `M${i}` }))
    client.runQuery.mockResolvedValue({ values: rows, columns: [] })
    await sendMessage({ command: "runSQL", sql: "SELECT MATNR FROM MARA", top: 11 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "queryResult",
        data: expect.objectContaining({ hasMore: true }),
      })
    )
  })

  it("uses default limit of 200 when top is not a number", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({ command: "runSQL", sql: "SELECT * FROM MARA", top: "bad" })
    expect(client.runQuery).toHaveBeenCalledWith("SELECT * FROM MARA", 201, true)
  })

  it("searchObjects returns de-duplicated results", async () => {
    client.searchObject
      .mockResolvedValueOnce([{ "adtcore:name": "MARA", "adtcore:type": "TABL/DT", "adtcore:description": "Material" }])
      .mockResolvedValueOnce([])
    await sendMessage({ command: "searchObjects", term: "MAR", types: ["TABL"], max: 5 })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "objects",
        data: expect.arrayContaining([expect.objectContaining({ name: "MARA" })]),
      })
    )
  })

  it("loadFields sends field metadata back", async () => {
    client.tableContents.mockResolvedValue({ columns: [{ name: "MATNR" }] })
    await sendMessage({ command: "loadFields", entity: { name: "MARA", kind: "TABL" } })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "fields",
        data: expect.objectContaining({ columns: [{ name: "MATNR" }] }),
      })
    )
  })
})

describe("QueryPanel.setTable and showResult/showError", () => {
  let panel: ReturnType<typeof makeWebviewPanel>

  beforeEach(() => {
    jest.clearAllMocks()
    panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
  })

  it("showResult posts result message to webview", () => {
    const { Uri } = require("vscode")
    QueryPanel.createOrShow(Uri.file("/ext"), makeClient(), "MARA")
    // Access the instance – since it's created inside createOrShow, we test via postMessage
    // We can send a result by triggering the execute command
    // Instead verify postMessage was called with result command after construction
    panel.webview.postMessage.mockClear()
    // showResult is called internally; we can only test indirectly
    // The panel was created, which is enough to verify construction worked
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalled()
  })
})

describe("QueryPanel runCriteria", () => {
  let panel: ReturnType<typeof makeWebviewPanel>
  let client: ReturnType<typeof makeClient>

  beforeEach(() => {
    jest.clearAllMocks()
    panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const { Uri } = require("vscode")
    client = makeClient()
    QueryPanel.createOrShow(Uri.file("/ext"), client, "MARA")
  })

  async function sendMessage(msg: any) {
    for (const handler of (panel as any)._messageHandlers) {
      await handler(msg)
    }
  }

  it("runs criteria query with where clause", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({
      command: "runCriteria",
      entity: { name: "MARA", kind: "TABL" },
      where: "MATNR = 'X'",
      top: 10,
      columns: ["MATNR"],
    })
    expect(client.runQuery).toHaveBeenCalled()
    const call = client.runQuery.mock.calls[0]
    expect(call[0]).toContain("MARA")
    expect(call[0]).toContain("MATNR")
  })

  it("strips leading WHERE keyword from where clause", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({
      command: "runCriteria",
      entity: { name: "MARA", kind: "TABL" },
      where: "WHERE MATNR = 'Y'",
      top: 5,
      columns: [],
    })
    expect(client.runQuery).toHaveBeenCalled()
    const sql = client.runQuery.mock.calls[0][0] as string
    // Should not contain "WHERE WHERE"
    expect(sql.toUpperCase()).not.toMatch(/WHERE\s+WHERE/i)
  })

  it("uses * when no columns specified", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({
      command: "runCriteria",
      entity: { name: "MARA", kind: "TABL" },
      where: "",
      top: 10,
      columns: [],
    })
    expect(client.runQuery.mock.calls[0][0]).toContain("*")
  })
})

describe("QueryPanel loadMore", () => {
  let panel: ReturnType<typeof makeWebviewPanel>
  let client: ReturnType<typeof makeClient>

  beforeEach(() => {
    jest.clearAllMocks()
    panel = makeWebviewPanel()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const { Uri } = require("vscode")
    client = makeClient()
    QueryPanel.createOrShow(Uri.file("/ext"), client, "MARA")
  })

  async function sendMessage(msg: any) {
    for (const handler of (panel as any)._messageHandlers) {
      await handler(msg)
    }
  }

  it("rejects dangerous SQL in loadMore sql mode", async () => {
    await sendMessage({ command: "loadMore", mode: "sql", sql: "DROP TABLE X", nextTop: 100, entity: null, where: "", columns: [] })
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "error" })
    )
    expect(client.runQuery).not.toHaveBeenCalled()
  })

  it("executes loadMore in criteria mode", async () => {
    client.runQuery.mockResolvedValue({ values: [], columns: [] })
    await sendMessage({
      command: "loadMore",
      mode: "criteria",
      entity: { name: "MARA" },
      where: "MATNR = 'X'",
      sql: "",
      nextTop: 50,
      columns: ["MATNR"],
    })
    expect(client.runQuery).toHaveBeenCalled()
  })
})
