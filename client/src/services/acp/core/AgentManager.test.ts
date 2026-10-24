import { EventEmitter } from "node:events"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { AgentManager } from "./AgentManager"
import { logError } from "../utils/Logger"

vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn() }))
vi.mock("../utils/TelemetryManager", () => ({ sendEvent: vi.fn(), sendError: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: vi.fn() }))
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }))

class FakeChild extends EventEmitter {
  stderr = new EventEmitter()
  exitCode: number | null = null
  kill = vi.fn()
}

const CONFIG = { command: "npx", args: ["-y", "agent's pkg"], env: { AGENT_MODE: "acp" } }
const realPlatform = process.platform
const realShell = process.env.SHELL
const onPlatform = (platform: string) =>
  Object.defineProperty(process, "platform", { value: platform })
const spawned = () => vi.mocked(spawn).mock.lastCall! as unknown as [string, string[], any]

describe("AgentManager", () => {
  let manager: AgentManager
  let children: FakeChild[]
  beforeEach(() => {
    vi.clearAllMocks()
    children = []
    vi.mocked(spawn).mockImplementation(() => {
      const child = new FakeChild()
      children.push(child)
      return child as any
    })
    manager = new AgentManager()
  })
  afterEach(() => {
    onPlatform(realPlatform)
    if (realShell === undefined) delete process.env.SHELL
    else process.env.SHELL = realShell
    vi.useRealTimers()
  })

  it("lets cmd.exe resolve batch launchers like npx on Windows", () => {
    onPlatform("win32")
    manager.spawnAgent("Claude", CONFIG, "C:\\work")
    const [command, args, options] = spawned()
    expect([command, args]).toEqual(["npx", ["-y", "agent's pkg"]])
    expect(options).toMatchObject({ shell: true, cwd: "C:\\work", stdio: ["pipe", "pipe", "pipe"] })
    expect(options.env.AGENT_MODE).toBe("acp")
  })

  it("runs through the user's login shell elsewhere, quoting every argument", () => {
    onPlatform("darwin")
    process.env.SHELL = "/bin/zsh"
    manager.spawnAgent("Claude", CONFIG)
    const [shell, args, options] = spawned()
    expect(shell).toBe("/bin/zsh")
    expect(args).toEqual(["-l", "-c", `'npx' '-y' 'agent'\\''s pkg'`])
    expect(options.shell).toBeUndefined()
    expect(options.cwd).toBeUndefined()
  })

  it.each([
    ["/usr/bin/fish", [], "/usr/bin/fish", false],
    ["/bin/dash", [], "/bin/dash", false],
    ["/bin/tcsh", ["/bin/bash"], "/bin/bash", true],
    [undefined, ["/usr/bin/bash"], "/usr/bin/bash", true],
    [undefined, [], "/bin/sh", false]
  ])("with SHELL=%s picks a POSIX shell", (userShell, installed, shell, login) => {
    onPlatform("linux")
    if (userShell) process.env.SHELL = userShell
    else delete process.env.SHELL
    vi.mocked(existsSync).mockImplementation(p => installed.includes(String(p)))
    manager.spawnAgent("Agent", { command: "agent" })
    expect(spawned()[0]).toBe(shell)
    expect(spawned()[1]).toEqual(login ? ["-l", "-c", "'agent'"] : ["-c", "'agent'"])
  })

  it("tracks running agents with increasing ids", () => {
    const first = manager.spawnAgent("A", { command: "a" })
    const second = manager.spawnAgent("B", { command: "b" })
    expect([first.id, second.id]).toEqual(["agent_1", "agent_2"])
    expect(manager.getAgent("agent_2")).toBe(second)
    expect(manager.getRunningAgents()).toEqual([first, second])
    expect(first.process).toBe(children[0])
  })

  it("reports process errors", () => {
    const errors = vi.fn()
    manager.on("agent-error", errors)
    const { id } = manager.spawnAgent("A", { command: "a" })
    const failure = new Error("ENOENT")
    children[0].emit("error", failure)
    expect(errors).toHaveBeenCalledWith({ agentId: id, error: failure })
    expect(logError).toHaveBeenCalledWith('Agent "A" process error', failure)
  })

  it("forgets an exited agent and logs the stderr tail only for failures", () => {
    const closed = vi.fn()
    manager.on("agent-closed", closed)
    const ok = manager.spawnAgent("Ok", { command: "a" })
    const bad = manager.spawnAgent("Bad", { command: "b" })
    children[0].stderr.emit("data", Buffer.from("progress"))
    children[0].emit("close", 0, null)
    children[1].stderr.emit("data", Buffer.from("x".repeat(3000)))
    children[1].stderr.emit("data", Buffer.from("fatal: no auth\n"))
    children[1].emit("close", 1, null)
    expect(closed.mock.calls.map(c => c[0])).toEqual([
      { agentId: ok.id, code: 0, signal: null },
      { agentId: bad.id, code: 1, signal: null }
    ])
    expect(manager.getRunningAgents()).toEqual([])
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, tail] = vi.mocked(logError).mock.lastCall!
    expect(message).toBe('Agent "Bad" stderr on failed exit')
    expect((tail as string).length).toBeLessThanOrEqual(2000)
    expect(tail).toMatch(/x+fatal: no auth$/)
  })

  it("terminates an agent and force-kills it if it does not exit in time", () => {
    vi.useFakeTimers()
    const stubborn = manager.spawnAgent("Stubborn", { command: "a" })
    const polite = manager.spawnAgent("Polite", { command: "b" })
    expect(manager.killAgent(stubborn.id)).toBe(true)
    expect(manager.killAgent(polite.id)).toBe(true)
    children[1].exitCode = 0
    expect(children[0].kill).toHaveBeenCalledWith("SIGTERM")
    vi.advanceTimersByTime(5000)
    expect(children[0].kill).toHaveBeenLastCalledWith("SIGKILL")
    expect(children[1].kill).not.toHaveBeenCalledWith("SIGKILL")
    expect(manager.getRunningAgents()).toEqual([])
    expect(manager.killAgent(stubborn.id)).toBe(false)
  })

  it("still forgets an agent it fails to kill", () => {
    const { id } = manager.spawnAgent("A", { command: "a" })
    children[0].kill.mockImplementation(() => {
      throw new Error("EPERM")
    })
    expect(manager.killAgent(id)).toBe(true)
    expect(manager.getAgent(id)).toBeUndefined()
    expect(logError).toHaveBeenCalledWith(`Failed to kill agent ${id}`, expect.any(Error))
  })

  it("kills everything and drops listeners on dispose", () => {
    manager.spawnAgent("A", { command: "a" })
    manager.spawnAgent("B", { command: "b" })
    manager.on("agent-closed", vi.fn())
    manager.dispose()
    expect(children.every(child => child.kill.mock.calls[0][0] === "SIGTERM")).toBe(true)
    expect(manager.getRunningAgents()).toEqual([])
    expect(manager.listenerCount("agent-closed")).toBe(0)
  })
})
