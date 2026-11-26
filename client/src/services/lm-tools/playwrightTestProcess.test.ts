import { EventEmitter } from "events"
import { spawn } from "child_process"
import type { Mock } from "vitest"

vi.mock("child_process", () => ({ spawn: vi.fn() }))
vi.mock("vscode", () => ({}))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: {} }))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("../../config", () => ({ formatKey: vi.fn(), RemoteManager: {} }))
vi.mock("../../lib", () => ({ log: { debug: vi.fn() } }))
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("../../adt/sapgui/sapgui", () => ({ ssoLoginUrl: vi.fn() }))
vi.mock("../testing/config", () => ({ getTestFolder: vi.fn(), getWebGuiUrl: vi.fn() }))
vi.mock("../testing/browserResolver", () => ({ resolveBrowserExecutable: vi.fn() }))

import { killTree, runProcess } from "./playwrightTestTool"

function token() {
  return { onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never
}

function fakeChild() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 321
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn()
  return child
}

describe("Playwright process lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("captures both streams and settles on close", async () => {
    const child = fakeChild()
    ;(spawn as unknown as Mock).mockReturnValue(child)
    const cancel = { dispose: vi.fn() }
    const runToken = {
      onCancellationRequested: vi.fn(function () {
        return cancel
      })
    } as any
    const promise = runProcess("node", ["cli"], { cwd: "C:/tests", env: {} }, runToken)
    child.stdout.emit("data", Buffer.from("out\n"))
    child.stderr.emit("data", Buffer.from("err\n"))
    child.emit("close", 2)
    child.emit("close", 3)
    await expect(promise).resolves.toEqual({ code: 2, stdout: "out\n", stderr: "err\n" })
    expect(cancel.dispose).toHaveBeenCalledTimes(1)
  })

  it("settles through the exit grace path when close never arrives", async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    ;(spawn as unknown as Mock).mockReturnValue(child)
    const promise = runProcess("node", [], { cwd: "C:/tests", env: {} }, token())
    child.emit("exit", 0)
    vi.advanceTimersByTime(2_000)
    await expect(promise).resolves.toEqual({ code: 0, stdout: "", stderr: "" })
    vi.useRealTimers()
  })

  describe("on Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" })
    })

    afterEach(() => {
      Object.defineProperty(process, "platform", platform)
    })

    it("kills an active process tree on cancellation", async () => {
      const child = fakeChild()
      const taskkill = fakeChild()
      const calls: any[] = []
      ;(spawn as unknown as Mock).mockImplementation(function (...args: any[]) {
        calls.push(args)
        return calls.length === 1 ? child : taskkill
      })
      let cancel: (() => void) | undefined
      const runToken = {
        onCancellationRequested: vi.fn(function (handler: () => void) {
          cancel = handler
          return { dispose: vi.fn() }
        })
      } as any
      const promise = runProcess("node", [], { cwd: "C:/tests", env: {} }, runToken)
      cancel!()
      child.signalCode = "SIGKILL"
      child.emit("close", null)
      await promise
      expect(calls[1][0]).toBe("taskkill")
      expect(calls[1][1]).toEqual(["/pid", "321", "/T", "/F"])
    })

    it("does not kill a settled child and falls back when taskkill fails", () => {
      const settled = fakeChild()
      settled.exitCode = 0
      killTree(settled)
      expect(spawn).not.toHaveBeenCalled()

      const child = fakeChild()
      const taskkill = fakeChild()
      ;(spawn as unknown as Mock).mockReturnValue(taskkill)
      killTree(child)
      taskkill.emit("error", new Error("taskkill unavailable"))
      expect(child.kill).toHaveBeenCalledTimes(1)
    })
  })

  it("kills a POSIX process group and falls back to the child when that fails", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!
    Object.defineProperty(process, "platform", { value: "linux" })
    const processKill = vi.spyOn(process, "kill").mockImplementation(function () {
      return true
    })
    try {
      const grouped = fakeChild()
      killTree(grouped)
      expect(processKill).toHaveBeenCalledWith(-321, "SIGKILL")

      processKill.mockImplementation(function () {
        throw new Error("no group")
      })
      const fallback = fakeChild()
      killTree(fallback)
      expect(fallback.kill).toHaveBeenCalledWith("SIGKILL")
    } finally {
      processKill.mockRestore()
      Object.defineProperty(process, "platform", descriptor)
    }
  })
})
