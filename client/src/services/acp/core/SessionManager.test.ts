import * as path from "node:path"
import { vscodeFake, resetVscodeFake, FakeUri } from "../testing/vscodeFake"
import { AGENTS, authRequired, createSessionFixture } from "../testing/sessionFixture"
import { agentWorkspaceRoot } from "../fs/AbapPathMapper"
import { getMcpServerStatus } from "../../mcpServer"

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

const window = vscodeFake.window
const MCP_URL = "http://127.0.0.1:4711/mcp"
const folder = (uri: FakeUri) => ({ uri, name: "f", index: 0 })

describe("SessionManager connections", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  describe("working directory", () => {
    it("prefers the configured directory", () => {
      expect(createSessionFixture().manager.getWorkspaceCwd()).toBe("/work")
    })

    it("uses the first local workspace folder, never an ABAP system folder", () => {
      const { manager } = createSessionFixture()
      vscodeFake.settings.set("abapfs.acp.defaultWorkingDirectory", "")
      const local = FakeUri.file(path.resolve("project"))
      vscodeFake.workspace.workspaceFolders = [
        folder(FakeUri.parse("adt://dev100/")),
        folder(local)
      ]
      expect(manager.getWorkspaceCwd()).toBe(local.fsPath)
    })

    it("falls back to the agent workspace, then the process directory", () => {
      const { manager } = createSessionFixture()
      vscodeFake.settings.set("abapfs.acp.defaultWorkingDirectory", "")
      vi.mocked(agentWorkspaceRoot).mockReturnValueOnce("/agent-root")
      expect(manager.getWorkspaceCwd()).toBe("/agent-root")
      expect(manager.getWorkspaceCwd()).toBe(process.cwd())
    })
  })

  describe("connectToAgent", () => {
    it("spawns, connects and opens a session in the working directory", async () => {
      const f = createSessionFixture({ agentInfo: { title: "Claude Code" } })
      f.responses["session/new"] = () => ({
        sessionId: "s1",
        modes: { currentModeId: "ask", availableModes: [] },
        configOptions: [{ id: "model", category: "model" }]
      })
      const session = await f.manager.connectToAgent("Claude")
      expect(f.agentManager.spawnAgent).toHaveBeenCalledWith("Claude", AGENTS.Claude, "/work")
      expect(f.requests("session/new")).toEqual([{ cwd: "/work", mcpServers: [] }])
      expect(session).toMatchObject({
        sessionId: "s1",
        agentId: "agent_1",
        agentName: "Claude",
        agentDisplayName: "Claude Code",
        cwd: "/work",
        modes: { currentModeId: "ask" },
        models: null,
        configOptions: [{ id: "model" }],
        availableCommands: []
      })
      expect(f.manager.getActiveSession()).toBe(session)
      expect(f.manager.getActiveAgentName()).toBe("Claude")
      expect(f.events).toEqual([
        ["agent-connected", "Claude"],
        ["active-session-changed", "s1"]
      ])
      expect(f.history.list("Claude").map(e => e.sessionId)).toEqual(["s1"])
    })

    it("names the agent after its info, falling back to the configured name", async () => {
      const f = createSessionFixture({ agentInfo: { name: "" } })
      expect((await f.manager.connectToAgent("Claude")).agentDisplayName).toBe("Claude")
    })

    it("reuses the live session of an agent", async () => {
      const f = createSessionFixture()
      const first = await f.manager.connectToAgent("Claude")
      f.events.length = 0
      expect(await f.manager.connectToAgent("Claude")).toBe(first)
      expect(f.agentManager.spawnAgent).toHaveBeenCalledTimes(1)
      expect(f.events).toEqual([["active-session-changed", first.sessionId]])
    })

    it("disconnects the previous agent when switching", async () => {
      const f = createSessionFixture()
      const claude = await f.manager.connectToAgent("Claude")
      await f.manager.connectToAgent("Gemini")
      expect(f.agentManager.killAgent).toHaveBeenCalledWith(claude.agentId)
      expect(f.connectionManager.removeConnection).toHaveBeenCalledWith(claude.agentId)
      expect(f.manager.getConnectedAgentNames()).toEqual(["Gemini"])
      expect(f.events).toContainEqual(["agent-disconnected", "Claude"])
    })

    it("rejects unknown agents, listing the configured ones", async () => {
      await expect(createSessionFixture().manager.connectToAgent("Nope")).rejects.toThrow(
        "Unknown agent: Nope. Available: Claude, Gemini"
      )
    })

    it("kills the process when the connection or session cannot be set up", async () => {
      const f = createSessionFixture()
      f.connectionManager.connect.mockRejectedValueOnce(new Error("bad handshake"))
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow("bad handshake")
      expect(f.agentManager.killAgent).toHaveBeenCalledWith("agent_1")
      f.responses["session/new"] = () => {
        throw new Error("no session")
      }
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow("no session")
      expect(f.agentManager.killAgent).toHaveBeenCalledWith("agent_2")
      expect(f.manager.getActiveSession()).toBeUndefined()
    })

    it("cleans up when the agent process exits, ignoring other processes", async () => {
      const f = createSessionFixture()
      const session = await f.manager.connectToAgent("Claude")
      f.events.length = 0
      f.agentManager.emit("agent-closed", { agentId: "other", code: 0 })
      expect(f.events).toEqual([])
      f.agentManager.emit("agent-closed", { agentId: session.agentId, code: 1 })
      expect(f.manager.getActiveSession()).toBeUndefined()
      expect(f.manager.isAgentConnected("Claude")).toBe(false)
      expect(f.events).toEqual([
        ["agent-disconnected", "Claude"],
        ["active-session-changed", null],
        ["agent-closed", session.agentId, 1]
      ])
    })

    it("forwards errors of its own agent process", async () => {
      const f = createSessionFixture()
      const session = await f.manager.connectToAgent("Claude")
      const failure = new Error("crashed")
      f.agentManager.emit("agent-error", { agentId: "other", error: failure })
      f.agentManager.emit("agent-error", { agentId: session.agentId, error: failure })
      expect(f.events.filter(([e]) => e === "agent-error")).toEqual([
        ["agent-error", session.agentId, failure]
      ])
    })
  })

  describe("authentication", () => {
    const methods = [
      { id: "oauth", name: "Sign in", description: "Browser login" },
      { id: "key", name: "API key" }
    ]

    function needsAuth(f: ReturnType<typeof createSessionFixture>) {
      let attempts = 0
      f.responses["session/new"] = () => {
        if (attempts++ === 0) throw authRequired()
        return { sessionId: "after-auth" }
      }
    }

    it("confirms a single method, authenticates and retries", async () => {
      const f = createSessionFixture({ authMethods: [methods[0]] })
      needsAuth(f)
      window.showInformationMessage.mockResolvedValue("Authenticate")
      expect((await f.manager.connectToAgent("Claude")).sessionId).toBe("after-auth")
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Claude requires authentication via "Sign in".',
        { modal: true, detail: "Browser login" },
        "Authenticate"
      )
      expect(f.requests("authenticate")).toEqual([{ methodId: "oauth" }])
    })

    it("lets the user choose between several methods", async () => {
      const f = createSessionFixture({ authMethods: methods })
      needsAuth(f)
      window.showQuickPick.mockImplementation(async (items: any[]) => items[1])
      await f.manager.connectToAgent("Claude")
      expect(window.showQuickPick.mock.lastCall![0][1]).toMatchObject({
        label: "API key",
        detail: "ID: key"
      })
      expect(f.requests("authenticate")).toEqual([{ methodId: "key" }])
    })

    it.each([
      [
        "confirmation",
        [methods[0]],
        () => window.showInformationMessage.mockResolvedValue(undefined)
      ],
      ["method choice", methods, () => window.showQuickPick.mockResolvedValue(undefined)]
    ])("stops and kills the agent when the %s is cancelled", async (_step, authMethods, cancel) => {
      const f = createSessionFixture({ authMethods })
      needsAuth(f)
      cancel()
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow(
        "Authentication cancelled by user."
      )
      expect(f.agentManager.killAgent).toHaveBeenCalledWith("agent_1")
      expect(f.requests("authenticate")).toEqual([])
    })

    it("explains when no auth method is advertised", async () => {
      const f = createSessionFixture()
      needsAuth(f)
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow(
        'Agent "Claude" requires authentication but did not advertise any auth methods.'
      )
    })

    it("recognises auth errors by message too", async () => {
      const f = createSessionFixture({ authMethods: [methods[0]] })
      let attempts = 0
      f.responses["session/new"] = () => {
        if (attempts++ === 0) throw new Error("auth_required: please log in")
        return { sessionId: "ok" }
      }
      window.showInformationMessage.mockResolvedValue("Authenticate")
      expect((await f.manager.connectToAgent("Claude")).sessionId).toBe("ok")
    })

    it("reports failed authentication and failed retries", async () => {
      const f = createSessionFixture({ authMethods: [methods[0]] })
      needsAuth(f)
      window.showInformationMessage.mockResolvedValue("Authenticate")
      f.responses.authenticate = () => {
        throw new Error("denied")
      }
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow(
        "Authentication failed: denied"
      )
      f.responses.authenticate = () => ({})
      f.responses["session/new"] = () => {
        throw authRequired()
      }
      await expect(f.manager.connectToAgent("Claude")).rejects.toThrow("Authentication required")
      expect(f.agentManager.killAgent).toHaveBeenCalledWith("agent_2")
    })
  })

  describe("ABAP FS MCP server", () => {
    const running = { isRunning: true, port: 4711, url: MCP_URL }
    const offered = (f: ReturnType<typeof createSessionFixture>) =>
      f.requests("session/new")[0].mcpServers
    beforeEach(() =>
      vi.mocked(getMcpServerStatus).mockReturnValue({ isRunning: false, port: 0, url: "" })
    )

    it("is not offered unless enabled", async () => {
      const f = createSessionFixture()
      await f.manager.connectToAgent("Claude")
      expect(offered(f)).toEqual([])
      expect(vscodeFake.commands.executeCommand).not.toHaveBeenCalled()
    })

    it("is offered over HTTP with the API key to agents that support it", async () => {
      const f = createSessionFixture({ capabilities: { mcpCapabilities: { http: true } } })
      vscodeFake.settings.set("abapfs.acp.provideMcpServer", true)
      vscodeFake.settings.set("abapfs.mcpServer.apiKey", "k3y")
      vi.mocked(getMcpServerStatus).mockReturnValue(running)
      await f.manager.connectToAgent("Claude")
      expect(offered(f)).toEqual([
        {
          type: "http",
          name: "abap-fs",
          url: MCP_URL,
          headers: [{ name: "Authorization", value: "Bearer k3y" }]
        }
      ])
    })

    it("is bridged over stdio for agents without HTTP MCP support", async () => {
      const f = createSessionFixture()
      vscodeFake.settings.set("abapfs.acp.provideMcpServer", true)
      vscodeFake.settings.set("abapfs.mcpServer.apiKey", "k3y")
      vi.mocked(getMcpServerStatus).mockReturnValue(running)
      await f.manager.connectToAgent("Claude")
      const [bridge] = offered(f)
      expect(bridge).toMatchObject({ name: "abap-fs", command: process.execPath })
      expect(path.basename(bridge.args[0])).toBe("mcpStdioBridge.js")
      expect(bridge.args[1]).toBe(MCP_URL)
      expect(bridge.env).toEqual([
        { name: "ELECTRON_RUN_AS_NODE", value: "1" },
        { name: "ABAPFS_MCP_TOKEN", value: "k3y" }
      ])
    })

    it("starts the server on demand and goes without it if that fails", async () => {
      const f = createSessionFixture({ capabilities: { mcpCapabilities: { http: true } } })
      vscodeFake.settings.set("abapfs.acp.provideMcpServer", true)
      vscodeFake.commands.executeCommand
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce(undefined)
      await f.manager.connectToAgent("Claude")
      expect(vscodeFake.commands.executeCommand).toHaveBeenCalledWith("abapfs.startMcpServer")
      expect(offered(f)).toEqual([{ type: "http", name: "abap-fs", url: MCP_URL, headers: [] }])
      await f.manager.newConversation()
      expect(f.requests("session/new")[1].mcpServers).toEqual([])
    })
  })

  it("adds other local workspace roots for agents supporting additional directories", async () => {
    const f = createSessionFixture({
      capabilities: { sessionCapabilities: { additionalDirectories: {} } } as any
    })
    const [work, other] = [path.resolve("work"), path.resolve("other")]
    vscodeFake.settings.set("abapfs.acp.defaultWorkingDirectory", work)
    vscodeFake.workspace.workspaceFolders = [
      folder(FakeUri.file(work)),
      folder(FakeUri.parse("adt://dev100/")),
      folder(FakeUri.file(other)),
      folder(FakeUri.file(other))
    ]
    await f.manager.connectToAgent("Claude")
    expect(f.requests("session/new")[0].additionalDirectories).toEqual([FakeUri.file(other).fsPath])
  })

  describe("newConversation", () => {
    it("does nothing without an active session", async () => {
      expect(await createSessionFixture().manager.newConversation()).toBeNull()
    })

    it("opens a fresh session on the same connection", async () => {
      const f = createSessionFixture()
      const old = await f.manager.connectToAgent("Claude")
      f.events.length = 0
      const fresh = await f.manager.newConversation()
      expect(fresh?.agentId).toBe(old.agentId)
      expect(f.agentManager.spawnAgent).toHaveBeenCalledTimes(1)
      expect(f.manager.getSession(old.sessionId)).toBeUndefined()
      expect(f.manager.getActiveSessionId()).toBe(fresh?.sessionId)
      expect(f.events).toEqual([["clear-chat"], ["active-session-changed", fresh?.sessionId]])
    })

    it("reconnects when the connection is gone", async () => {
      const f = createSessionFixture()
      const old = await f.manager.connectToAgent("Claude")
      f.connections.delete(old.agentId)
      const fresh = await f.manager.newConversation()
      expect(f.agentManager.spawnAgent).toHaveBeenCalledTimes(2)
      expect(fresh?.agentId).toBe("agent_2")
      expect(f.events).toContainEqual(["clear-chat"])
    })
  })

  it("ignores disconnecting agents that are not connected", async () => {
    const f = createSessionFixture()
    await f.manager.disconnectAgent("Claude")
    expect(f.agentManager.killAgent).not.toHaveBeenCalled()
  })

  it("exposes the connection of a session", async () => {
    const f = createSessionFixture()
    const session = await f.manager.connectToAgent("Claude")
    expect(f.manager.getConnectionForSession(session.sessionId)).toBe(
      f.connections.get(session.agentId)
    )
    expect(f.manager.getConnectionForSession("nope")).toBeUndefined()
  })

  it("kills all agents and closes all connections on dispose", async () => {
    const f = createSessionFixture()
    await f.manager.connectToAgent("Claude")
    f.manager.dispose()
    expect(f.agentManager.killAll).toHaveBeenCalled()
    expect(f.connectionManager.dispose).toHaveBeenCalled()
    expect(f.manager.getConnectedAgentNames()).toEqual([])
  })
})
