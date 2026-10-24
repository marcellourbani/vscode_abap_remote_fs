// activation.ts is a thin wiring module: it instantiates the real managers but we substitute
// lightweight fakes for every class it imports, then assert the wiring (events -> webview calls,
// commands -> manager calls, config toggles -> start/stop).
import { EventEmitter } from "node:events"
import { vscodeFake, resetVscodeFake } from "./testing/vscodeFake"
import { registerAcpFeature } from "./activation"
import { addAgentInteractive, getAgentNames, removeAgentInteractive } from "./config/AgentConfig"
import { showSessionHistory } from "./ui/SessionHistoryPicker"
import { disposeChannels, getOutputChannel, getTrafficChannel, log } from "./utils/Logger"
import { sendEvent } from "./utils/TelemetryManager"
import { initAgentRoot } from "./fs/AbapPathMapper"

vi.mock("vscode", async () => (await import("./testing/vscodeFake")).vscodeFake)
vi.mock("./utils/Logger", () => ({
  log: vi.fn(),
  logError: vi.fn(),
  disposeChannels: vi.fn(),
  getOutputChannel: vi.fn(() => ({ show: vi.fn() })),
  getTrafficChannel: vi.fn(() => ({ show: vi.fn() }))
}))
vi.mock("./utils/TelemetryManager", () => ({ sendEvent: vi.fn() }))
vi.mock("./fs/AbapPathMapper", () => ({ initAgentRoot: vi.fn() }))
vi.mock("./ui/SessionHistoryPicker", () => ({ showSessionHistory: vi.fn() }))
vi.mock("./config/AgentConfig", () => ({
  ACP_CONFIG_SECTION: "abapfs.acp",
  addAgentInteractive: vi.fn(async () => undefined),
  removeAgentInteractive: vi.fn(async () => undefined),
  getAgentNames: vi.fn(() => ["Claude"])
}))
vi.mock("./core/AgentManager", () => ({ AgentManager: class {} }))
vi.mock("./core/ConnectionManager", () => ({ ConnectionManager: class {} }))
vi.mock("./handlers/SessionUpdateHandler", () => ({
  SessionUpdateHandler: class {
    dispose = vi.fn()
  }
}))
vi.mock("./core/SessionHistoryStore", () => ({
  SessionHistoryStore: class {
    dispose = vi.fn()
  }
}))

class FakeSessionManager extends EventEmitter {
  activeId: string | null = null
  activeAgent: string | null = null
  activeSession: { agentDisplayName: string; modes?: unknown; models?: unknown } | null = null
  setHistoryStore = vi.fn()
  getActiveSessionId = vi.fn(() => this.activeId)
  getActiveAgentName = vi.fn(() => this.activeAgent)
  getActiveSession = vi.fn(() => this.activeSession ?? undefined)
  connectToAgent = vi.fn(async (name: string) => {
    this.activeAgent = name
    this.activeId = `session-${name}`
  })
  newConversation = vi.fn(async () => {})
  disconnectAgent = vi.fn(async () => {})
  cancelTurn = vi.fn(async () => {})
  setMode = vi.fn(async () => {})
  setModel = vi.fn(async () => {})
  dispose = vi.fn()
}

let sessionManager: FakeSessionManager
// Regular `function`, not an arrow: `new SessionManager(...)` requires a constructible value.
vi.mock("./core/SessionManager", () => ({
  SessionManager: vi.fn(function () {
    return sessionManager
  })
}))

const chat = {
  setMascotEnabled: vi.fn(),
  notifyMascotActivity: vi.fn(),
  notifyActiveSessionChanged: vi.fn(),
  clearChat: vi.fn(),
  notifyLoadSessionStart: vi.fn(),
  notifyLoadSessionEnd: vi.fn(),
  notifyModesUpdate: vi.fn(),
  notifyModelsUpdate: vi.fn(),
  notifySessionInfoUpdate: vi.fn(),
  attachFile: vi.fn(),
  dispose: vi.fn(),
  hasChatContent: false
}
vi.mock("./ui/ChatWebviewProvider", () => ({
  ChatWebviewProvider: vi.fn(function () {
    return chat
  })
}))
const { ChatWebviewProvider } = await import("./ui/ChatWebviewProvider")
// viewType is a static property, read before the mocked constructor ever runs
;(ChatWebviewProvider as unknown as { viewType: string }).viewType = "abapfs.views.agentChat"

