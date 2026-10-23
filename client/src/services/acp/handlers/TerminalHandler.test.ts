import { EventEmitter } from "node:events"
import { spawn } from "node:child_process"
import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import { TerminalHandler } from "./TerminalHandler"
import { agentWorkspaceRoot } from "../fs/AbapPathMapper"
import { logError } from "../utils/Logger"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn() }))
vi.mock("../fs/AbapPathMapper", () => ({
  agentWorkspaceRoot: vi.fn(() => "/agent-root"),
  isLocalPath: (p: string) => !p.startsWith("/agent-root/adt")
}))
vi.mock("node:child_process", () => ({ spawn: vi.fn() }))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
  print(text: string, stream: "stdout" | "stderr" = "stdout") {
    this[stream].emit("data", Buffer.from(text, "utf-8"))
  }
}

let child: FakeChild
const terminal = () => vscodeFake.window.createTerminal.mock.lastCall![0]

async function start(handler: TerminalHandler, params: Record<string, unknown> = {}) {
  const { terminalId } = await handler.createTerminal({
    sessionId: "s1",
    command: "abaplint",
    ...params
  } as any)
  return terminalId
}
/** Output is published to the agent on a 100 ms timer */
async function outputOf(handler: TerminalHandler, terminalId: string) {
  vi.advanceTimersByTime(100)
  return handler.terminalOutput({ sessionId: "s1", terminalId })
}

describe("TerminalHandler", () => {
  let handler: TerminalHandler
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetVscodeFake()
    vi.mocked(spawn).mockImplementation(() => {
      child = new FakeChild()
      return child as any
    })
    handler = new TerminalHandler()
  })
  afterEach(() => {
    handler.dispose()
    vi.useRealTimers()
  })

  it("spawns the command in a shell with the extra environment", async () => {
    expect(
      await start(handler, {
        args: ["--format", "json"],
        cwd: "/work",
        env: [{ name: "MODE", value: "ci" }]
      })
    ).toBe("term_1")
    const [command, args, options] = vi.mocked(spawn).mock.lastCall! as any[]
    expect(command).toBe("abaplint")
    expect(args).toEqual(["--format", "json"])
    expect(options).toMatchObject({ cwd: "/work", shell: true, stdio: ["pipe", "pipe", "pipe"] })
    expect(options.env.MODE).toBe("ci")
    expect(options.env.PATH ?? options.env.Path).toBe(process.env.PATH ?? process.env.Path)
    expect(await start(handler)).toBe("term_2")
  })

  it.each([
    ["inside the virtual ABAP mount", "/agent-root/adt/dev100", "/agent-root"],
    ["missing", undefined, "/agent-root"]
  ])("runs in the agent workspace when the cwd is %s", async (_case, cwd, expected) => {
    await start(handler, { cwd })
    expect((vi.mocked(spawn).mock.lastCall![2] as any).cwd).toBe(expected)
  })

  it("falls back to the process cwd before the agent root exists", async () => {
    vi.mocked(agentWorkspaceRoot).mockReturnValueOnce("")
    await start(handler)
    expect((vi.mocked(spawn).mock.lastCall![2] as any).cwd).toBeUndefined()
  })

  it("mirrors the command and its output in a VS Code terminal", async () => {
    await start(handler, { args: ["lint"] })
    const { name, pty } = terminal()
    expect(name).toBe("Agent: abaplint")
    const written: string[] = []
    pty.onDidWrite((text: string) => written.push(text))
    pty.open()
    child.print("line 1\nline 2\n")
    child.print("oops\n", "stderr")
    expect(written).toEqual(["$ abaplint lint\r\n", "line 1\r\nline 2\r\n", "oops\r\n"])
  })

  it("collects stdout and stderr and reports the exit status once finished", async () => {
    const id = await start(handler)
    child.print("out ")
    child.print("err", "stderr")
    expect(await outputOf(handler, id)).toEqual({ output: "out err", truncated: false })
    child.emit("close", 2, null)
    expect(await outputOf(handler, id)).toEqual({
      output: "out err",
      truncated: false,
      exitStatus: { exitCode: 2, signal: null }
    })
  })

  it("drops the oldest output beyond the byte limit", async () => {
    const id = await start(handler, { outputByteLimit: 10 })
    child.print("0123456789abc")
    expect(await outputOf(handler, id)).toEqual({ output: "3456789abc", truncated: true })
  })

  it("never splits a multi-byte character when truncating", async () => {
    const id = await start(handler, { outputByteLimit: 4 })
    child.print("äöü")
    const { output } = await outputOf(handler, id)
    expect(output).toBe("öü")
    expect(Buffer.byteLength(output)).toBe(4)
  })

  it("waits for the process to exit", async () => {
    const id = await start(handler)
    const exit = handler.waitForTerminalExit({ sessionId: "s1", terminalId: id })
    child.emit("close", null, "SIGTERM")
    expect(await exit).toEqual({ exitCode: null, signal: "SIGTERM" })
  })

  it("stops waiting when the process cannot be started", async () => {
    const id = await start(handler)
    const exit = handler.waitForTerminalExit({ sessionId: "s1", terminalId: id })
    child.emit("error", new Error("ENOENT"))
    expect(await exit).toEqual({ exitCode: null, signal: null })
  })

  it("kills on request and logs failures to do so", async () => {
    const id = await start(handler)
    expect(await handler.killTerminal({ sessionId: "s1", terminalId: id })).toEqual({})
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
    const failure = new Error("EPERM")
    child.kill.mockImplementation(() => {
      throw failure
    })
    expect(await handler.killTerminal({ sessionId: "s1", terminalId: id })).toEqual({})
    expect(logError).toHaveBeenCalledWith(`Failed to kill terminal ${id}`, failure)
  })

  it("releases a terminal, killing it only if still running, and keeps the VS Code terminal", async () => {
    const vsTerminal = { dispose: vi.fn() }
    vscodeFake.window.createTerminal.mockReturnValue(vsTerminal)
    const running = await start(handler)
    const runningChild = child
    const done = await start(handler)
    child.emit("close", 0, null)
    await handler.releaseTerminal({ sessionId: "s1", terminalId: running })
    await handler.releaseTerminal({ sessionId: "s1", terminalId: done })
    expect(runningChild.kill).toHaveBeenCalledWith("SIGTERM")
    expect(child.kill).not.toHaveBeenCalled()
    handler.dispose()
    expect(vsTerminal.dispose).not.toHaveBeenCalled()
    await expect(handler.terminalOutput({ sessionId: "s1", terminalId: running })).rejects.toThrow(
      `Terminal not found: ${running}`
    )
  })

  it.each(["terminalOutput", "waitForTerminalExit", "killTerminal", "releaseTerminal"] as const)(
    "rejects %s for unknown terminals",
    async method => {
      await expect(handler[method]({ sessionId: "s1", terminalId: "nope" })).rejects.toThrow(
        "Terminal not found: nope"
      )
    }
  )

  it("kills running processes and closes terminals on dispose", async () => {
    const vsTerminal = { dispose: vi.fn() }
    vscodeFake.window.createTerminal.mockReturnValue(vsTerminal)
    await start(handler)
    const running = child
    await start(handler)
    child.emit("close", 0, null)
    handler.dispose()
    expect(running.kill).toHaveBeenCalledWith("SIGKILL")
    expect(child.kill).not.toHaveBeenCalled()
    expect(vsTerminal.dispose).toHaveBeenCalledTimes(2)
  })
})
