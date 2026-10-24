import * as path from "node:path"
import { resetVscodeFake, vscodeFake, FakeUri } from "../testing/vscodeFake"
import { createChatHarness, fakeEditor, activate } from "../testing/chatViewHarness"
import { logError } from "../utils/Logger"
import { sendEvent } from "../utils/TelemetryManager"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
// getHtmlContent() reads the real template file; serve it from disk (see ChatWebviewProvider.test.ts).
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

const fs = () => vscodeFake.workspace.fs // read at call time: resetVscodeFake() replaces this object
const toBase64 = (text: string) => Buffer.from(text, "utf-8").toString("base64")
const PNG = { name: "a.png", mimeType: "image/png", data: toBase64("fake-png"), size: 8 }

beforeEach(() => {
  resetVscodeFake()
  vi.clearAllMocks()
})

describe("ChatWebviewProvider: sending a prompt", () => {
  it("rejects a prompt without an active session", async () => {
    const { send, sessions, last } = createChatHarness()
    sessions.activeId = null
    await send({ type: "sendPrompt", text: "hi" })
    expect(last("error")).toEqual({
      type: "error",
      message: "No agent connected. Connect to an agent before sending a message."
    })
    expect(sessions.sendPrompt).not.toHaveBeenCalled()
  })

  it("rejects a prompt when the active session is no longer tracked", async () => {
    const { send, sessions, last } = createChatHarness()
    sessions.getSession.mockReturnValue(undefined)
    await send({ type: "sendPrompt", text: "hi" })
    expect(last("error")).toEqual({ type: "error", message: "The active session is unavailable." })
  })

  it("sends plain text, records telemetry, the first prompt and the response usage", async () => {
    const { send, sessions, posted } = createChatHarness()
    await send({ type: "sendPrompt", text: "Explain ZDEMO", responseIndex: 3 })
    expect(sendEvent).toHaveBeenCalledWith(
      "chat/messageSent",
      { agentName: "Claude" },
      { messageLength: "Explain ZDEMO".length }
    )
    expect(sessions.sendPrompt).toHaveBeenCalledWith("s1", "Explain ZDEMO", [])
    expect(sessions.recordFirstPrompt).toHaveBeenCalledWith("s1", "Explain ZDEMO")
    expect(sessions.touchHistory).toHaveBeenCalledWith("s1")
    expect(vscodeFake.commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "abapfs.acp.turnRunning",
      true
    )
    expect(vscodeFake.commands.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      "abapfs.acp.turnRunning",
      false
    )
    expect(posted("promptStart")).toEqual([
      { type: "promptStart", sessionId: "s1", responseIndex: 3 }
    ])
    expect(posted("promptEnd")).toEqual([
      {
        type: "promptEnd",
        stopReason: "end_turn",
        usage: { totalTokens: 9, inputTokens: 6, outputTokens: 3 }
      }
    ])
  })

  it("labels an attachment-only prompt and reports errors without the turn context stuck on", async () => {
    const { send, sessions, last } = createChatHarness()
    sessions.sendPrompt.mockRejectedValueOnce(new Error("agent exploded"))
    await send({ type: "sendPrompt", text: "" })
    expect(sessions.recordFirstPrompt).not.toHaveBeenCalled()
    expect(last("error")).toEqual({ type: "error", message: "agent exploded" })
    expect(last("promptEnd")).toEqual({ type: "promptEnd", stopReason: "error" })
    expect(logError).toHaveBeenCalledWith("Prompt failed", expect.any(Error))
    expect(vscodeFake.commands.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      "abapfs.acp.turnRunning",
      false
    )
  })

  it("falls back to a generic message for a non-Error rejection", async () => {
    const { send, sessions, last } = createChatHarness()
    sessions.sendPrompt.mockRejectedValueOnce({})
    await send({ type: "sendPrompt", text: "hi" })
    expect(last("error")).toEqual({ type: "error", message: "Prompt failed" })
  })

  it("sends an editor selection as an embedded resource when the agent supports it, then dismisses it", async () => {
    const { send, sessions, posted } = createChatHarness({ embeddedContext: true })
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(
      fakeEditor(uri, ["REPORT zdemo.", "WRITE 1.", "WRITE 2."], { start: [1, 0], end: [2, 8] })
    )
    await send({ type: "sendPrompt", text: "Explain" })
    const [, , attachments] = sessions.sendPrompt.mock.lastCall!
    expect(attachments).toEqual([
      {
        type: "resource",
        resource: {
          uri: "agent:file:///work/zdemo.prog.abap#L2-L3",
          mimeType: "text/plain",
          text: "WRITE 1.\nWRITE 2."
        }
      }
    ])
    expect(posted("attachmentsUpdate").at(-1)).toMatchObject({ selection: null })
  })

  it("sends a selection as fenced text when the agent lacks embedded-context support", async () => {
    const { send, sessions } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(fakeEditor(uri, ["REPORT zdemo."], { start: [0, 0], end: [0, 5] }))
    await send({ type: "sendPrompt", text: "Explain" })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment).toEqual({
      type: "text",
      text: "Selected lines 1-1 of agent:file:///work/zdemo.prog.abap:\n```\nREPORT zdemo.\n```"
    })
  })

  it("sends attached files as resource links, clearing them after the prompt", async () => {
    const { send, provider, sessions, posted } = createChatHarness()
    const uri = FakeUri.file("/work/report.abap")
    fs().stat.mockResolvedValue({ size: 42 })
    provider.attachFile(uri)
    const [{ id }] = posted("attachmentsUpdate").at(-1)!.attachments
    await send({ type: "sendPrompt", text: "Review", attachmentIds: [id] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment).toEqual({
      type: "resource_link",
      name: "report.abap",
      uri: "agent:file:///work/report.abap",
      mimeType: undefined, // .abap has no registered MIME type in ChatWebviewProvider
      size: 42
    })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toEqual([])
  })

  it("inlines an image attachment under the size budget when the agent supports images", async () => {
    const { send, provider, sessions } = createChatHarness({ image: true })
    const uri = FakeUri.file("/work/screenshot.png")
    fs().stat.mockResolvedValue({ size: 10 })
    fs().readFile.mockResolvedValue(new Uint8Array(Buffer.from("fake-png")))
    provider.attachFile(uri)
    await send({ type: "sendPrompt", text: "What is this?", attachmentIds: [uri.toString()] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment).toEqual({
      type: "image",
      data: toBase64("fake-png"),
      mimeType: "image/png",
      uri: "agent:file:///work/screenshot.png"
    })
  })

  it("falls back to a resource link for an oversized image", async () => {
    const { send, provider, sessions } = createChatHarness({ image: true })
    const uri = FakeUri.file("/work/screenshot.png")
    fs().stat.mockResolvedValue({ size: 6 * 1024 * 1024 })
    provider.attachFile(uri)
    await send({ type: "sendPrompt", text: "What is this?", attachmentIds: [uri.toString()] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment.type).toBe("resource_link")
    expect(fs().readFile).not.toHaveBeenCalled()
  })

  it("inlines the content of an open editor instead of re-reading disk", async () => {
    const { send, provider, sessions } = createChatHarness({ embeddedContext: true })
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    fs().stat.mockResolvedValue({ size: 100 })
    vscodeFake.workspace.textDocuments.push({ uri, getText: () => "REPORT zdemo." })
    provider.attachFile(uri)
    await send({ type: "sendPrompt", text: "Explain", attachmentIds: [uri.toString()] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment).toMatchObject({
      type: "resource",
      resource: { text: "REPORT zdemo.", mimeType: "text/plain" } // .abap has no registered MIME type
    })
    expect(fs().readFile).not.toHaveBeenCalled()
  })

  it("keeps binary files as resource links even when embedded context is supported", async () => {
    const { send, provider, sessions } = createChatHarness({ embeddedContext: true })
    const uri = FakeUri.file("/work/image.bin")
    fs().stat.mockResolvedValue({ size: 10 })
    fs().readFile.mockResolvedValue(new Uint8Array([0, 1, 2, 0]))
    provider.attachFile(uri)
    await send({ type: "sendPrompt", text: "x", attachmentIds: [uri.toString()] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment.type).toBe("resource_link")
  })

  it("ignores unknown attachment ids and caps attachments at ten", async () => {
    const { send, sessions } = createChatHarness()
    await send({
      type: "sendPrompt",
      text: "x",
      attachmentIds: ["missing", ...Array.from({ length: 12 }, (_, i) => `id${i}`)]
    })
    expect(sessions.sendPrompt).toHaveBeenCalledWith("s1", "x", [])
  })
})

describe("ChatWebviewProvider: pasted attachments", () => {
  it("accepts a valid pasted image and reports it as an attachment", async () => {
    const { send, posted } = createChatHarness({ image: true })
    await send({ type: "pasteAttachments", files: [PNG] })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toEqual([
      { id: expect.stringMatching(/^pasted-/), name: "a.png" }
    ])
  })

  it("rejects a mimetype the agent does not support", async () => {
    const { send } = createChatHarness({ image: false })
    await send({ type: "pasteAttachments", files: [PNG] })
    expect(vscodeFake.window.showWarningMessage).toHaveBeenCalledWith(
      "This pasted file type is not supported by the connected agent."
    )
  })

  it("accepts text files by extension even with a generic mime type", async () => {
    const { send, posted } = createChatHarness()
    await send({
      type: "pasteAttachments",
      files: [
        {
          name: "note.abap",
          mimeType: "application/octet-stream",
          data: toBase64("REPORT."),
          size: 7
        }
      ]
    })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toHaveLength(1)
  })

  it("rejects malformed, oversized or mismatched entries silently", async () => {
    const { send, posted } = createChatHarness()
    await send({
      type: "pasteAttachments",
      files: [
        null,
        { name: "x.txt", mimeType: "text/plain", data: "not base64!!", size: 1 },
        { name: "x.txt", mimeType: "text/plain", data: toBase64("hi"), size: 999 },
        { name: "x.txt", mimeType: "text/plain", data: toBase64("hi"), size: -1 },
        {
          name: "x.txt",
          mimeType: "text/plain",
          data: toBase64("x".repeat(8 * 1024 * 1024)),
          size: 8 * 1024 * 1024
        }
      ]
    })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toEqual([])
  })

  it("stops at ten pending attachments", async () => {
    const { send } = createChatHarness()
    const files = Array.from({ length: 11 }, (_, i) => ({
      name: `f${i}.txt`,
      mimeType: "text/plain",
      data: toBase64("x"),
      size: 1
    }))
    await send({ type: "pasteAttachments", files })
    expect(vscodeFake.window.showWarningMessage).toHaveBeenCalledWith(
      "Attach up to 10 files per prompt."
    )
  })

  it("ignores a non-array payload", async () => {
    const { send, posted } = createChatHarness()
    await send({ type: "pasteAttachments", files: "nope" })
    expect(posted("attachmentsUpdate")).toEqual([])
  })

  it("forwards a paste-error message as a warning", async () => {
    const { send } = createChatHarness()
    await send({ type: "pasteError", message: "File too big" })
    expect(vscodeFake.window.showWarningMessage).toHaveBeenCalledWith("File too big")
  })

  it("sends a pasted text file inline, decoded from base64", async () => {
    const { send, posted, sessions } = createChatHarness()
    const file = {
      name: "note.txt",
      mimeType: "text/plain",
      data: toBase64("Hello ABAP"),
      size: 10
    }
    await send({ type: "pasteAttachments", files: [file] })
    const { id } = posted("attachmentsUpdate").at(-1)!.attachments[0]
    await send({ type: "sendPrompt", text: "Review", attachmentIds: [id] })
    const [, , [attachment]] = sessions.sendPrompt.mock.lastCall!
    expect(attachment).toEqual({ type: "text", text: "Pasted file note.txt:\nHello ABAP" })
  })

  it("inlines a pasted image and audio file when the agent supports them", async () => {
    const { send, posted, sessions } = createChatHarness({ image: true, audio: true })
    const audio = { name: "clip.wav", mimeType: "audio/wav", data: toBase64("fake-wav"), size: 8 }
    await send({ type: "pasteAttachments", files: [PNG, audio] })
    const ids = posted("attachmentsUpdate")
      .at(-1)!
      .attachments.map((a: { id: string }) => a.id)
    await send({ type: "sendPrompt", text: "x", attachmentIds: ids })
    const [, , attachments] = sessions.sendPrompt.mock.lastCall!
    expect(attachments).toEqual([
      { type: "image", data: PNG.data, mimeType: "image/png" },
      { type: "audio", data: audio.data, mimeType: "audio/wav" }
    ])
  })

  it("rejects a pasted attachment that no longer fits the remaining inline budget", async () => {
    const { send, posted } = createChatHarness()
    const chunk = (name: string) => {
      const size = 4 * 1024 * 1024 // under the 5 MB per-file cap; three together exceed the 10 MB prompt budget
      return { name, mimeType: "text/plain", data: toBase64("x".repeat(size)), size }
    }
    const files = [chunk("a.txt"), chunk("b.txt"), chunk("c.txt")]
    await send({ type: "pasteAttachments", files })
    const ids = posted("attachmentsUpdate")
      .at(-1)!
      .attachments.map((a: { id: string }) => a.id)
    await send({ type: "sendPrompt", text: "x", attachmentIds: ids })
    expect(logError).toHaveBeenCalledWith("Prompt failed", expect.any(Error))
  })
})

describe("ChatWebviewProvider: editor and attachment tracking", () => {
  it("suggests the active editor's file as a one-click attachment", () => {
    const { posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(fakeEditor(uri, ["REPORT zdemo."]))
    expect(posted("attachmentsUpdate").at(-1)).toMatchObject({
      currentFile: { name: "zdemo.prog.abap" },
      selection: null
    })
  })

  it("does not suggest a file that is already attached or not attachable", () => {
    const { provider, posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    provider.attachFile(uri)
    activate(fakeEditor(uri, ["x"]))
    expect(posted("attachmentsUpdate").at(-1)!.currentFile).toBeNull()
    activate(fakeEditor(FakeUri.parse("untitled:Untitled-1"), ["x"]))
    expect(posted("attachmentsUpdate").at(-1)!.currentFile).toBeNull()
  })

  it("keeps the last attachable editor when focus moves elsewhere, but not when it closes", () => {
    const { posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    const editor = fakeEditor(uri, ["x"])
    activate(editor)
    activate(undefined)
    expect(posted("attachmentsUpdate").at(-1)!.currentFile).toMatchObject({
      name: "zdemo.prog.abap"
    })
    editor.document.isClosed = true
    activate(undefined)
    expect(posted("attachmentsUpdate").at(-1)!.currentFile).toBeNull()
  })

  it("shows and later dismisses a non-empty selection, remembering the dismissal by range", async () => {
    const { send, posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(fakeEditor(uri, ["a", "b"], { start: [0, 0], end: [1, 1] }))
    expect(posted("attachmentsUpdate").at(-1)!.selection).toEqual({ name: "zdemo.prog.abap:1-2" })
    await send({ type: "dismissSelection" })
    expect(posted("attachmentsUpdate").at(-1)!.selection).toBeNull()
  })

  it("treats a selection ending at column 0 as not including that line", () => {
    const { posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(fakeEditor(uri, ["a", "b", "c"], { start: [0, 0], end: [2, 0] }))
    expect(posted("attachmentsUpdate").at(-1)!.selection).toEqual({ name: "zdemo.prog.abap:1-2" })
  })

  it("attaches the current file on request", async () => {
    const { send, posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    activate(fakeEditor(uri, ["x"]))
    await send({ type: "attachCurrentFile" })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toEqual([
      { id: uri.toString(), name: "zdemo.prog.abap" }
    ])
  })

  it("does nothing attaching the current file when there is none", async () => {
    const { send, posted } = createChatHarness()
    const before = posted("attachmentsUpdate").length
    await send({ type: "attachCurrentFile" })
    expect(posted("attachmentsUpdate")).toHaveLength(before)
  })

  it("removes a pending attachment on request", async () => {
    const { send, provider, posted } = createChatHarness()
    const uri = FakeUri.file("/work/zdemo.prog.abap")
    provider.attachFile(uri)
    await send({ type: "removeAttachment", id: uri.toString() })
    expect(posted("attachmentsUpdate").at(-1)!.attachments).toEqual([])
  })

  it("caps manual attach-file at ten and reveals the chat view", () => {
    const { provider, view } = createChatHarness()
    for (let i = 0; i < 11; i++) provider.attachFile(FakeUri.file(`/work/f${i}.txt`))
    expect(vscodeFake.window.showWarningMessage).toHaveBeenCalledWith(
      "Attach up to 10 files per prompt."
    )
    expect(view.show).toHaveBeenCalledWith(true)
  })
})

describe("ChatWebviewProvider: markdown rendering and misc messages", () => {
  it("renders markdown for history items in one batch", async () => {
    const { send, last } = createChatHarness()
    await send({
      type: "renderMarkdown",
      items: [
        { index: 0, text: "**bold**" },
        { index: 5, text: "plain text" }
      ]
    })
    const { items } = last("markdownRendered")
    expect(items[0]).toEqual({ index: 0, html: expect.stringContaining("<strong>bold</strong>") })
    expect(items[1]).toEqual({ index: 5, html: expect.stringContaining("plain text") })
  })

  it("executes a command requested by the webview", async () => {
    const { send } = createChatHarness()
    await send({ type: "executeCommand", command: "abapfs.acp.showLog" })
    expect(vscodeFake.commands.executeCommand).toHaveBeenCalledWith("abapfs.acp.showLog")
  })

  it("ignores an executeCommand message without a command", async () => {
    const { send } = createChatHarness()
    await send({ type: "executeCommand" })
    expect(vscodeFake.commands.executeCommand).not.toHaveBeenCalled()
  })

  it("persists response metadata for a well-formed message only", async () => {
    const { send, sessions } = createChatHarness()
    await send({
      type: "recordResponseMetadata",
      sessionId: "s1",
      responseIndex: 2,
      metadata: { modelName: "opus" }
    })
    await send({ type: "recordResponseMetadata", sessionId: 1, responseIndex: 2, metadata: {} })
    await send({
      type: "recordResponseMetadata",
      sessionId: "s1",
      responseIndex: "two",
      metadata: {}
    })
    expect(sessions.recordResponseMetadata).toHaveBeenCalledTimes(1)
    expect(sessions.recordResponseMetadata).toHaveBeenCalledWith("s1", 2, { modelName: "opus" })
  })

  it("disposes without throwing", () => {
    const { provider } = createChatHarness()
    expect(() => provider.dispose()).not.toThrow()
  })
})