const statusBar = { dispose: vi.fn() }
vi.mock("./ui/StatusBarManager", () => ({
  StatusBarManager: vi.fn(function () {
    return statusBar
  })
}))

const window = vscodeFake.window
const commands = vscodeFake.commands
const context = () => ({
  subscriptions: [] as { dispose(): void }[],
  globalStorageUri: { fsPath: "/storage" },
  workspaceState: { get: vi.fn(), update: vi.fn(async () => {}) },
  globalState: { get: vi.fn(() => true), update: vi.fn(async () => {}) }
})
const run = (command: string, ...args: unknown[]) => commands.registered.get(command)!(...args)

describe("registerAcpFeature", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
    sessionManager = new FakeSessionManager()
  })

  it("stays dormant when the feature is disabled", () => {
    registerAcpFeature(context() as any)
    expect(log).not.toHaveBeenCalledWith("ACP agent chat starting...")
    expect(commands.registerCommand).not.toHaveBeenCalled()
  })

  it("starts everything when enabled and wires the agent root to extension storage", () => {
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    registerAcpFeature(context() as any)
    expect(initAgentRoot).toHaveBeenCalledWith("/storage")
    expect(log).toHaveBeenCalledWith("ACP agent chat starting...")
    expect(window.registerWebviewViewProvider).toHaveBeenCalledWith(
      "abapfs.views.agentChat",
      chat,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
    expect(commands.registered.has("abapfs.acp.connectAgent")).toBe(true)
  })

  it("starts on enable and tears down on disable, re-registering commands on re-enable", () => {
    vscodeFake.settings.set("abapfs.acp.enabled", false)
    registerAcpFeature(context() as any)
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    const onConfigChange = vscodeFake.workspace.onDidChangeConfiguration.mock.lastCall![0]
    onConfigChange({ affectsConfiguration: (s: string) => s === "abapfs.acp.enabled" })
    expect(commands.registered.has("abapfs.acp.connectAgent")).toBe(true)
    expect(commands.executeCommand).toHaveBeenCalledWith("abapfs.views.agentChat.focus")

    vscodeFake.settings.set("abapfs.acp.enabled", false)
    onConfigChange({ affectsConfiguration: (s: string) => s === "abapfs.acp.enabled" })
    expect(sessionManager.dispose).toHaveBeenCalled()
    expect(chat.dispose).toHaveBeenCalled()
  })

  it("ignores configuration changes unrelated to the enabled flag", () => {
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    registerAcpFeature(context() as any)
    const onConfigChange = vscodeFake.workspace.onDidChangeConfiguration.mock.lastCall![0]
    vi.clearAllMocks()
    onConfigChange({ affectsConfiguration: () => false })
    expect(sessionManager.dispose).not.toHaveBeenCalled()
  })

  it("disposes everything, including log channels, when the extension deactivates", () => {
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    const ctx = context()
    registerAcpFeature(ctx as any)
    ctx.subscriptions.forEach(d => d.dispose())
    expect(sessionManager.dispose).toHaveBeenCalled()
    expect(chat.dispose).toHaveBeenCalled()
    expect(disposeChannels).toHaveBeenCalled()
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "abapfs.acp.connected",
      false
    )
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "abapfs.acp.turnRunning",
      false
    )
  })
})

describe("registerAcpFeature: mascot toggle", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
    sessionManager = new FakeSessionManager()
    vscodeFake.settings.set("abapfs.acp.enabled", true)
  })

  it("restores the saved visibility and flips it on command", async () => {
    const ctx = context()
    ctx.globalState.get.mockReturnValue(false)
    registerAcpFeature(ctx as any)
    expect(chat.setMascotEnabled).toHaveBeenCalledWith(false)
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "abapfs.acp.petVisible",
      false
    )

    await run("abapfs.acp.togglePet")
    expect(chat.setMascotEnabled).toHaveBeenLastCalledWith(true)
    expect(ctx.globalState.update).toHaveBeenCalledWith("abapfs.acp.petVisible", true)
    expect(commands.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      "abapfs.acp.petVisible",
      true
    )
  })
})

