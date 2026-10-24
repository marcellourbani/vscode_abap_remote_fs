import { resetVscodeFake, vscodeFake } from "../testing/vscodeFake"
import { authRequired, createSessionFixture } from "../testing/sessionFixture"
import { abapWorkspaceHint } from "../fs/AbapPathMapper"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn() }))
vi.mock("../utils/TelemetryManager", () => ({ sendEvent: vi.fn(), sendError: vi.fn() }))
vi.mock("../fs/AbapPathMapper", () => ({
  abapWorkspaceHint: vi.fn(() => ""),
  agentWorkspaceRoot: vi.fn(() => "")
}))
vi.mock("../../mcpServer", () => ({
  getMcpServerStatus: vi.fn(() => ({ isRunning: false, port: 0, url: "" }))
}))
vi.mock("./AgentManager", () => ({}))
vi.mock("./ConnectionManager", () => ({}))

const ALL_CAPS = { loadSession: true, sessionCapabilities: { list: {}, resume: {} } } as any
const MODE_OPTION = {
  id: "agent-mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "ask",
  options: []
}
const MODEL_OPTION = {
  id: "llm",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "a",
  options: []
}

async function connected(options = {}) {
  const f = createSessionFixture(options)
  const session = await f.manager.connectToAgent("Claude")
  f.events.length = 0
  return { ...f, session }
}

