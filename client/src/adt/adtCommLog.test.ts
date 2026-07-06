jest.mock(
  "vscode",
  () => ({
    commands: { executeCommand: jest.fn() },
    env: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
    window: { showInformationMessage: jest.fn() },
    EventEmitter: jest.fn().mockImplementation(() => ({
      event: jest.fn(),
      fire: jest.fn()
    }))
  }),
  { virtual: true }
)
jest.mock("../extension", () => ({ context: { extensionPath: "/fake/ext" } }))
jest.mock("../langClient", () => ({
  client: { sendNotification: jest.fn().mockResolvedValue(undefined) }
}))
jest.mock("../lib", () => ({ ignore: jest.fn() }))
jest.mock("../commands", () => ({
  AbapFsCommands: { activateCommLog: "activateCommLog", deactivateCommLog: "deactivateCommLog" },
  command: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc
}))
jest.mock("../config", () => ({ pickAdtRoot: jest.fn() }))
jest.mock("./conections", () => ({ ADTSCHEME: "adt" }))
jest.mock("../services/telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("path", () => ({ join: (...args: string[]) => args.join("/") }))
jest.mock("fs", () => ({ readFileSync: jest.fn().mockReturnValue("<html></html>") }))

import { addLogEntry, getLogEntries, CallLogger, AdtLogEntry, CommLogPanel } from "./adtCommLog"
import { commands, env, window } from "vscode"

// Reset module-level state between tests by manipulating entries array
function clearEntries() {
  const entries = getLogEntries() as AdtLogEntry[]
  // Access via cast - entries is a reference to the module-level array
  ;(entries as any).length = 0
}

const makeEntry = (overrides: Partial<Omit<AdtLogEntry, "id">> = {}): Omit<AdtLogEntry, "id"> => ({
  connId: "conn1",
  method: "GET",
  url: "/sap/bc/adt/test",
  params: undefined,
  requestBody: undefined,
  requestHeaders: undefined,
  responseHeaders: undefined,
  status: 200,
  responseBody: undefined,
  duration: 100,
  startTime: Date.now(),
  endTime: Date.now() + 100,
  error: false,
  ...overrides
})

describe("addLogEntry", () => {
  beforeEach(() => {
    clearEntries()
  })

  it("adds an entry and returns it with an id", () => {
    const entry = addLogEntry(makeEntry())
    expect(entry.id).toBeDefined()
    expect(typeof entry.id).toBe("number")
    expect(entry.connId).toBe("conn1")
  })

  it("entries are accessible via getLogEntries", () => {
    addLogEntry(makeEntry({ url: "/url1" }))
    addLogEntry(makeEntry({ url: "/url2" }))
    const entries = getLogEntries()
    expect(entries.length).toBeGreaterThanOrEqual(2)
  })

  it("assigns sequential IDs", () => {
    const e1 = addLogEntry(makeEntry())
    const e2 = addLogEntry(makeEntry())
    expect(e2.id).toBeGreaterThan(e1.id)
  })

  it("preserves all entry fields", () => {
    const now = Date.now()
    const entry = addLogEntry(
      makeEntry({
        method: "POST",
        url: "/sap/bc/adt/activation",
        status: 204,
        error: false,
        duration: 250,
        startTime: now
      })
    )
    expect(entry.method).toBe("POST")
    expect(entry.url).toBe("/sap/bc/adt/activation")
    expect(entry.status).toBe(204)
    expect(entry.duration).toBe(250)
  })

  it("handles error entries", () => {
    const entry = addLogEntry(makeEntry({ error: true, status: "ERR" }))
    expect(entry.error).toBe(true)
    expect(entry.status).toBe("ERR")
  })

  it("handles undefined optional fields", () => {
    const entry = addLogEntry(
      makeEntry({
        params: undefined,
        requestBody: undefined,
        responseBody: undefined,
        requestHeaders: undefined,
        responseHeaders: undefined
      })
    )
    expect(entry.params).toBeUndefined()
    expect(entry.requestBody).toBeUndefined()
  })
})

describe("getLogEntries", () => {
  beforeEach(() => {
    clearEntries()
  })

  it("returns empty array initially (after clear)", () => {
    const entries = getLogEntries()
    expect(entries.length).toBe(0)
  })

  it("returns readonly reference", () => {
    const entries = getLogEntries()
    expect(Array.isArray(entries)).toBe(true)
  })
})

describe("CallLogger", () => {
  beforeEach(() => {
    CallLogger.stopLogging()
  })

  it("creates a new instance via getOrCreate", () => {
    const logger = CallLogger.getOrCreate("testconn1")
    expect(logger).toBeDefined()
    expect(logger.entries).toBeDefined()
  })

  it("returns same instance for same connId", () => {
    const l1 = CallLogger.getOrCreate("testconn2")
    const l2 = CallLogger.getOrCreate("testconn2")
    expect(l1).toBe(l2)
  })

  it("returns active connection IDs", () => {
    CallLogger.getOrCreate("conn1")
    CallLogger.getOrCreate("conn2")
    const ids = CallLogger.getActiveConnIds()
    expect(ids).toContain("conn1")
    expect(ids).toContain("conn2")
    expect(ids.length).toBe(2)
  })

  it("notifies listeners on status change", () => {
    const listener = jest.fn()
    const unsub = CallLogger.onStatusChange(listener)

    CallLogger.getOrCreate("conn3")
    expect(listener).toHaveBeenCalledTimes(1)

    CallLogger.stopLogging() // should also notify
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    CallLogger.getOrCreate("conn4")
    expect(listener).toHaveBeenCalledTimes(2) // No new calls after unsub
  })

  it("adds log data correctly", () => {
    clearEntries()
    const logger = CallLogger.getOrCreate("testconn3")
    const data: any = {
      request: {
        method: "GET",
        uri: "/sap/bc/adt/test",
        params: {},
        headers: {},
        body: undefined
      },
      response: {
        statusCode: 200,
        headers: {},
        body: "ok"
      },
      duration: 50,
      startTime: new Date(),
      error: undefined
    }
    logger.add(data)
    expect(getLogEntries().length).toBeGreaterThan(0)
    const last = getLogEntries()[getLogEntries().length - 1]!
    expect(last.method).toBe("GET")
    expect(last.status).toBe(200)
  })

  it("caps large response bodies", () => {
    clearEntries()
    const logger = CallLogger.getOrCreate("testconn4")
    const largeBody = "x".repeat(3 * 1024 * 1024) // 3MB > 2MB cap
    const data: any = {
      request: { method: "GET", uri: "/url", params: {}, headers: {}, body: undefined },
      response: { statusCode: 200, headers: {}, body: largeBody },
      duration: 10,
      startTime: new Date(),
      error: undefined
    }
    logger.add(data)
    const last = getLogEntries()[getLogEntries().length - 1]!
    expect(last.responseBody).toContain("TRUNCATED")
    expect(last.responseBody!.length).toBeLessThan(largeBody.length)
  })

  it("handles error responses with no statusCode", () => {
    clearEntries()
    const logger = CallLogger.getOrCreate("testconn5")
    const data: any = {
      request: { method: "POST", uri: "/url", params: {}, headers: {}, body: "" },
      response: { headers: {} }, // no statusCode
      duration: 5,
      startTime: new Date(),
      error: new Error("Network failure")
    }
    logger.add(data)
    const last = getLogEntries()[getLogEntries().length - 1]!
    expect(last.error).toBe(true)
    expect(last.status).toBe("ERR")
  })

  it("handles non-string response headers", () => {
    clearEntries()
    const logger = CallLogger.getOrCreate("testconn6")
    const data: any = {
      request: { method: "GET", uri: "/url", params: {}, headers: {}, body: undefined },
      response: {
        statusCode: 200,
        headers: { "content-length": 1234, "x-header": null, "y-header": undefined },
        body: ""
      },
      duration: 10,
      startTime: new Date(),
      error: undefined
    }
    logger.add(data)
    const last = getLogEntries()[getLogEntries().length - 1]!
    // null/undefined values should be excluded from responseHeaders
    expect(last.responseHeaders).not.toHaveProperty("y-header")
    expect(last.responseHeaders).not.toHaveProperty("x-header")
    expect(last.responseHeaders?.["content-length"]).toBe("1234")
  })
})

describe("CommLogPanel", () => {
  let panel: CommLogPanel
  let mockView: any
  let messageHandler: (msg: any) => void

  beforeEach(() => {
    jest.clearAllMocks()
    clearEntries()
    CallLogger.stopLogging()
    panel = new CommLogPanel()
    mockView = {
      webview: {
        options: {},
        html: "",
        onDidReceiveMessage: jest.fn(handler => {
          messageHandler = handler
          return { dispose: jest.fn() }
        }),
        postMessage: jest.fn()
      },
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      visible: true
    }
    panel.resolveWebviewView(mockView, {} as any, {} as any)
  })

  it("sends snapshot and status on ready message", () => {
    messageHandler({ command: "ready" })
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "snapshot" })
    )
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "status" })
    )
  })

  it("clears entries on clear message", () => {
    addLogEntry(makeEntry())
    expect(getLogEntries().length).toBe(1)
    messageHandler({ command: "clear" })
    expect(getLogEntries().length).toBe(0)
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "snapshot", entries: [] })
    )
  })

  it("toggles logging on toggle message", () => {
    // Starting with no active connections
    messageHandler({ command: "toggle" })
    expect(commands.executeCommand).toHaveBeenCalledWith("activateCommLog")

    // Force an active connection
    CallLogger.getOrCreate("conn1")
    messageHandler({ command: "toggle" })
    expect(commands.executeCommand).toHaveBeenCalledWith("deactivateCommLog")
  })

  it("copies entry as JSON", async () => {
    const entry = addLogEntry(makeEntry({ url: "/test-copy" }))
    messageHandler({ command: "copy", id: entry.id, format: "json" })

    await new Promise(r => setTimeout(r, 0))
    expect(env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/test-copy"))
    expect(window.showInformationMessage).toHaveBeenCalledWith("Copied as JSON")
  })

  it("copies entry as HTTP", async () => {
    const entry = addLogEntry(
      makeEntry({
        method: "POST",
        url: "/sap/bc/adt/test",
        params: { a: "1" },
        requestHeaders: { "X-Test": "Value", Cookie: "secret" }
      })
    )
    messageHandler({ command: "copy", id: entry.id, format: "http" })

    await new Promise(r => setTimeout(r, 0))
    const copiedText = (env.clipboard.writeText as jest.Mock).mock.calls[0][0]
    expect(copiedText).toContain("POST {{baseUrl}}/sap/bc/adt/test?a=1")
    expect(copiedText).toContain("X-Test: Value")
    expect(copiedText).not.toContain("Cookie")
    expect(window.showInformationMessage).toHaveBeenCalledWith("Copied HTTP request")
  })
})
