import { EventEmitter } from "node:events"
import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import { StatusBarManager } from "./StatusBarManager"

import type { SessionManager } from "../core/SessionManager"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../core/SessionManager", () => ({}))

function fakeSessions() {
  const sessions = Object.assign(new EventEmitter(), {
    connected: [] as string[],
    active: undefined as { agentDisplayName?: string } | undefined,
    getConnectedAgentNames: () => sessions.connected,
    getActiveSession: () => sessions.active
  })
  return sessions
}

function setup() {
  resetVscodeFake()
  const sessions = fakeSessions()
  const manager = new StatusBarManager(sessions as unknown as SessionManager)
  const item = vscodeFake.window.createStatusBarItem.mock.results[0].value
  return { sessions, manager, item }
}

describe("StatusBarManager", () => {
  it("offers to connect while no agent is connected", () => {
    const { item } = setup()
    expect(vscodeFake.window.createStatusBarItem).toHaveBeenCalledWith(
      vscodeFake.StatusBarAlignment.Left,
      100
    )
    expect(item.text).toBe("$(hubot) Agent: Disconnected")
    expect(item.command).toBe("abapfs.acp.connectAgent")
    expect(item.show).toHaveBeenCalled()
  })

  it.each(["agent-connected", "active-session-changed", "agent-disconnected", "agent-closed"])(
    "refreshes on %s",
    event => {
      const { sessions, item } = setup()
      sessions.connected = ["claude"]
      sessions.active = { agentDisplayName: "Claude Code" }
      sessions.emit(event)
      expect(item.text).toBe("$(hubot) Claude Code")
      expect(item.tooltip).toBe("Connected to Claude Code. Click to open chat.")
      expect(item.command).toBe("abapfs.acp.openChat")
    }
  )

  it("uses a generic name while connected without an active session", () => {
    const { sessions, item } = setup()
    sessions.connected = ["claude"]
    sessions.emit("agent-connected")
    expect(item.text).toBe("$(hubot) Agent")
  })

  it("flags errors and clears the flag on the next refresh", () => {
    const { sessions, item } = setup()
    sessions.emit("agent-error")
    expect(item.text).toBe("$(error) Agent: Error")
    expect(item.backgroundColor.id).toBe("statusBarItem.errorBackground")
    sessions.emit("agent-closed")
    expect(item.text).toBe("$(hubot) Agent: Disconnected")
    expect(item.backgroundColor).toBeUndefined()
  })

  it("disposes its item", () => {
    const { manager, item } = setup()
    manager.dispose()
    expect(item.dispose).toHaveBeenCalled()
  })
})
