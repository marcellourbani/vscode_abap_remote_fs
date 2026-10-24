import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import { showSessionHistory } from "./SessionHistoryPicker"
import { logError } from "../utils/Logger"

import type { PersistedSessionEntry } from "../core/SessionHistoryStore"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ logError: vi.fn() }))
vi.mock("../core/SessionManager", () => ({}))
vi.mock("./ChatWebviewProvider", () => ({}))

const NOW = Date.parse("2026-03-10T12:00:00.000Z")
const ago = (minutes: number) => new Date(NOW - minutes * 60000).toISOString()
const window = vscodeFake.window

function entry(sessionId: string, minutesAgo: number, extra: Partial<PersistedSessionEntry> = {}) {
  return {
    agentName: "Claude",
    cwd: "/work",
    sessionId,
    createdAt: ago(minutesAgo),
    lastActiveAt: ago(minutesAgo),
    ...extra
  } as PersistedSessionEntry
}

function setup(
  caps: Record<string, unknown> = { load: true },
  local: PersistedSessionEntry[] = []
) {
  const sessions = {
    active: "current" as string | null,
    getActiveAgentName: vi.fn(() => "Claude" as string | undefined),
    getActiveSessionId: vi.fn(() => sessions.active),
    ensureConnected: vi.fn(async () => {}),
    getCachedCapabilities: vi.fn(() => caps),
    getWorkspaceCwd: vi.fn(() => "/work"),
    getHistoryStore: vi.fn(() => ({ list: vi.fn(() => local) })),
    listSessions: vi.fn(async () => ({ sessions: [] as unknown[] })),
    loadSession: vi.fn(async () => {}),
    resumeSession: vi.fn(async () => {})
  }
  const chat = { clearChat: vi.fn() }
  const open = () => showSessionHistory(sessions as any, chat as any)
  return { sessions, chat, open }
}
const shownItems = () => window.showQuickPick.mock.lastCall![0] as any[]

describe("showSessionHistory", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it("asks to connect first without an active agent", async () => {
    const { sessions, open } = setup()
    sessions.getActiveAgentName.mockReturnValue(undefined)
    await open()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "Connect to an agent to see its previous conversations."
    )
    expect(sessions.ensureConnected).not.toHaveBeenCalled()
  })

  it("explains when the agent cannot reopen conversations", async () => {
    const { open } = setup({})
    await open()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "Claude does not support reopening past conversations."
    )
    expect(window.showQuickPick).not.toHaveBeenCalled()
  })

  it("lists locally recorded conversations newest first, with labels and ages", async () => {
    const { open } = setup({ load: true }, [
      entry("week", 7 * 24 * 60, { firstPrompt: "Explain   the\nreport" }),
      entry("recent", 5, { title: "Fix ZDEMO", firstPrompt: "ignored" }),
      entry("untitled", 1),
      entry("hours", 125, { title: "x".repeat(100) }),
      entry("current", 0.5),
      entry("ancient", 60 * 24 * 45, { title: "Old one" })
    ])
    window.showQuickPick.mockResolvedValue(undefined)
    await open()
    const items = shownItems()
    expect(items.map(i => i.sessionId)).toEqual(["current", "recent", "hours", "week", "ancient"])
    expect(items[0]).toMatchObject({
      label: "Untitled conversation",
      description: "current",
      detail: "current"
    })
    expect(items[0].iconPath.id).toBe("circle-filled")
    expect(items[1]).toMatchObject({ label: "Fix ZDEMO", description: "5m ago", detail: undefined })
    expect(items[1].iconPath.id).toBe("comment-discussion")
    expect(items[2].label).toBe("x".repeat(79) + "…")
    expect(items[2].description).toBe("2h ago")
    expect(items[3]).toMatchObject({ label: "Explain the report", description: "7d ago" })
    expect(items[4].description).toBe(new Date(Date.parse(ago(60 * 24 * 45))).toLocaleDateString())
    expect(window.showQuickPick.mock.lastCall![1]).toMatchObject({
      title: "Claude conversations",
      matchOnDescription: true
    })
  })

  it("uses the agent's own list when supported, enriched with local titles", async () => {
    const { sessions, open } = setup({ load: true, list: true }, [
      entry("known", 30, { title: "Local title" })
    ])
    sessions.listSessions.mockResolvedValue({
      sessions: [
        { sessionId: "known", cwd: "/work", title: null, updatedAt: ago(1) },
        { sessionId: "titled", cwd: "/work", title: " Agent title ", updatedAt: ago(10) },
        { sessionId: "external-session-0123456789", cwd: "/work", updatedAt: ago(0) }
      ]
    })
    window.showQuickPick.mockResolvedValue(undefined)
    await open()
    expect(sessions.listSessions).toHaveBeenCalledWith("Claude", { cwd: "/work" })
    const items = shownItems()
    expect(items.map(i => [i.sessionId, i.label, i.description])).toEqual([
      ["external-session-0123456789", "Untitled conversation", "just now"],
      ["titled", "Agent title", "10m ago"],
      ["known", "Local title", "30m ago"]
    ])
    expect(items[0].detail).toBe("external…6789")
  })

  it("says so when there is nothing to show", async () => {
    const { open } = setup({ resume: true }, [entry("untitled", 3)])
    await open()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "No previous conversations with Claude."
    )
  })

  it("reports listing failures", async () => {
    const { sessions, open } = setup({ load: true, list: true })
    const failure = new Error("agent offline")
    sessions.listSessions.mockRejectedValue(failure)
    await open()
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to list conversations: agent offline"
    )
    expect(logError).toHaveBeenCalledWith("Failed to list conversations for Claude", failure)
  })

  it("ignores picking the current conversation", async () => {
    const { sessions, chat, open } = setup({ load: true }, [entry("current", 1, { title: "Now" })])
    window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    await open()
    expect(chat.clearChat).not.toHaveBeenCalled()
    expect(sessions.loadSession).not.toHaveBeenCalled()
  })

  it("replays a picked conversation when the agent can load sessions", async () => {
    const { sessions, chat, open } = setup({ load: true, resume: true }, [
      entry("old", 9, { title: "Old" })
    ])
    window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    await open()
    expect(chat.clearChat).toHaveBeenCalled()
    expect(sessions.loadSession).toHaveBeenCalledWith("Claude", "old")
    expect(sessions.resumeSession).not.toHaveBeenCalled()
    expect(window.withProgress.mock.lastCall![0]).toMatchObject({
      location: vscodeFake.ProgressLocation.Notification,
      title: "Opening conversation..."
    })
  })

  it("resumes without replay otherwise and tells the user why the chat is empty", async () => {
    const { sessions, open } = setup({ resume: true }, [entry("old", 9, { title: "Old" })])
    window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    await open()
    expect(sessions.resumeSession).toHaveBeenCalledWith("Claude", "old")
    expect(window.showInformationMessage.mock.lastCall![0]).toContain("cannot replay its messages")
  })

  it("reports a conversation that fails to open", async () => {
    const { sessions, open } = setup({ load: true }, [entry("old", 9, { title: "Old" })])
    sessions.loadSession.mockRejectedValue(new Error("gone"))
    window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    await open()
    expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to open conversation: gone")
  })
})
