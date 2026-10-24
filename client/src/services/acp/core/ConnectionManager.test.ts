import { PassThrough } from "node:stream"
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { vscodeFake } from "../testing/vscodeFake"
import { log, logError, logTraffic } from "../utils/Logger"

import type { ConnectionManager as ConnectionManagerType } from "./ConnectionManager"

const handlers = vi.hoisted(() => ({ fs: [] as any[] }))

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn(), logTraffic: vi.fn() }))
vi.mock("../handlers/FileSystemHandler", () => ({
  FileSystemHandler: class {
    readTextFile = vi.fn(async ({ path }: { path: string }) => ({ content: `contents of ${path}` }))
    writeTextFile = vi.fn(async () => ({}))
    constructor() {
      handlers.fs.push(this)
    }
  }
}))
vi.mock("../handlers/TerminalHandler", () => ({ TerminalHandler: class {} }))
vi.mock("../handlers/PermissionHandler", () => ({ PermissionHandler: class {} }))
vi.mock("../handlers/ElicitationHandler", () => ({ ElicitationHandler: class {} }))

const INIT_RESULT = {
  protocolVersion: PROTOCOL_VERSION,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: "fake-agent", version: "1.0.0" },
  authMethods: []
}

/** An agent process speaking newline-delimited JSON-RPC over fake stdio */
function fakeAgent(noise = "") {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const received: any[] = []
  let buffer = ""
  const send = (message: object) => stdout.write(`${noise}${JSON.stringify(message)}\n`)
  stdin.on("data", chunk => {
    buffer += chunk
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (!line.trim()) continue
      const message = JSON.parse(line)
      received.push(message)
      if (message.method === "initialize")
        send({ jsonrpc: "2.0", id: message.id, result: INIT_RESULT })
    }
  })
  return { process: { stdin, stdout } as any, received, send }
}

describe("ConnectionManager", () => {
  let ConnectionManager: typeof ConnectionManagerType
  let manager: ConnectionManagerType
  const updates = { handleUpdate: vi.fn() }

  beforeAll(async () => {
    // the extension version is read once when the module loads
    vscodeFake.extensions.getExtension.mockReturnValue({ packageJSON: { version: "1.2.3" } })
    ;({ ConnectionManager } = await import("./ConnectionManager"))
  })
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.fs.length = 0
    manager = new ConnectionManager(updates as any)
  })
  afterEach(() => manager.dispose())

  it("rejects processes without stdio", async () => {
    await expect(manager.connect("a1", { stdout: null, stdin: null } as any)).rejects.toThrow(
      "Agent process missing stdio streams"
    )
  })

  it("initializes the agent with the ABAP FS client capabilities", async () => {
    const agent = fakeAgent()
    const info = await manager.connect("a1", agent.process)
    expect(info.initResponse).toMatchObject(INIT_RESULT)
    expect(manager.getConnection("a1")).toBe(info)
    const [initialize] = agent.received
    expect(initialize.method).toBe("initialize")
    expect(initialize.params).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "abap-fs", version: "1.2.3" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        elicitation: { form: {} }
      }
    })
  })

  it("strips terminal control sequences that agents print before JSON", async () => {
    const agent = fakeAgent("\x1b[2K\x1b[1G\x1b]0;agent title\x07")
    const info = await manager.connect("a1", agent.process)
    expect(info.initResponse.agentInfo?.name).toBe("fake-agent")
    expect(log).toHaveBeenCalledWith(
      "Removed terminal control sequences from agent stdout before ACP parsing"
    )
  })

  it("logs traffic in both directions", async () => {
    await manager.connect("a1", fakeAgent().process)
    const traffic = vi.mocked(logTraffic).mock.calls
    expect(
      traffic.find(([dir, msg]: any[]) => dir === "send" && msg.method === "initialize")
    ).toBeTruthy()
    expect(
      traffic.find(([dir, msg]: any[]) => dir === "recv" && msg.result?.agentInfo)
    ).toBeTruthy()
  })

  it("serves agent requests through the VS Code handlers", async () => {
    const agent = fakeAgent()
    await manager.connect("a1", agent.process)
    agent.send({
      jsonrpc: "2.0",
      id: 7,
      method: "fs/read_text_file",
      params: { sessionId: "s1", path: "/mnt/adt/dev100/zdemo.prog.abap" }
    })
    const reply = await vi.waitFor(() => {
      const found = agent.received.find(m => m.id === 7)
      if (!found) throw new Error("no reply yet")
      return found
    })
    expect(reply.result).toEqual({ content: "contents of /mnt/adt/dev100/zdemo.prog.abap" })
    expect(handlers.fs[0].readTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", path: "/mnt/adt/dev100/zdemo.prog.abap" })
    )
  })

  it("passes session updates to the shared update handler", async () => {
    const agent = fakeAgent()
    await manager.connect("a1", agent.process)
    const params = {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } }
    }
    agent.send({ jsonrpc: "2.0", method: "session/update", params })
    await vi.waitFor(() => expect(updates.handleUpdate).toHaveBeenCalled())
    expect(updates.handleUpdate.mock.lastCall![0]).toMatchObject(params)
  })

  it("closes and forgets connections without reporting the close as a pipe error", async () => {
    const info = await manager.connect("a1", fakeAgent().process)
    const close = vi.spyOn(info.connection, "close")
    manager.removeConnection("a1")
    expect(close).toHaveBeenCalled()
    expect(manager.getConnection("a1")).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 10))
    const pipeErrors = vi
      .mocked(logError)
      .mock.calls.filter(([message]) => /pipe error/.test(message))
    expect(pipeErrors).toEqual([])
  })

  it("closes every connection on dispose", async () => {
    const first = await manager.connect("a1", fakeAgent().process)
    const second = await manager.connect("a2", fakeAgent().process)
    const closes = [vi.spyOn(first.connection, "close"), vi.spyOn(second.connection, "close")]
    manager.dispose()
    closes.forEach(close => expect(close).toHaveBeenCalled())
    expect(manager.getConnection("a1")).toBeUndefined()
  })
})
