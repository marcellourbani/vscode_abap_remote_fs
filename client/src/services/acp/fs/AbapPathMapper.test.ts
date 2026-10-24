import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { vscodeFake, resetVscodeFake, FakeUri } from "../testing/vscodeFake"
import {
  abapWorkspaceHint,
  adtMountRoot,
  agentWorkspaceRoot,
  initAgentRoot,
  isLocalPath,
  toAgentPath,
  toAgentUri,
  toVscodeUri
} from "./AbapPathMapper"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)
vi.mock("../../../adt/conections", () => ({ ADTSCHEME: "adt" }))

const storage = mkdtempSync(path.join(tmpdir(), "acp-mapper-"))
const objectPath = "/sap/bc/adt/programs/programs/zdemo/zdemo.prog.abap"
const adtUri = (authority = "dev100", uriPath = objectPath) =>
  FakeUri.from({ scheme: "adt", authority, path: uriPath })
const mounted = (...segments: string[]) => path.join(adtMountRoot(), ...segments)

describe("AbapPathMapper before initialisation", () => {
  it("leaves every URI untouched", async () => {
    vi.resetModules()
    const fresh = await import("./AbapPathMapper")
    expect(fresh.toAgentPath(adtUri())).toBe("adt://dev100" + objectPath)
    expect(fresh.toAgentUri(adtUri())).toBe("adt://dev100" + objectPath)
    expect(fresh.toVscodeUri(path.resolve("anything.txt")).scheme).toBe("file")
  })
})

describe("AbapPathMapper", () => {
  beforeAll(() => initAgentRoot(storage))
  beforeEach(() => resetVscodeFake())
  afterAll(() => rmSync(storage, { recursive: true, force: true }))

  it("creates the mount folder under the extension storage", () => {
    expect(agentWorkspaceRoot()).toBe(path.join(storage, "acp-workspace"))
    expect(adtMountRoot()).toBe(path.join(storage, "acp-workspace", "adt"))
    expect(existsSync(adtMountRoot())).toBe(true)
  })

  it("exposes an ABAP object as a local path below its system folder", () => {
    expect(toAgentPath(adtUri())).toBe(
      mounted("dev100", "sap", "bc", "adt", "programs", "programs", "zdemo", "zdemo.prog.abap")
    )
  })

  it("maps agent paths in the mount back to the ABAP FS URI", () => {
    const uri = toVscodeUri(mounted("dev100", ...objectPath.split("/").filter(Boolean)))
    expect(uri.scheme).toBe("adt")
    expect(uri.authority).toBe("dev100")
    expect(uri.path).toBe(objectPath)
  })

  it("round-trips URIs through the agent path", () => {
    for (const uri of [
      adtUri(),
      adtUri("qas200", "/sap/bc/adt/oo/classes/zcl_a/zcl_a.clas.abap")
    ]) {
      expect(toVscodeUri(toAgentPath(uri)).toString()).toBe(uri.toString())
    }
  })

  it("accepts file:// URIs and adt:// URIs from agents", () => {
    const fileUrl = FakeUri.file(mounted("dev100", "sap", "x.abap")).toString()
    expect(toVscodeUri(fileUrl).toString()).toBe("adt://dev100/sap/x.abap")
    expect(toVscodeUri("adt://dev100/sap/y.abap").toString()).toBe("adt://dev100/sap/y.abap")
  })

  it("keeps paths outside the mount on the local disk", () => {
    const outside = path.join(storage, "elsewhere", "notes.md")
    expect(toVscodeUri(outside).toString()).toBe(FakeUri.file(outside).toString())
    expect(isLocalPath(outside)).toBe(true)
    expect(isLocalPath(mounted("dev100", "a.abap"))).toBe(false)
  })

  it("does not treat a sibling folder sharing the prefix as the mount", () => {
    const sibling = adtMountRoot() + "-backup" + path.sep + "a.abap"
    expect(toVscodeUri(sibling).scheme).toBe("file")
  })

  it("normalises relative segments before deciding", () => {
    const sneaky = path.join(adtMountRoot(), "dev100", "..", "..", "outside.txt")
    expect(toVscodeUri(sneaky).scheme).toBe("file")
    const inside = path.join(adtMountRoot(), "dev100", "sap", "..", "sap", "z.abap")
    expect(toVscodeUri(inside).toString()).toBe("adt://dev100/sap/z.abap")
  })

  it.runIf(process.platform === "win32")("ignores drive and folder case on Windows", () => {
    const upper = mounted("dev100", "sap", "z.abap").toUpperCase()
    expect(toVscodeUri(upper).scheme).toBe("adt")
  })

  it("passes other schemes through as URI strings", () => {
    const untitled = FakeUri.parse("untitled:Untitled-1")
    expect(toAgentPath(untitled)).toBe("untitled:Untitled-1")
    expect(toAgentUri(untitled)).toBe("untitled:Untitled-1")
    const local = FakeUri.file(path.join(storage, "a.txt"))
    expect(toAgentPath(local)).toBe(local.fsPath)
  })

  it("turns ABAP URIs into file URIs for prompt resources", () => {
    expect(toAgentUri(adtUri())).toBe(FakeUri.file(toAgentPath(adtUri())).toString())
  })

  describe("workspace hint", () => {
    const folder = (name: string, uri: FakeUri) => ({ name, uri })

    it("is empty without SAP systems in the workspace", () => {
      expect(abapWorkspaceHint()).toBe("")
      vscodeFake.workspace.workspaceFolders = [folder("local", FakeUri.file(storage))]
      expect(abapWorkspaceHint()).toBe("")
    })

    it("lists every system folder with its local path and how to use it", () => {
      vscodeFake.workspace.workspaceFolders = [
        folder("DEV100(ABAP)", adtUri("dev100", "/")),
        folder("local", FakeUri.file(storage)),
        folder("QAS200(ABAP)", adtUri("qas200", "/"))
      ]
      const hint = abapWorkspaceHint()
      expect(hint.startsWith("[ABAP FS context]")).toBe(true)
      expect(hint).toContain(`- DEV100(ABAP): ${mounted("dev100")}`)
      expect(hint).toContain(`- QAS200(ABAP): ${mounted("qas200")}`)
      expect(hint).not.toContain("- local")
      expect(hint).toContain("do NOT exist on the local disk")
      expect(hint).toContain("replace_string_in_abap_object")
      expect(hint).toContain("abapfs_activate_object")
    })

    it("does not suggest the edit tool when the MCP server hides it", () => {
      vscodeFake.workspace.workspaceFolders = [folder("DEV100(ABAP)", adtUri("dev100", "/"))]
      vscodeFake.settings.set("abapfs.mcpServer.exposeEditTool", false)
      const hint = abapWorkspaceHint()
      expect(hint).not.toContain("replace_string_in_abap_object")
      expect(hint).toContain("To edit ABAP sources use your file edit tools on these paths.")
    })
  })
})