describe("SessionManager sessions", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  describe("sendPrompt", () => {
    it("adds the ABAP FS workspace hint to the first prompt only", async () => {
      const f = await connected()
      vi.mocked(abapWorkspaceHint).mockReturnValue("[ABAP FS context]")
      const attachment = { type: "resource_link", uri: "file:///a", name: "a" } as const
      expect(await f.manager.sendPrompt(f.session.sessionId, "Explain", [attachment])).toEqual({
        stopReason: "end_turn"
      })
      await f.manager.sendPrompt(f.session.sessionId, "More")
      expect(f.requests("session/prompt")).toEqual([
        {
          sessionId: f.session.sessionId,
          prompt: [
            { type: "text", text: "[ABAP FS context]" },
            { type: "text", text: "Explain" },
            attachment
          ]
        },
        { sessionId: f.session.sessionId, prompt: [{ type: "text", text: "More" }] }
      ])
    })

    it("sends attachments alone when the text is blank and there is no hint", async () => {
      const f = await connected()
      vi.mocked(abapWorkspaceHint).mockReturnValue("")
      const image = { type: "image", data: "AA==", mimeType: "image/png" } as const
      await f.manager.sendPrompt(f.session.sessionId, "  ", [image])
      expect(f.requests("session/prompt")[0].prompt).toEqual([image])
    })

    it("rejects unknown sessions and lost connections", async () => {
      const f = await connected()
      await expect(f.manager.sendPrompt("nope", "x")).rejects.toThrow("Session not found: nope")
      f.connections.clear()
      await expect(f.manager.sendPrompt(f.session.sessionId, "x")).rejects.toThrow(
        `No connection for agent: ${f.session.agentId}`
      )
    })
  })

  it("cancels the running turn with a notification", async () => {
    const f = await connected()
    await f.manager.cancelTurn(f.session.sessionId)
    await f.manager.cancelTurn("nope")
    expect(f.agent.notify.mock.calls).toEqual([
      ["session/cancel", { sessionId: f.session.sessionId }]
    ])
  })

  describe("modes, models and config options", () => {
    it("switches legacy modes and remembers the choice", async () => {
      const f = createSessionFixture()
      f.responses["session/new"] = () => ({
        sessionId: "s1",
        modes: { currentModeId: "ask", availableModes: [] }
      })
      const session = await f.manager.connectToAgent("Claude")
      await f.manager.setMode("s1", "code")
      expect(f.requests("session/set_mode")).toEqual([{ sessionId: "s1", modeId: "code" }])
      expect(session.modes?.currentModeId).toBe("code")
      expect(f.events).toContainEqual(["mode-changed", "s1", "code"])
    })

    it("routes modes and models through config options when the agent has them", async () => {
      const f = createSessionFixture()
      f.responses["session/new"] = () => ({
        sessionId: "s1",
        configOptions: [MODE_OPTION, MODEL_OPTION]
      })
      f.responses["session/set_config_option"] = () => ({
        configOptions: [MODE_OPTION, MODEL_OPTION]
      })
      await f.manager.connectToAgent("Claude")
      await f.manager.setMode("s1", "code")
      await f.manager.setModel("s1", "b")
      expect(f.requests("session/set_mode")).toEqual([])
      expect(f.requests("session/set_config_option")).toEqual([
        { sessionId: "s1", configId: "agent-mode", value: "code" },
        { sessionId: "s1", configId: "llm", value: "b" }
      ])
    })

    it("cannot pick a model without a model option", async () => {
      const f = await connected()
      await expect(f.manager.setModel(f.session.sessionId, "b")).rejects.toThrow(
        "This agent does not expose model selection through ACP config options."
      )
    })

    it("sends boolean options typed and adopts the agent's full option list", async () => {
      const f = await connected()
      const updated = [{ ...MODEL_OPTION, currentValue: "b" }]
      f.responses["session/set_config_option"] = () => ({ configOptions: updated })
      expect(await f.manager.setConfigOption(f.session.sessionId, "thinking", true)).toEqual(
        updated
      )
      expect(f.requests("session/set_config_option")).toEqual([
        { sessionId: f.session.sessionId, configId: "thinking", type: "boolean", value: true }
      ])
      expect(f.session.configOptions).toEqual(updated)
      expect(f.events).toEqual([["config-options-changed", f.session.sessionId, updated]])
    })

    it("ignores option changes for unknown sessions", async () => {
      const f = await connected()
      expect(await f.manager.setConfigOption("nope", "x", "y")).toBeNull()
      await f.manager.setMode("nope", "x")
      expect(f.agent.request).toHaveBeenCalledTimes(1)
    })
  })

  it("keeps updates that arrive before session/new returns", async () => {
    const f = createSessionFixture()
    const commands = [{ name: "review", description: "Review code" }]
    f.responses["session/new"] = () => {
      f.manager.applyAvailableCommands("early", commands)
      f.manager.applyConfigOptions("early", [MODEL_OPTION] as any)
      f.manager.applySessionInfoUpdate("early", { title: "Early title" })
      return { sessionId: "early" }
    }
    const session = await f.manager.connectToAgent("Claude")
    expect(session.availableCommands).toEqual(commands)
    expect(session.configOptions).toEqual([MODEL_OPTION])
    expect(session.title).toBe("Early title")
  })

  it("applies live command and title updates and mirrors titles to history", async () => {
    const f = await connected()
    const id = f.session.sessionId
    f.manager.applyAvailableCommands(id, [{ name: "plan", description: "Plan" }])
    f.manager.applySessionInfoUpdate(id, { title: "Refactor ZDEMO" })
    expect(f.session.title).toBe("Refactor ZDEMO")
    expect(f.history.get("Claude", id)?.title).toBe("Refactor ZDEMO")
    f.manager.applySessionInfoUpdate(id, { title: null })
    expect(f.session).not.toHaveProperty("title")
    expect(f.history.get("Claude", id)).not.toHaveProperty("title")
    expect(f.events.map(([e]) => e)).toEqual([
      "available-commands-changed",
      "session-info-changed",
      "session-info-changed"
    ])
  })

  it("records prompts, response metadata and activity in the history", async () => {
    const f = await connected()
    const id = f.session.sessionId
    f.manager.recordFirstPrompt(id, "Explain ZDEMO")
    f.manager.recordResponseMetadata(id, 1, { modelName: "opus" })
    f.manager.recordFirstPrompt("nope", "x")
    f.manager.recordResponseMetadata("nope", 0, { modelName: "x" })
    f.manager.touchHistory(id)
    expect(f.history.get("Claude", id)?.firstPrompt).toBe("Explain ZDEMO")
    expect(f.manager.getResponseMetadata(id)).toEqual([null, { modelName: "opus" }])
    expect(f.manager.getResponseMetadata("nope")).toEqual([])
  })

  describe("ensureConnected", () => {
    it("reuses the connection of a live session and caches capabilities", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      expect(await f.manager.ensureConnected("Claude")).toBe(f.connections.get(f.session.agentId))
      expect(f.agentManager.spawnAgent).toHaveBeenCalledTimes(1)
      expect(f.manager.getCachedCapabilities("Claude")).toEqual({
        list: true,
        load: true,
        resume: true
      })
    })

    it("probes an agent without opening a session or disturbing the active one", async () => {
      const f = await connected()
      const probe = await f.manager.ensureConnected("Gemini")
      expect(await f.manager.ensureConnected("Gemini")).toBe(probe)
      expect(f.agentManager.spawnAgent).toHaveBeenCalledTimes(2)
      expect(f.requests("session/new")).toHaveLength(1)
      expect(f.manager.getActiveAgentName()).toBe("Claude")
      expect(f.manager.getCachedCapabilities("Gemini")).toEqual({
        list: false,
        load: false,
        resume: false
      })
    })

    it("rejects unknown agents and kills processes that fail to connect", async () => {
      const f = createSessionFixture()
      await expect(f.manager.ensureConnected("Nope")).rejects.toThrow("Unknown agent: Nope.")
      f.connectionManager.connect.mockRejectedValueOnce(new Error("handshake"))
      await expect(f.manager.ensureConnected("Claude")).rejects.toThrow("handshake")
      expect(f.agentManager.killAgent).toHaveBeenCalledWith("agent_1")
    })
  })

  describe("listSessions", () => {
    it("requires the list capability", async () => {
      await expect(createSessionFixture().manager.listSessions("Claude")).rejects.toThrow(
        'Agent "Claude" does not support session/list.'
      )
    })

    it("lists by workspace and drops history entries the agent forgot, on the first page only", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      f.history.upsertNew("Claude", "/work", "forgotten")
      f.responses["session/list"] = () => ({
        sessions: [{ sessionId: f.session.sessionId, cwd: "/work" }],
        nextCursor: "p2"
      })
      const page = await f.manager.listSessions("Claude", { cwd: "/work" })
      expect(page).toEqual({
        sessions: [{ sessionId: f.session.sessionId, cwd: "/work" }],
        nextCursor: "p2"
      })
      expect(f.history.get("Claude", "forgotten")).toBeUndefined()
      f.history.upsertNew("Claude", "/work", "later")
      await f.manager.listSessions("Claude", { cursor: "p2" })
      expect(f.requests("session/list")).toEqual([{ cwd: "/work" }, { cursor: "p2" }])
      expect(f.history.get("Claude", "later")).toBeDefined()
    })

    it("authenticates and retries when listing needs auth", async () => {
      const f = await connected({
        capabilities: ALL_CAPS,
        authMethods: [{ id: "oauth", name: "Sign in" }]
      })
      let attempts = 0
      f.responses["session/list"] = () => {
        if (attempts++ === 0) throw authRequired()
        return { sessions: [] }
      }
      vscodeFake.window.showInformationMessage.mockResolvedValue("Authenticate")
      expect(await f.manager.listSessions("Claude")).toEqual({
        sessions: [],
        nextCursor: undefined
      })
      expect(f.requests("authenticate")).toEqual([{ methodId: "oauth" }])
    })
  })

  describe("loadSession", () => {
    it("requires the load capability", async () => {
      await expect(createSessionFixture().manager.loadSession("Claude", "old")).rejects.toThrow(
        'Agent "Claude" does not support session/load.'
      )
    })

    it("replays a past session as the active one", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      let loadingDuringReplay = false
      f.responses["session/load"] = () => {
        loadingDuringReplay = f.manager.isLoading("old")
        return { configOptions: [MODEL_OPTION] }
      }
      const session = await f.manager.loadSession("Claude", "old")
      expect(loadingDuringReplay).toBe(true)
      expect(f.manager.isLoading("old")).toBe(false)
      expect(f.requests("session/load")).toEqual([
        { sessionId: "old", cwd: "/work", mcpServers: [] }
      ])
      expect(session).toMatchObject({
        sessionId: "old",
        agentId: f.session.agentId,
        configOptions: [MODEL_OPTION]
      })
      expect(f.manager.getSession(f.session.sessionId)).toBeUndefined()
      expect(f.manager.getActiveSessionId()).toBe("old")
      expect(f.events).toEqual([
        ["agent-connected", "Claude"],
        ["active-session-changed", "old"],
        ["session-load-start", "old", "Claude"],
        ["session-load-end", "old", "Claude", true]
      ])
    })

    it("disconnects a different active agent first", async () => {
      const f = await connected()
      f.initResponse.agentCapabilities = ALL_CAPS
      await f.manager.loadSession("Gemini", "old")
      expect(f.events).toContainEqual(["agent-disconnected", "Claude"])
      expect(f.manager.getActiveAgentName()).toBe("Gemini")
    })

    it("rolls back and forgets sessions the agent no longer has", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      f.history.upsertNew("Claude", "/work", "gone")
      f.responses["session/load"] = () => {
        throw new Error("Session not found")
      }
      await expect(f.manager.loadSession("Claude", "gone")).rejects.toThrow("Session not found")
      expect(f.manager.getActiveSession()).toBeUndefined()
      expect(f.manager.isLoading("gone")).toBe(false)
      expect(f.history.get("Claude", "gone")).toBeUndefined()
      expect(f.events.slice(-2)).toEqual([
        ["session-load-end", "gone", "Claude", false],
        ["active-session-changed", null]
      ])
    })
  })

  describe("resumeSession", () => {
    it("requires the resume capability", async () => {
      await expect(createSessionFixture().manager.resumeSession("Claude", "old")).rejects.toThrow(
        'Agent "Claude" does not support session/resume.'
      )
    })

    it("continues a past session without replay", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      f.responses["session/resume"] = () => ({
        modes: { currentModeId: "code", availableModes: [] }
      })
      const session = await f.manager.resumeSession("Claude", "old")
      expect(session).toMatchObject({ sessionId: "old", modes: { currentModeId: "code" } })
      expect(f.manager.getActiveSession()).toBe(session)
      expect(f.manager.getSession(f.session.sessionId)).toBeUndefined()
      expect(f.events).toEqual([
        ["agent-connected", "Claude"],
        ["active-session-changed", "old"]
      ])
    })

    it("forgets sessions the agent no longer has", async () => {
      const f = await connected({ capabilities: ALL_CAPS })
      f.history.upsertNew("Claude", "/work", "gone")
      f.responses["session/resume"] = () => {
        throw new Error("unknown session gone")
      }
      await expect(f.manager.resumeSession("Claude", "gone")).rejects.toThrow(
        "unknown session gone"
      )
      expect(f.history.get("Claude", "gone")).toBeUndefined()
    })
  })
})
