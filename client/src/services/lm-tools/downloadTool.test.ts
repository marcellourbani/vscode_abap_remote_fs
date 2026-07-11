// Tests for services/lm-tools/downloadTool.ts

jest.mock(
  "vscode",
  () => {
    class Uri {
      constructor(
        public scheme: string,
        public authority: string,
        public path: string,
        public fsPath: string = path
      ) {}
      static parse(s: string) {
        const m = /^([a-z]+):\/\/([^\/]*)(\/.*)?$/i.exec(s)
        if (m) return new Uri(m[1], m[2], m[3] ?? "/", m[3] ?? "/")
        return new Uri("file", "", s, s)
      }
      static file(p: string) {
        return new Uri("file", "", p.replace(/\\/g, "/"), p)
      }
      static joinPath(base: Uri, ...segs: string[]) {
        const joined = base.path.replace(/\/$/, "") + "/" + segs.join("/")
        return new Uri(base.scheme, base.authority, joined, joined)
      }
      toString() {
        return `${this.scheme}://${this.authority}${this.path}`
      }
    }

    class CancellationTokenSource {
      private handlers: Array<() => void> = []
      token = {
        isCancellationRequested: false,
        onCancellationRequested: (fn: () => void) => {
          this.handlers.push(fn)
          return { dispose: () => {} }
        }
      }
      cancel() {
        this.token.isCancellationRequested = true
        this.handlers.forEach(h => h())
      }
      dispose() {}
    }

    class CancellationError extends Error {
      constructor() {
        super("Canceled")
        this.name = "Canceled"
      }
    }

    return {
      Uri,
      CancellationTokenSource,
      CancellationError,
      FileType: { Unknown: 0, File: 1, Directory: 2 },
      ProgressLocation: { Notification: 15, Window: 10 },
      LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
      LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
      MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
      lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
      window: {
        withProgress: jest.fn(async (_opts: any, task: any) => {
          const progress = { report: jest.fn() }
          const progressToken = {
            isCancellationRequested: false,
            onCancellationRequested: (_fn: any) => ({ dispose: () => {} })
          }
          return await task(progress, progressToken)
        })
      },
      workspace: {
        fs: {
          stat: jest.fn(),
          readDirectory: jest.fn(),
          readFile: jest.fn(),
          writeFile: jest.fn(),
          createDirectory: jest.fn()
        }
      }
    }
  },
  { virtual: true }
)

jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: jest.fn()
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("../../adt/conections", () => ({ getOrCreateRoot: jest.fn() }))

import * as vscode from "vscode"
import { DownloadTool, registerDownloadTool } from "./downloadTool"
import { getOrCreateRoot } from "../../adt/conections"
import { getSearchService } from "../abapSearchService"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

const F = vscode.FileType.File
const D = vscode.FileType.Directory
const fs = vscode.workspace.fs as any

/**
 * Mount a fake FS. Keys are full source URI strings. Each entry says whether
 * it's a directory (with child names) or a file (with optional bytes).
 * `targetExists` toggles whether stat on a file:// URI succeeds.
 */
type Entry = { type: typeof D; children: string[] } | { type: typeof F; bytes?: Uint8Array }

function mountFs(entries: Record<string, Entry>, opts: { targetExists?: boolean } = {}) {
  fs.stat.mockImplementation(async (uri: vscode.Uri) => {
    if (uri.scheme === "file") {
      if (opts.targetExists) return { type: F, size: 1 }
      throw new Error("ENOENT")
    }
    const key = uri.toString()
    const e = entries[key]
    if (!e) throw new Error(`ENOENT: ${key}`)
    return { type: e.type, size: 0 }
  })
  fs.readDirectory.mockImplementation(async (uri: vscode.Uri) => {
    const key = uri.toString()
    const e = entries[key]
    if (!e || e.type !== D) throw new Error(`ENOTDIR: ${key}`)
    return e.children.map(name => {
      const child = entries[key + "/" + name]
      return [name, child ? child.type : F] as [string, vscode.FileType]
    })
  })
  fs.readFile.mockImplementation(async (uri: vscode.Uri) => {
    const key = uri.toString()
    const e = entries[key]
    if (!e || e.type !== F) throw new Error(`ENOENT: ${key}`)
    return e.bytes ?? new Uint8Array()
  })
  fs.writeFile.mockResolvedValue(undefined)
  fs.createDirectory.mockResolvedValue(undefined)
}

function makeInvokeOptions(input: any) {
  return { input, toolInvocationToken: undefined } as any
}

function makeToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as any
}

