import { vscodeFake, resetVscodeFake, FakeUri, FakeWorkspaceEdit } from "../testing/vscodeFake"
import { FileSystemHandler } from "./FileSystemHandler"
import { recordAbapEdit } from "../../editReview"
import { serializeObjectWrite } from "../../objectWriteQueue"
import { logError } from "../utils/Logger"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../../../adt/conections", () => ({ ADTSCHEME: "adt" }))
vi.mock("../utils/Logger", () => ({ log: vi.fn(), logError: vi.fn() }))
vi.mock("../../editReview", () => ({ recordAbapEdit: vi.fn() }))
vi.mock("../../objectWriteQueue", () => ({
  serializeObjectWrite: vi.fn((_uri: unknown, write: () => Promise<void>) => write())
}))
vi.mock("../fs/AbapPathMapper", async () => {
  const { FakeUri: Uri } = await import("../testing/vscodeFake")
  return { toVscodeUri: (p: string) => (p.startsWith("adt://") ? Uri.parse(p) : Uri.file(p)) }
})

const LOCAL = "/work/notes.txt"
const ABAP = "adt://dev100/sap/bc/adt/programs/programs/zdemo/zdemo.prog.abap"
/** Read at call time: resetVscodeFake replaces the fakes */
const fs = () => vscodeFake.workspace.fs

function onDisk(text: string) {
  fs().readFile.mockResolvedValue(new Uint8Array(Buffer.from(text, "utf-8")))
}
function openDocument(path: string, text: string, isDirty = false) {
  const doc = {
    uri: path.startsWith("adt://") ? FakeUri.parse(path) : FakeUri.file(path),
    isDirty,
    getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
    save: vi.fn(async () => true)
  }
  vscodeFake.workspace.textDocuments.push(doc)
  return doc
}
const written = () => {
  const [uri, data] = fs().writeFile.mock.lastCall!
  expect(Buffer.isBuffer(data)).toBe(true)
  return { uri: uri.toString(), text: data.toString("utf-8") }
}

describe("FileSystemHandler.readTextFile", () => {
  const handler = new FileSystemHandler()
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("reads through the VS Code file system and hands the agent LF line endings", async () => {
    onDisk("a\r\nb\r\nc")
    expect(await handler.readTextFile({ sessionId: "s", path: ABAP })).toEqual({
      content: "a\nb\nc"
    })
    expect(fs().readFile.mock.lastCall![0].toString()).toBe(ABAP)
  })

  it("prefers unsaved editor content over the stored file", async () => {
    onDisk("stored")
    openDocument(LOCAL, "unsaved\r\nedit", true)
    expect((await handler.readTextFile({ sessionId: "s", path: LOCAL })).content).toBe(
      "unsaved\nedit"
    )
    expect(fs().readFile).not.toHaveBeenCalled()
  })

  it.each([
    [{ line: 2, limit: 2 }, "2\n3"],
    [{ line: 4 }, "4\n5"],
    [{ limit: 1 }, "1"],
    [{ line: null, limit: null }, "1\n2\n3\n4\n5"]
  ])("returns the window %j", async (window, expected) => {
    onDisk("1\n2\n3\n4\n5")
    const result = await handler.readTextFile({ sessionId: "s", path: LOCAL, ...window })
    expect(result.content).toBe(expected)
  })

  it("logs and rethrows read failures", async () => {
    const failure = new Error("not found")
    fs().readFile.mockRejectedValue(failure)
    await expect(handler.readTextFile({ sessionId: "s", path: LOCAL })).rejects.toBe(failure)
    expect(logError).toHaveBeenCalledWith(`readTextFile failed: ${LOCAL}`, failure)
  })
})

