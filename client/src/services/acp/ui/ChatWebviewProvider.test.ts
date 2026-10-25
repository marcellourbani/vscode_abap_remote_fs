import * as path from "node:path"
import { resetVscodeFake, vscodeFake } from "../testing/vscodeFake"
import { createChatHarness, fakeEditor, activate } from "../testing/chatViewHarness"
import { logError } from "../utils/Logger"
import { sendEvent } from "../utils/TelemetryManager"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
// getHtmlContent() reads the real template file; serve it from disk so tests exercise the
// actual placeholder substitution instead of a hand-rolled stand-in.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  const templatePath = path.join(__dirname, "../../../../media/acp/chatView.html")
  return { readFileSync: vi.fn(() => actual.readFileSync(templatePath, "utf8")) }
})
vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn() }))
vi.mock("../utils/TelemetryManager", () => ({ sendEvent: vi.fn() }))
vi.mock("../fs/AbapPathMapper", () => ({
  toAgentUri: (uri: { toString(): string }) => `agent:${uri.toString()}`
}))
vi.mock("../../../adt/conections", () => ({ ADTSCHEME: "adt" }))
vi.mock("../core/SessionManager", () => ({}))

describe("ChatWebviewProvider: resolving the view", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("enables scripts and restricts resource roots to the extension", () => {
    const { webview, extensionUri } = createChatHarness()
    expect(webview.options).toEqual({ enableScripts: true, localResourceRoots: [extensionUri] })
  })

  it("renders CSP-protected HTML containing the mascot markup and the webview script", () => {
    const { webview } = createChatHarness()
    expect(webview.html).toContain("Content-Security-Policy")
    expect(webview.html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}'/)
    expect(webview.html).toContain("acquireVsCodeApi()")
    expect(webview.html).toContain("chat-mascot")
  })

  it("stops posting messages once the webview is disposed", () => {
    const { provider, view, webview } = createChatHarness()
    view.onDidDispose.fire(undefined)
    webview.postMessage.mockClear()
    provider.notifyMascotActivity("error")
    expect(webview.postMessage).not.toHaveBeenCalled()
  })
})

describe("ChatWebviewProvider: ready / state", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("sends mascot visibility, session state and attachments on ready", async () => {
    const { send, last, session } = createChatHarness()
    await send({ type: "ready" })
    expect(last("mascotVisibility")).toEqual({ type: "mascotVisibility", enabled: true })
    expect(last("mascotActivity")).toEqual({ type: "mascotActivity", activity: "idle" })
    expect(last("state")).toEqual({
      type: "state",
      activeSessionId: "s1",
      session: {
        sessionId: "s1",
        agentName: "Claude Code",
        title: "Fix ZDEMO",
        cwd: "/work",
        modes: null,
        models: null,
        configOptions: session.configOptions,
        availableCommands: session.availableCommands,
        responseMetadata: [{ modelName: "opus" }]
      }
    })
    expect(last("attachmentsUpdate")).toMatchObject({ type: "attachmentsUpdate", attachments: [] })
  })

  it("sends a null session when nothing is active", async () => {
    const { send, last, sessions } = createChatHarness()
    sessions.activeId = null
    await send({ type: "ready" })
    expect(last("state")).toEqual({ type: "state", activeSessionId: null, session: null })
  })

  it("toggles mascot visibility on command", () => {
    const { provider, last } = createChatHarness()
    provider.setMascotEnabled(false)
    expect(last("mascotVisibility")).toEqual({
      type: "mascotVisibility",
      enabled: false,
      animate: true
    })
  })

  it("broadcasts mascot activity", () => {
    const { provider, last } = createChatHarness()
    provider.notifyMascotActivity("connecting")
    expect(last("mascotActivity")).toEqual({ type: "mascotActivity", activity: "connecting" })
  })
})