describe("registerAcpFeature: session events forwarded to the webview", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
    sessionManager = new FakeSessionManager()
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    registerAcpFeature(context() as any)
  })

  it("notifies the webview and updates the connected context on active-session-changed", () => {
    sessionManager.activeId = "s1"
    sessionManager.emit("active-session-changed")
    expect(chat.notifyActiveSessionChanged).toHaveBeenCalled()
    expect(commands.executeCommand).toHaveBeenCalledWith("setContext", "abapfs.acp.connected", true)
  })

  it("only clears the chat on agent-disconnected when nothing is active", () => {
    sessionManager.activeId = "s1"
    sessionManager.emit("agent-disconnected")
    expect(chat.clearChat).not.toHaveBeenCalled()
    sessionManager.activeId = null
    sessionManager.emit("agent-disconnected")
    expect(chat.clearChat).toHaveBeenCalledTimes(1)
  })

  it("clears the chat on clear-chat", () => {
    sessionManager.emit("clear-chat")
    expect(chat.clearChat).toHaveBeenCalled()
  })

  it("shows the loading overlay during session/load and refreshes state once done", () => {
    sessionManager.emit("session-load-start")
    expect(chat.notifyLoadSessionStart).toHaveBeenCalled()
    sessionManager.emit("session-load-end", "s1", "Claude", false)
    expect(chat.notifyLoadSessionEnd).toHaveBeenCalledWith(false)
    expect(chat.notifyActiveSessionChanged).not.toHaveBeenCalled()
    sessionManager.emit("session-load-end", "s1", "Claude", true)
    expect(chat.notifyActiveSessionChanged).toHaveBeenCalled()
  })

  it("forwards mode and model changes only when the active session reports them", () => {
    sessionManager.activeSession = { agentDisplayName: "Claude", modes: { currentModeId: "ask" } }
    sessionManager.emit("mode-changed", "s1", "ask")
    expect(chat.notifyModesUpdate).toHaveBeenCalledWith({ currentModeId: "ask" })
    sessionManager.activeSession = { agentDisplayName: "Claude" }
    sessionManager.emit("model-changed", "s1", "gpt")
    expect(chat.notifyModelsUpdate).not.toHaveBeenCalled()
  })

  it("forwards a session title update only for the active session", () => {
    sessionManager.activeId = "s1"
    sessionManager.emit("session-info-changed", "other", { title: "x" })
    expect(chat.notifySessionInfoUpdate).not.toHaveBeenCalled()
    sessionManager.emit("session-info-changed", "s1", { title: "Fix ZDEMO" })
    expect(chat.notifySessionInfoUpdate).toHaveBeenCalledWith("Fix ZDEMO")
  })
})