describe("DownloadTool", () => {
  let tool: DownloadTool

  beforeEach(() => {
    jest.clearAllMocks()
    ;(vscode.window.withProgress as jest.Mock).mockImplementation(async (_o: any, task: any) => {
      const progress = { report: jest.fn() }
      const progressToken = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} })
      }
      return await task(progress, progressToken)
    })
    tool = new DownloadTool()
  })

  describe("registerDownloadTool", () => {
    it("registers the tool with the registry", () => {
      const ctx = { subscriptions: [] as any[] } as any
      registerDownloadTool(ctx)
      expect(registerToolWithRegistry).toHaveBeenCalledWith("abap_download", expect.any(Object))
      expect(ctx.subscriptions.length).toBe(1)
    })
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with source and target", async () => {
      const r = await tool.prepareInvocation(
        makeInvokeOptions({ source: "ZFOO", target: "C:/tmp/z" }),
        makeToken()
      )
      expect(r.invocationMessage).toContain("ZFOO")
      expect(r.invocationMessage).toContain("C:/tmp/z")
      expect((r.confirmationMessages as any).title).toBe("Download ABAP Resource")
    })
  })

  describe("invoke — source resolution", () => {
    it("accepts full adt:// URIs directly", async () => {
      mountFs({ "adt://ged100/pkg": { type: F, bytes: new Uint8Array([1]) } })
      await tool.invoke(
        makeInvokeOptions({ source: "adt://ged100/pkg", target: "C:/out" }),
        makeToken()
      )
      expect(getOrCreateRoot).not.toHaveBeenCalled()
      expect(assertToolInvocationAuthorized).toHaveBeenCalled()
      expect(logTelemetry).toHaveBeenCalledWith(
        "tool_download_called",
        expect.objectContaining({ connectionId: "" })
      )
    })

    it("lowercases connectionId", async () => {
      mountFs({ "adt://ged100/pkg": { type: F } })
      const findByAdtUri = jest.fn().mockResolvedValue({ path: "/pkg" })
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({ findByAdtUri })
      await tool.invoke(
        makeInvokeOptions({
          source: "/sap/bc/adt/packages/zpkg",
          target: "C:/out",
          connectionId: "GED100"
        }),
        makeToken()
      )
      expect(getOrCreateRoot).toHaveBeenCalledWith("ged100")
    })

    it("resolves ADT paths via findByAdtUri with main=false", async () => {
      mountFs({ "adt://ged100/pkg": { type: F } })
      const findByAdtUri = jest.fn().mockResolvedValue({ path: "/pkg" })
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({ findByAdtUri })
      await tool.invoke(
        makeInvokeOptions({
          source: "/sap/bc/adt/packages/zpkg",
          target: "C:/out",
          connectionId: "ged100"
        }),
        makeToken()
      )
      expect(findByAdtUri).toHaveBeenCalledWith("/sap/bc/adt/packages/zpkg", false)
    })

    it("resolves bare object names via searchObjects then findByAdtUri", async () => {
      mountFs({ "adt://ged100/zfoo": { type: F } })
      const searcher = {
        searchObjects: jest.fn().mockResolvedValue([{ name: "ZFOO", uri: "/sap/bc/adt/x" }])
      }
      ;(getSearchService as jest.Mock).mockReturnValue(searcher)
      const findByAdtUri = jest.fn().mockResolvedValue({ path: "/zfoo" })
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({ findByAdtUri })
      await tool.invoke(
        makeInvokeOptions({
          source: "ZFOO",
          target: "C:/out",
          connectionId: "ged100",
          objectType: "PROG/P"
        }),
        makeToken()
      )
      expect(searcher.searchObjects).toHaveBeenCalledWith("ZFOO", ["PROG/P"], 5)
      expect(findByAdtUri).toHaveBeenCalledWith("/sap/bc/adt/x", false)
    })

    it("prefers exact case-insensitive match over first result", async () => {
      mountFs({ "adt://ged100/zfoo": { type: F } })
      const searcher = {
        searchObjects: jest.fn().mockResolvedValue([
          { name: "ZFOO_OTHER", uri: "/sap/bc/adt/other" },
          { name: "zfoo", uri: "/sap/bc/adt/right" }
        ])
      }
      ;(getSearchService as jest.Mock).mockReturnValue(searcher)
      const findByAdtUri = jest.fn().mockResolvedValue({ path: "/zfoo" })
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({ findByAdtUri })
      await tool.invoke(
        makeInvokeOptions({ source: "ZFOO", target: "C:/out", connectionId: "ged100" }),
        makeToken()
      )
      expect(findByAdtUri).toHaveBeenCalledWith("/sap/bc/adt/right", false)
    })

    it("throws when connectionId is missing for bare name", async () => {
      mountFs({})
      await expect(
        tool.invoke(makeInvokeOptions({ source: "ZFOO", target: "C:/out" }), makeToken())
      ).rejects.toThrow(/connectionId is required/)
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it("throws when search returns nothing", async () => {
      mountFs({})
      ;(getSearchService as jest.Mock).mockReturnValue({
        searchObjects: jest.fn().mockResolvedValue([])
      })
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({ findByAdtUri: jest.fn() })
      await expect(
        tool.invoke(
          makeInvokeOptions({ source: "ZNOPE", target: "C:/out", connectionId: "ged100" }),
          makeToken()
        )
      ).rejects.toThrow(/not found/)
    })

    it("rejects adt:// as target", async () => {
      mountFs({ "adt://c/pkg": { type: F } })
      await expect(
        tool.invoke(makeInvokeOptions({ source: "adt://c/pkg", target: "adt://x/y" }), makeToken())
      ).rejects.toThrow(/target must be a local path/)
    })
  })

  describe("invoke — copy behaviour", () => {
    it("copies a single file", async () => {
      mountFs({ "adt://c/leaf.abap": { type: F, bytes: new TextEncoder().encode("hi") } })
      const result: any = await tool.invoke(
        makeInvokeOptions({ source: "adt://c/leaf.abap", target: "C:/out.abap" }),
        makeToken()
      )
      expect(fs.readFile).toHaveBeenCalled()
      expect(fs.writeFile).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("Files: 1")
    })

    it("recurses into folders", async () => {
      mountFs({
        "adt://c/pkg": { type: D, children: ["a", "sub"] },
        "adt://c/pkg/a": { type: F, bytes: new TextEncoder().encode("A") },
        "adt://c/pkg/sub": { type: D, children: ["b", "c"] },
        "adt://c/pkg/sub/b": { type: F, bytes: new TextEncoder().encode("B") },
        "adt://c/pkg/sub/c": { type: F, bytes: new TextEncoder().encode("C") }
      })
      const result: any = await tool.invoke(
        makeInvokeOptions({ source: "adt://c/pkg", target: "C:/out" }),
        makeToken()
      )
      expect(fs.createDirectory).toHaveBeenCalled()
      expect(fs.writeFile).toHaveBeenCalledTimes(3)
      expect(result.parts[0].text).toContain("Files: 3")
      expect(result.parts[0].text).toContain("Folders: 2")
    })

    it("tolerates per-file readFile failures", async () => {
      mountFs({
        "adt://c/pkg": { type: D, children: ["good", "bad"] },
        "adt://c/pkg/good": { type: F, bytes: new TextEncoder().encode("ok") },
        "adt://c/pkg/bad": { type: F, bytes: new TextEncoder().encode("x") }
      })
      const realRead = fs.readFile.getMockImplementation()!
      fs.readFile.mockImplementation(async (uri: vscode.Uri) => {
        if (uri.path.endsWith("/bad")) throw new Error("Unavailable")
        return realRead(uri)
      })
      const result: any = await tool.invoke(
        makeInvokeOptions({ source: "adt://c/pkg", target: "C:/out" }),
        makeToken()
      )
      expect(result.parts[0].text).toContain("Files: 1")
      expect(result.parts[0].text).toContain("Failed: 1")
      expect(result.parts[0].text).toContain("Unavailable")
    })

    it("skips existing files when overwrite=false (default)", async () => {
      mountFs(
        {
          "adt://c/pkg": { type: D, children: ["leaf"] },
          "adt://c/pkg/leaf": { type: F, bytes: new TextEncoder().encode("hi") }
        },
        { targetExists: true }
      )
      const result: any = await tool.invoke(
        makeInvokeOptions({ source: "adt://c/pkg", target: "C:/out", overwrite: false }),
        makeToken()
      )
      expect(fs.writeFile).not.toHaveBeenCalled()
      expect(result.parts[0].text).toContain("Skipped: 1")
    })

    it("overwrites when overwrite=true", async () => {
      mountFs(
        {
          "adt://c/pkg": { type: D, children: ["leaf"] },
          "adt://c/pkg/leaf": { type: F, bytes: new TextEncoder().encode("hi") }
        },
        { targetExists: true }
      )
      const result: any = await tool.invoke(
        makeInvokeOptions({ source: "adt://c/pkg", target: "C:/out", overwrite: true }),
        makeToken()
      )
      expect(fs.writeFile).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("Files: 1")
    })
  })

  describe("invoke — cancellation", () => {
    it("throws CancellationError when the LM tool token is cancelled", async () => {
      mountFs({
        "adt://c/pkg": { type: D, children: ["a"] },
        "adt://c/pkg/a": { type: F, bytes: new Uint8Array([1]) }
      })
      // A token that is already cancelled: onCancellationRequested fires
      // immediately when subscribed, so the composed cts inside the tool
      // becomes cancelled before any real work runs.
      const cancelledToken: vscode.CancellationToken = {
        isCancellationRequested: true,
        onCancellationRequested: (fn: () => void) => {
          fn()
          return { dispose: () => {} }
        }
      } as any

      await expect(
        tool.invoke(makeInvokeOptions({ source: "adt://c/pkg", target: "C:/out" }), cancelledToken)
      ).rejects.toBeInstanceOf(vscode.CancellationError)
    })
  })
})