describe("ChatWebviewProvider: active session changes", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("resends state without resetting subagents when the session id is unchanged", () => {
    const { provider, posted } = createChatHarness()
    provider.notifyActiveSessionChanged() // first call always transitions from "no session"
    provider.notifyActiveSessionChanged()
    expect(posted("subagentsReset")).toHaveLength(1)
    expect(posted("state")).toHaveLength(2)
  })

  it("resets subagents and resends state when the session id changes", () => {
    const { provider, sessions, session, posted } = createChatHarness()
    sessions.activeId = "s2"
    sessions.getSession.mockImplementation((id: string) => (id === "s2" ? session : undefined))
    provider.notifyActiveSessionChanged()
    expect(posted("subagentsReset")).toHaveLength(1)
  })

  it("clears chat and resets subagents", () => {
    const { provider, last } = createChatHarness()
    provider.clearChat()
    expect(provider.hasChatContent).toBe(false)
    expect(last("clearChat")).toEqual({ type: "clearChat" })
  })
})

describe("ChatWebviewProvider: mode, model and config option updates from the webview", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("forwards mode changes and reports failures", async () => {
    const { send, sessions, last } = createChatHarness()
    await send({ type: "setMode", modeId: "code" })
    expect(sessions.setMode).toHaveBeenCalledWith("s1", "code")
    sessions.setMode.mockRejectedValueOnce(new Error("rejected"))
    await send({ type: "setMode", modeId: "plan" })
    expect(last("error")).toEqual({ type: "error", message: "Failed to set mode: rejected" })
    expect(logError).toHaveBeenCalledWith("Failed to set mode", expect.any(Error))
  })

  it("ignores mode/model changes without an active session or empty id", async () => {
    const { send, sessions } = createChatHarness()
    sessions.activeId = null
    await send({ type: "setMode", modeId: "code" })
    await send({ type: "setModel", modelId: "gpt" })
    sessions.activeId = "s1"
    await send({ type: "setMode", modeId: "" })
    expect(sessions.setMode).not.toHaveBeenCalled()
    expect(sessions.setModel).not.toHaveBeenCalled()
  })

  it("forwards model changes and reports failures", async () => {
    const { send, sessions, last } = createChatHarness()
    await send({ type: "setModel", modelId: "gpt" })
    expect(sessions.setModel).toHaveBeenCalledWith("s1", "gpt")
    sessions.setModel.mockRejectedValueOnce(new Error("nope"))
    await send({ type: "setModel", modelId: "gpt2" })
    expect(last("error")).toEqual({ type: "error", message: "Failed to set model: nope" })
  })

  it("applies a config option change and broadcasts the agent's full option list", async () => {
    const { send, sessions, last } = createChatHarness()
    await send({ type: "setConfigOption", configId: "llm", value: "b" })
    expect(sessions.setConfigOption).toHaveBeenCalledWith("s1", "llm", "b")
    expect(last("configOptionsUpdate")).toEqual({
      type: "configOptionsUpdate",
      configOptions: [{ id: "llm", currentValue: "b" }]
    })
  })

  it("rolls back the webview state when a config option change fails", async () => {
    const { send, sessions, last, session } = createChatHarness()
    sessions.setConfigOption.mockRejectedValueOnce(new Error("denied"))
    await send({ type: "setConfigOption", configId: "llm", value: "c" })
    const posted = [last("error"), last("configOptionsUpdate")]
    expect(posted[0]).toEqual({ type: "error", message: "Failed to set llm: denied" })
    expect(posted[1]).toEqual({ type: "configOptionsUpdate", configOptions: session.configOptions })
    expect(sessions.setConfigOption).toHaveBeenCalledTimes(1)
  })

  it("ignores a config option change without an active session or empty id", async () => {
    const { send, sessions } = createChatHarness()
    sessions.activeId = null
    await send({ type: "setConfigOption", configId: "llm", value: "b" })
    sessions.activeId = "s1"
    await send({ type: "setConfigOption", configId: "", value: "b" })
    expect(sessions.setConfigOption).not.toHaveBeenCalled()
  })
})