describe("registerAcpFeature: commands", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
    sessionManager = new FakeSessionManager()
    vscodeFake.settings.set("abapfs.acp.enabled", true)
    registerAcpFeature(context() as any)
  })

  describe("agent management", () => {
    it("offers to connect after adding an agent", async () => {
      vi.mocked(addAgentInteractive).mockResolvedValue("Claude")
      window.showInformationMessage.mockResolvedValue("Connect")
      await run("abapfs.acp.addAgent")
      expect(window.showInformationMessage).toHaveBeenCalledWith('Agent "Claude" added.', "Connect")
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Claude")
    })

    it("does nothing when adding an agent is cancelled, or the user declines to connect", async () => {
      vi.mocked(addAgentInteractive).mockResolvedValue(undefined)
      await run("abapfs.acp.addAgent")
      expect(window.showInformationMessage).not.toHaveBeenCalled()
      vi.mocked(addAgentInteractive).mockResolvedValue("Claude")
      window.showInformationMessage.mockResolvedValue(undefined)
      await run("abapfs.acp.addAgent")
      expect(sessionManager.connectToAgent).not.toHaveBeenCalled()
    })

    it("removes an agent and reports it", async () => {
      vi.mocked(removeAgentInteractive).mockResolvedValue("Claude")
      await run("abapfs.acp.removeAgent")
      expect(window.showInformationMessage).toHaveBeenCalledWith('Agent "Claude" removed.')
    })

    it("opens the agent settings", async () => {
      await run("abapfs.acp.manageAgents")
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.openSettings",
        "abapfs.acp"
      )
    })
  })

  describe("connectAgent", () => {
    it("connects directly to a named agent, driving the mascot through connecting/idle", async () => {
      await run("abapfs.acp.connectAgent", "Claude")
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Claude")
      expect(chat.notifyMascotActivity.mock.calls).toEqual([["connecting"], ["idle"]])
      expect(window.withProgress.mock.lastCall![0]).toMatchObject({
        title: "Connecting to Claude..."
      })
    })

    it("accepts a tree item with an agentName property", async () => {
      await run("abapfs.acp.connectAgent", { agentName: "Claude" })
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Claude")
    })

    it("prompts for an agent when called from the command palette", async () => {
      vi.mocked(getAgentNames).mockReturnValue(["Claude", "Gemini"])
      window.showQuickPick.mockResolvedValue("Gemini")
      await run("abapfs.acp.connectAgent")
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Gemini")
    })

    it("does nothing when no agent is picked", async () => {
      vi.mocked(getAgentNames).mockReturnValue([])
      vi.mocked(addAgentInteractive).mockResolvedValue(undefined)
      await run("abapfs.acp.connectAgent")
      expect(sessionManager.connectToAgent).not.toHaveBeenCalled()
    })

    it("confirms before switching agents away from a chat with content", async () => {
      sessionManager.activeAgent = "Claude"
      chat.hasChatContent = true
      window.showWarningMessage.mockResolvedValue("Cancel")
      await run("abapfs.acp.connectAgent", "Gemini")
      expect(sessionManager.connectToAgent).not.toHaveBeenCalled()
      window.showWarningMessage.mockResolvedValue("Switch Agent")
      await run("abapfs.acp.connectAgent", "Gemini")
      expect(chat.clearChat).toHaveBeenCalled()
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Gemini")
      chat.hasChatContent = false
    })

    it("does not confirm when reconnecting to the same agent", async () => {
      sessionManager.activeAgent = "Claude"
      chat.hasChatContent = true
      await run("abapfs.acp.connectAgent", "Claude")
      expect(window.showWarningMessage).not.toHaveBeenCalled()
      chat.hasChatContent = false
    })

    it("marks the mascot in error and reports a connection failure", async () => {
      sessionManager.connectToAgent.mockRejectedValueOnce(new Error("spawn failed"))
      await run("abapfs.acp.connectAgent", "Claude")
      expect(chat.notifyMascotActivity).toHaveBeenLastCalledWith("error")
      expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to connect: spawn failed")
    })
  })

  describe("newConversation", () => {
    it("falls back to connectAgent without an active session", async () => {
      await run("abapfs.acp.newConversation")
      expect(sessionManager.newConversation).not.toHaveBeenCalled()
      expect(commands.executeCommand).toHaveBeenCalledWith("abapfs.acp.connectAgent")
    })

    it("starts a new conversation with the active agent", async () => {
      sessionManager.activeSession = { agentDisplayName: "Claude Code" }
      await run("abapfs.acp.newConversation")
      expect(sessionManager.newConversation).toHaveBeenCalled()
      expect(window.withProgress.mock.lastCall![0]).toMatchObject({
        title: "Starting new conversation with Claude Code..."
      })
    })

    it("reports a failure to start a new conversation", async () => {
      sessionManager.activeSession = { agentDisplayName: "Claude Code" }
      sessionManager.newConversation.mockRejectedValueOnce(new Error("boom"))
      await run("abapfs.acp.newConversation")
      expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to start new conversation: boom")
    })
  })

  it("shows session history", async () => {
    await run("abapfs.acp.showHistory")
    expect(showSessionHistory).toHaveBeenCalledWith(sessionManager, chat)
  })

  describe("disconnectAgent", () => {
    it("disconnects the active agent by default", async () => {
      sessionManager.activeAgent = "Claude"
      await run("abapfs.acp.disconnectAgent")
      expect(sessionManager.disconnectAgent).toHaveBeenCalledWith("Claude")
      expect(window.showInformationMessage).toHaveBeenCalledWith("Disconnected from Claude.")
    })

    it("disconnects a named agent from a tree item", async () => {
      await run("abapfs.acp.disconnectAgent", { agentName: "Gemini" })
      expect(sessionManager.disconnectAgent).toHaveBeenCalledWith("Gemini")
    })

    it("tells the user when there is nothing to disconnect", async () => {
      await run("abapfs.acp.disconnectAgent")
      expect(window.showInformationMessage).toHaveBeenCalledWith("No agent connected.")
      expect(sessionManager.disconnectAgent).not.toHaveBeenCalled()
    })
  })

  it("opens and focuses the chat for openChat and sendPrompt", async () => {
    await run("abapfs.acp.openChat")
    await run("abapfs.acp.sendPrompt")
    const focusCalls = commands.executeCommand.mock.calls.filter(
      c => c[0] === "abapfs.views.agentChat.focus"
    )
    expect(focusCalls).toHaveLength(2)
  })

  describe("cancelTurn", () => {
    it("cancels the active turn and swallows failures", async () => {
      sessionManager.activeId = "s1"
      await run("abapfs.acp.cancelTurn")
      expect(sessionManager.cancelTurn).toHaveBeenCalledWith("s1")
      sessionManager.cancelTurn.mockRejectedValueOnce(new Error("already done"))
      await expect(run("abapfs.acp.cancelTurn")).resolves.toBeUndefined()
    })

    it("does nothing without an active turn", async () => {
      await run("abapfs.acp.cancelTurn")
      expect(sessionManager.cancelTurn).not.toHaveBeenCalled()
    })
  })

  describe("restartAgent", () => {
    it("disconnects then reconnects the active agent", async () => {
      sessionManager.activeSession = { agentName: "Claude", agentDisplayName: "Claude Code" } as any
      await run("abapfs.acp.restartAgent")
      expect(sessionManager.disconnectAgent).toHaveBeenCalledWith("Claude")
      expect(sessionManager.connectToAgent).toHaveBeenCalledWith("Claude")
      expect(window.showInformationMessage).toHaveBeenCalledWith("Restarted Claude")
    })

    it("does nothing without an active session", async () => {
      await run("abapfs.acp.restartAgent")
      expect(sessionManager.disconnectAgent).not.toHaveBeenCalled()
    })

    it("reports a failed restart", async () => {
      sessionManager.activeSession = { agentName: "Claude", agentDisplayName: "Claude Code" } as any
      sessionManager.connectToAgent.mockRejectedValueOnce(new Error("down"))
      await run("abapfs.acp.restartAgent")
      expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to restart: down")
    })
  })

  it("shows the output log and sends telemetry", async () => {
    await run("abapfs.acp.showLog")
    expect(sendEvent).toHaveBeenCalledWith("command/showLog")
    expect(vi.mocked(getOutputChannel)().show).toBeDefined()
  })

  it("shows the traffic log and sends telemetry", async () => {
    await run("abapfs.acp.showTraffic")
    expect(sendEvent).toHaveBeenCalledWith("command/showTraffic")
  })

  describe("setMode / setModel", () => {
    it("sets the mode directly when given an id", async () => {
      sessionManager.activeId = "s1"
      await run("abapfs.acp.setMode", "code")
      expect(sessionManager.setMode).toHaveBeenCalledWith("s1", "code")
    })

    it("prompts for a mode id when none is given, and does nothing if cancelled", async () => {
      sessionManager.activeId = "s1"
      window.showInputBox.mockResolvedValue("plan")
      await run("abapfs.acp.setMode")
      expect(sessionManager.setMode).toHaveBeenCalledWith("s1", "plan")
      window.showInputBox.mockResolvedValue(undefined)
      await run("abapfs.acp.setMode")
      expect(sessionManager.setMode).toHaveBeenCalledTimes(1)
    })

    it("does nothing without an active session", async () => {
      await run("abapfs.acp.setMode", "code")
      expect(sessionManager.setMode).not.toHaveBeenCalled()
    })

    it("reports a failure to set the mode", async () => {
      sessionManager.activeId = "s1"
      sessionManager.setMode.mockRejectedValueOnce(new Error("rejected"))
      await run("abapfs.acp.setMode", "code")
      expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to set mode: rejected")
    })

    it("sets the model directly or by prompt, reporting failures", async () => {
      sessionManager.activeId = "s1"
      await run("abapfs.acp.setModel", "gpt")
      expect(sessionManager.setModel).toHaveBeenCalledWith("s1", "gpt")
      window.showInputBox.mockResolvedValue("opus")
      await run("abapfs.acp.setModel")
      expect(sessionManager.setModel).toHaveBeenCalledWith("s1", "opus")
      sessionManager.setModel.mockRejectedValueOnce(new Error("nope"))
      await run("abapfs.acp.setModel", "x")
      expect(window.showErrorMessage).toHaveBeenCalledWith("Failed to set model: nope")
    })
  })

  describe("attachFile", () => {
    it("attaches every file picked from the open dialog", async () => {
      const files = [{ toString: () => "a" }, { toString: () => "b" }]
      window.showOpenDialog.mockResolvedValue(files)
      await run("abapfs.acp.attachFile")
      expect(chat.attachFile).toHaveBeenCalledTimes(2)
      expect(window.showOpenDialog).toHaveBeenCalledWith({
        canSelectMany: true,
        openLabel: "Attach",
        title: "Attach Files to Chat"
      })
    })

    it("does nothing when the dialog is cancelled", async () => {
      window.showOpenDialog.mockResolvedValue(undefined)
      await run("abapfs.acp.attachFile")
      expect(chat.attachFile).not.toHaveBeenCalled()
    })
  })
})
