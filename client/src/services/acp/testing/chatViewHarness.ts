// Drives ChatWebviewProvider like VS Code does: resolves the view, delivers webview messages and
// records everything posted back. Test files declare the vi.mock calls.
import { vi } from "vitest"
import { ChatWebviewProvider } from "../ui/ChatWebviewProvider"
import { SessionUpdateHandler } from "../handlers/SessionUpdateHandler"
import { FakeUri, fakeEvent, vscodeFake } from "./vscodeFake"

import type { ContentBlock, PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"

export function createChatHarness(promptCapabilities: Record<string, boolean> = {}) {
  const updates = new SessionUpdateHandler()
  const session = {
    sessionId: "s1",
    agentDisplayName: "Claude Code",
    title: "Fix ZDEMO",
    cwd: "/work",
    modes: null as unknown,
    models: null as unknown,
    configOptions: [{ id: "llm", currentValue: "a" }] as unknown,
    availableCommands: [{ name: "review", description: "Review" }],
    initResponse: { agentCapabilities: { promptCapabilities } }
  }
  const notify = vi.fn(async () => {})
  const sessions = {
    activeId: "s1" as string | null,
    getActiveSessionId: vi.fn(() => sessions.activeId),
    getActiveSession: vi.fn(() => (sessions.activeId === session.sessionId ? session : undefined)),
    getSession: vi.fn((id: string) => (id === session.sessionId ? session : undefined)),
    getActiveAgentName: vi.fn(() => "Claude"),
    getResponseMetadata: vi.fn(() => [{ modelName: "opus" }]),
    getConnectionForSession: vi.fn(() => ({ agent: { notify } })),
    recordResponseMetadata: vi.fn(),
    applyAvailableCommands: vi.fn(),
    applyConfigOptions: vi.fn(),
    applySessionInfoUpdate: vi.fn(),
    sendPrompt: vi.fn(
      async (
        _sessionId: string,
        _text: string,
        _attachments: ContentBlock[]
      ): Promise<PromptResponse> => ({
        stopReason: "end_turn",
        usage: { totalTokens: 9, inputTokens: 6, outputTokens: 3 }
      })
    ),
    recordFirstPrompt: vi.fn(),
    touchHistory: vi.fn(),
    cancelTurn: vi.fn(async () => {}),
    setMode: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setConfigOption: vi.fn(async () => [{ id: "llm", currentValue: "b" }] as unknown)
  }

  const extensionUri = FakeUri.file("/ext")
  const provider = new ChatWebviewProvider(extensionUri, sessions as any, updates)
  let receive: (message: unknown) => Promise<void> = async () => {}
  const webview = {
    options: {} as Record<string, unknown>,
    html: "",
    cspSource: "vscode-webview-resource:",
    asWebviewUri: vi.fn((uri: FakeUri) => uri.with({ scheme: "vscode-webview-resource" })),
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((handler: typeof receive) => {
      receive = handler
      return { dispose() {} }
    })
  }
  const view = { webview, show: vi.fn(), onDidDispose: fakeEvent() }
  provider.resolveWebviewView(view as any, {} as any, {} as any)

  const posted = (type?: string) =>
    webview.postMessage.mock.calls.map(([message]) => message).filter(m => !type || m.type === type)
  const update = (sessionId: string, body: Record<string, unknown>) =>
    updates.handleUpdate({ sessionId, update: body } as unknown as SessionNotification)

  return {
    provider,
    session,
    sessions,
    notify,
    updates,
    extensionUri,
    webview,
    view,
    /** Deliver a message from the webview and wait for the host to finish handling it */
    send: (message: Record<string, unknown>) => receive(message),
    posted,
    last: (type: string) => posted(type).at(-1),
    update
  }
}

interface FakeSelection {
  start: [number, number]
  end: [number, number]
}

/** A text editor over `lines`, optionally with a selection */
export function fakeEditor(uri: FakeUri, lines: string[], selection?: FakeSelection) {
  const [start, end] = selection
    ? [selection.start, selection.end]
    : [
        [0, 0],
        [0, 0]
      ]
  return {
    document: {
      uri,
      isClosed: false,
      lineAt: (line: number) => ({ text: lines[line] ?? "" }),
      getText: (range?: { start: { line: number }; end: { line: number } }) =>
        range ? lines.slice(range.start.line, range.end.line + 1).join("\n") : lines.join("\n")
    },
    selection: {
      isEmpty: start[0] === end[0] && start[1] === end[1],
      start: { line: start[0], character: start[1] },
      end: { line: end[0], character: end[1] }
    }
  }
}

/** Make `editor` the active one and tell the provider about it */
export function activate(editor: ReturnType<typeof fakeEditor> | undefined) {
  vscodeFake.window.activeTextEditor = editor
  vscodeFake.window.onDidChangeActiveTextEditor.fire(editor)
}
