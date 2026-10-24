import { SessionHistoryStore } from "./SessionHistoryStore"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)

const KEY = "abapfs.acp.sessionHistory.v1"

function memento(initial?: unknown) {
  const data = new Map<string, unknown>(initial === undefined ? [] : [[KEY, initial]])
  return {
    data,
    get: vi.fn((key: string) => data.get(key)),
    update: vi.fn(async (key: string, value: unknown) => void data.set(key, value)),
    keys: () => [...data.keys()]
  }
}
const at = (iso: string) => vi.setSystemTime(new Date(iso))

describe("SessionHistoryStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    at("2026-01-01T10:00:00.000Z")
  })
  afterEach(() => vi.useRealTimers())

  it("restores version 1 history and ignores anything else", () => {
    const entry = { agentName: "a", cwd: "/w", sessionId: "s", createdAt: "x", lastActiveAt: "x" }
    expect(
      new SessionHistoryStore(memento({ version: 1, entries: [entry] }) as any).list("a")
    ).toEqual([entry])
    expect(
      new SessionHistoryStore(memento({ version: 2, entries: [entry] }) as any).list("a")
    ).toEqual([])
    expect(
      new SessionHistoryStore(memento({ version: 1, entries: "bad" }) as any).list("a")
    ).toEqual([])
  })

  it("records new sessions, persists them and notifies listeners", () => {
    const state = memento()
    const store = new SessionHistoryStore(state as any)
    const changed = vi.fn()
    store.onDidChange(changed)
    store.upsertNew("claude", "/work", "s1")
    const expected = {
      agentName: "claude",
      cwd: "/work",
      sessionId: "s1",
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T10:00:00.000Z"
    }
    expect(store.get("claude", "s1")).toEqual(expected)
    expect(state.data.get(KEY)).toEqual({ version: 1, entries: [expected] })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it("refreshes rather than duplicates a known session", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "s1")
    at("2026-01-01T11:00:00.000Z")
    store.upsertNew("claude", "/work", "s1")
    expect(store.list("claude")).toHaveLength(1)
    expect(store.get("claude", "s1")).toMatchObject({
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T11:00:00.000Z"
    })
  })

  it("lists one agent's sessions for a workspace, most recent first", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "old")
    at("2026-01-02T00:00:00.000Z")
    store.upsertNew("claude", "/other", "elsewhere")
    store.upsertNew("gemini", "/work", "foreign")
    at("2026-01-03T00:00:00.000Z")
    store.upsertNew("claude", "/work", "new")
    expect(store.list("claude", "/work").map(e => e.sessionId)).toEqual(["new", "old"])
    expect(store.list("claude").map(e => e.sessionId)).toEqual(["new", "elsewhere", "old"])
  })

  it("keeps only the most recent sessions per agent", () => {
    const store = new SessionHistoryStore(memento() as any, 2)
    store.upsertNew("gemini", "/work", "g1")
    for (const [day, id] of [
      ["02", "c1"],
      ["03", "c2"],
      ["04", "c3"]
    ]) {
      at(`2026-01-${day}T00:00:00.000Z`)
      store.upsertNew("claude", "/work", id)
    }
    expect(store.list("claude").map(e => e.sessionId)).toEqual(["c3", "c2"])
    expect(store.list("gemini")).toHaveLength(1)
  })

  it("sets and clears titles of known sessions only", () => {
    const state = memento()
    const store = new SessionHistoryStore(state as any)
    store.upsertNew("claude", "/work", "s1")
    store.setTitle("claude", "s1", "Fix ZDEMO")
    expect(store.get("claude", "s1")?.title).toBe("Fix ZDEMO")
    store.setTitle("claude", "s1", undefined)
    expect(store.get("claude", "s1")?.title).toBe("Fix ZDEMO")
    store.setTitle("claude", "s1", null)
    expect(store.get("claude", "s1")).not.toHaveProperty("title")
    state.update.mockClear()
    store.setTitle("claude", "unknown", "x")
    expect(state.update).not.toHaveBeenCalled()
  })

  it("remembers only the first prompt, shortened", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "s1")
    store.setFirstPromptIfMissing("claude", "s1", "x".repeat(200))
    store.setFirstPromptIfMissing("claude", "s1", "second")
    expect(store.get("claude", "s1")?.firstPrompt).toBe("x".repeat(120))
  })

  it("stores response metadata at its turn index", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "s1")
    store.setResponseMetadata("claude", "s1", 2, { modelName: "opus" })
    store.setResponseMetadata("claude", "s1", 0, { usage: { totalTokens: 5 } })
    store.setResponseMetadata("claude", "s1", -1, { modelName: "bad" })
    store.setResponseMetadata("claude", "s1", 1.5, { modelName: "bad" })
    store.setResponseMetadata("claude", "missing", 0, { modelName: "bad" })
    expect(store.get("claude", "s1")?.responseMetadata).toEqual([
      { usage: { totalTokens: 5 } },
      null,
      { modelName: "opus" }
    ])
  })

  it("bumps activity time on touch", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "s1")
    at("2026-02-01T00:00:00.000Z")
    store.touch("claude", "s1")
    store.touch("claude", "missing")
    expect(store.get("claude", "s1")?.lastActiveAt).toBe("2026-02-01T00:00:00.000Z")
  })

  it("forgets single sessions and whole agents", () => {
    const store = new SessionHistoryStore(memento() as any)
    store.upsertNew("claude", "/work", "s1")
    store.upsertNew("claude", "/work", "s2")
    store.upsertNew("gemini", "/work", "g1")
    expect(store.forget("claude", "s1")).toBe(true)
    expect(store.forget("claude", "s1")).toBe(false)
    expect(store.forgetAgent("claude")).toBe(1)
    expect(store.forgetAgent("claude")).toBe(0)
    expect(store.list("gemini")).toHaveLength(1)
  })

  it("drops sessions the agent no longer knows, touching no other agent", () => {
    const state = memento()
    const store = new SessionHistoryStore(state as any)
    store.upsertNew("claude", "/work", "kept")
    store.upsertNew("claude", "/work", "gone")
    store.upsertNew("gemini", "/work", "g1")
    store.reconcileFromAgent("claude", new Set(["kept"]))
    expect(store.list("claude").map(e => e.sessionId)).toEqual(["kept"])
    expect(store.list("gemini")).toHaveLength(1)
    state.update.mockClear()
    store.reconcileFromAgent("claude", new Set(["kept"]))
    expect(state.update).not.toHaveBeenCalled()
  })
})