describe("ChatWebviewProvider: turn and subagent cancellation", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("cancels the active turn and logs failures without surfacing them", async () => {
    const { send, sessions } = createChatHarness()
    await send({ type: "cancelTurn" })
    expect(sessions.cancelTurn).toHaveBeenCalledWith("s1")
    sessions.cancelTurn.mockRejectedValueOnce(new Error("already done"))
    await send({ type: "cancelTurn" })
    expect(logError).toHaveBeenCalledWith("Cancel failed", expect.any(Error))
  })

  it("does nothing cancelling a turn without an active session", async () => {
    const { send, sessions } = createChatHarness()
    sessions.activeId = null
    await send({ type: "cancelTurn" })
    expect(sessions.cancelTurn).not.toHaveBeenCalled()
  })

  it("cancels a subagent only when it still advertises the capability", async () => {
    const { send, update, notify } = createChatHarness()
    update("s1", {
      sessionUpdate: "subagent_update",
      sessionId: "sub1",
      capabilities: { cancel: true }
    })
    await send({ type: "cancelSubagent", sessionId: "sub1" })
    expect(notify).toHaveBeenCalledWith("session/cancel", { sessionId: "sub1" })
  })

  it("ignores cancelling an unknown or non-cancellable subagent", async () => {
    const { send, notify } = createChatHarness()
    await send({ type: "cancelSubagent", sessionId: "unknown" })
    expect(notify).not.toHaveBeenCalled()
  })

  it("logs a failure to cancel a subagent", async () => {
    const { send, update, notify } = createChatHarness()
    update("s1", {
      sessionUpdate: "subagent_update",
      sessionId: "sub1",
      capabilities: { cancel: true }
    })
    notify.mockRejectedValueOnce(new Error("gone"))
    await send({ type: "cancelSubagent", sessionId: "sub1" })
    expect(logError).toHaveBeenCalledWith("Failed to cancel subagent sub1", expect.any(Error))
  })
})

describe("ChatWebviewProvider: session updates", () => {
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("forwards updates for the active session and persists side-channel state first", () => {
    const { update, sessions, last } = createChatHarness()
    update("s1", { sessionUpdate: "available_commands_update", availableCommands: [{ name: "x" }] })
    expect(sessions.applyAvailableCommands).toHaveBeenCalledWith("s1", [{ name: "x" }])
    expect(last("sessionUpdate")).toMatchObject({ sessionId: "s1", isSubagent: false })

    update("s1", { sessionUpdate: "config_option_update", configOptions: [{ id: "x" }] })
    expect(sessions.applyConfigOptions).toHaveBeenCalledWith("s1", [{ id: "x" }])

    update("s1", { sessionUpdate: "session_info_update", title: "New title", updatedAt: "now" })
    expect(sessions.applySessionInfoUpdate).toHaveBeenCalledWith("s1", {
      title: "New title",
      updatedAt: "now"
    })
  })

  it("defaults missing command/config lists to empty arrays", () => {
    const { update, sessions } = createChatHarness()
    update("s1", { sessionUpdate: "available_commands_update" })
    update("s1", { sessionUpdate: "config_option_update" })
    expect(sessions.applyAvailableCommands).toHaveBeenCalledWith("s1", [])
    expect(sessions.applyConfigOptions).toHaveBeenCalledWith("s1", [])
  })

  it("drops updates for sessions that are neither active nor a known subagent", () => {
    const { update, posted } = createChatHarness()
    update("other", { sessionUpdate: "agent_message_chunk" })
    expect(posted("sessionUpdate")).toEqual([])
  })

  it("accepts and marks subagent updates for the active session, merging into prior state", () => {
    const { update, last } = createChatHarness()
    update("s1", { sessionUpdate: "subagent_update", sessionId: "sub1", status: "running" })
    update("sub1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })
    const forwarded = last("sessionUpdate")
    expect(forwarded).toMatchObject({ sessionId: "sub1", isSubagent: true })
  })
})