describe("FileSystemHandler.writeTextFile", () => {
  const handler = new FileSystemHandler()
  beforeEach(() => {
    resetVscodeFake()
    vi.clearAllMocks()
  })

  it("writes local files as UTF-8 and shows them without stealing focus", async () => {
    fs().readFile.mockRejectedValue(new Error("new file"))
    expect(
      await handler.writeTextFile({ sessionId: "s", path: LOCAL, content: "Grüße\n" })
    ).toEqual({})
    expect(written()).toEqual({ uri: FakeUri.file(LOCAL).toString(), text: "Grüße\n" })
    expect(serializeObjectWrite).not.toHaveBeenCalled()
    expect(recordAbapEdit).not.toHaveBeenCalled()
    const doc = await vscodeFake.workspace.openTextDocument.mock.results[0].value
    expect(vscodeFake.window.showTextDocument).toHaveBeenCalledWith(doc, {
      preview: true,
      preserveFocus: true
    })
  })

  it("restores the file's CRLF line endings", async () => {
    onDisk("old\r\nfile")
    await handler.writeTextFile({ sessionId: "s", path: LOCAL, content: "new\ncontent" })
    expect(written().text).toBe("new\r\ncontent")
  })

  it("queues ABAP writes and records them for edit review", async () => {
    onDisk("REPORT zdemo.\r\n")
    await handler.writeTextFile({
      sessionId: "s",
      path: ABAP,
      content: "REPORT zdemo.\nWRITE 1.\n"
    })
    expect(vi.mocked(serializeObjectWrite).mock.lastCall![0].toString()).toBe(ABAP)
    expect(written()).toEqual({ uri: ABAP, text: "REPORT zdemo.\r\nWRITE 1.\r\n" })
    const [uri, before, after] = vi.mocked(recordAbapEdit).mock.lastCall!
    expect([uri.toString(), before, after]).toEqual([
      ABAP,
      "REPORT zdemo.\r\n",
      "REPORT zdemo.\r\nWRITE 1.\r\n"
    ])
  })

  it("does not record a review entry for a brand-new ABAP source", async () => {
    fs().readFile.mockRejectedValue(new Error("missing"))
    await handler.writeTextFile({ sessionId: "s", path: ABAP, content: "x" })
    expect(recordAbapEdit).not.toHaveBeenCalled()
  })

  it("edits and saves a dirty ABAP editor instead of overwriting it", async () => {
    const doc = openDocument(ABAP, "unsaved", true)
    await handler.writeTextFile({ sessionId: "s", path: ABAP, content: "agent" })
    expect(fs().writeFile).not.toHaveBeenCalled()
    const edit = vscodeFake.workspace.applyEdit.mock.lastCall![0] as FakeWorkspaceEdit
    expect(edit.replacements).toHaveLength(1)
    expect(edit.replacements[0].text).toBe("agent")
    expect(edit.replacements[0].range.end.character).toBe("unsaved".length)
    expect(doc.save).toHaveBeenCalled()
    expect(vi.mocked(recordAbapEdit).mock.lastCall!.slice(1)).toEqual(["unsaved", "agent"])
  })

  it("writes through the provider when the open ABAP editor has no unsaved changes", async () => {
    openDocument(ABAP, "clean", false)
    await handler.writeTextFile({ sessionId: "s", path: ABAP, content: "agent" })
    expect(written().text).toBe("agent")
    expect(vscodeFake.workspace.applyEdit).not.toHaveBeenCalled()
  })

  it.each([
    ["edit", () => vscodeFake.workspace.applyEdit.mockResolvedValue(false), "Unable to edit"],
    [
      "save",
      (doc: { save: ReturnType<typeof vi.fn> }) => doc.save.mockResolvedValue(false),
      "Unable to save"
    ]
  ])("reports a failed %s of the dirty editor", async (_step, fail, message) => {
    const doc = openDocument(ABAP, "unsaved", true)
    fail(doc)
    await expect(
      handler.writeTextFile({ sessionId: "s", path: ABAP, content: "x" })
    ).rejects.toThrow(`${message} ${ABAP}`)
    expect(logError).toHaveBeenCalled()
    expect(vscodeFake.window.showTextDocument).not.toHaveBeenCalled()
  })
})
