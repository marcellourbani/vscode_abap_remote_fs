// Tests for fs/LocalFsProvider.ts
jest.mock("vscode", () => {
  const EventEmitter = class {
    event = jest.fn()
    fire = jest.fn()
  }
  const FileChangeType = { Created: 1, Changed: 2, Deleted: 3 }
  const FileType = { Unknown: 0, File: 1, Directory: 2 }
  const Disposable = class { constructor(public dispose: () => void) {} }
  const Uri = {
    joinPath: jest.fn((base: any, ...parts: string[]) => ({
      ...base,
      path: [base.path, ...parts].join("/"),
      toString: () => `${base.scheme}://${base.authority}${[base.path, ...parts].join("/")}`
    })),
    parse: jest.fn((s: string) => ({ path: s, scheme: "adt", authority: "host", toString: () => s }))
  }
  const RelativePattern = class { constructor(base: any, pattern: string) {} }
  const workspace = {
    fs: {
      stat: jest.fn(),
      readDirectory: jest.fn(),
      createDirectory: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      copy: jest.fn()
    },
    createFileSystemWatcher: jest.fn(() => ({
      onDidCreate: jest.fn(),
      onDidChange: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn()
    }))
  }
  return { EventEmitter, FileChangeType, FileType, Disposable, Uri, RelativePattern, workspace }
}, { virtual: true })

jest.mock("./localStorage", () => ({
  LocalStorage: jest.fn().mockImplementation(() => ({
    resolveUri: jest.fn(async (uri: any) => ({ ...uri, path: `/resolved${uri.path}` }))
  }))
}))

jest.mock("./initialtemplates", () => ({
  templates: [{ name: "abapgit.xml", content: "<x/>" }]
}))

jest.mock("../adt/conections", () => ({ ADTSCHEME: "adt" }))

jest.mock("../config", () => ({
  getConfig: jest.fn(() => ({
    get: jest.fn((key: string) => undefined)
  }))
}))

import { LocalFsProvider } from "./LocalFsProvider"
import * as vscode from "vscode"

const makeUri = (path: string, scheme = "adt", authority = "host") => ({
  path,
  scheme,
  authority,
  toString: () => `${scheme}://${authority}${path}`
} as any)

const makeContext = () => ({
  storageUri: makeUri("/storage", "file"),
  globalStorageUri: makeUri("/global-storage", "file"),
  subscriptions: [] as any[]
} as any)

describe("LocalFsProvider", () => {
  let provider: LocalFsProvider
  let context: any

  beforeEach(() => {
    jest.clearAllMocks()
    context = makeContext()
    provider = new LocalFsProvider(context)
  })

  describe("constructor", () => {
    it("creates instance with context", () => {
      expect(provider).toBeDefined()
    })

    it("uses globalStorageUri when preferGlobal is set", () => {
      const { getConfig } = require("../config")
      ;(getConfig as jest.Mock).mockReturnValue({ get: jest.fn(() => true) })
      const p = new LocalFsProvider(context)
      expect(p).toBeDefined()
    })
  })

  describe("useLocalStorage", () => {
    it("returns false for non-adt scheme", () => {
      const uri = makeUri("/test", "file")
      expect(LocalFsProvider.useLocalStorage(uri)).toBe(false)
    })

    it("returns true for adt scheme with template file path", () => {
      const uri = makeUri("/abapgit.xml", "adt")
      expect(LocalFsProvider.useLocalStorage(uri)).toBe(true)
    })

    it("returns true for dotfile paths", () => {
      const uri = makeUri("/.abaplint", "adt")
      expect(LocalFsProvider.useLocalStorage(uri)).toBe(true)
    })

    it("returns true for paths with dotfiles in subfolders", () => {
      const uri = makeUri("/folder/.hidden", "adt")
      expect(LocalFsProvider.useLocalStorage(uri)).toBe(true)
    })

    it("returns false for regular adt paths", () => {
      const uri = makeUri("/sap/bc/adt/programs/programs/myprog", "adt")
      expect(LocalFsProvider.useLocalStorage(uri)).toBe(false)
    })
  })

  describe("onDidChangeFile", () => {
    it("exposes the event emitter event", () => {
      expect(provider.onDidChangeFile).toBeDefined()
    })
  })

  describe("stat", () => {
    it("resolves URI and calls workspace.fs.stat", async () => {
      const mockStat = { type: 1, ctime: 0, mtime: 0, size: 100 }
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue(mockStat)

      const uri = makeUri("/file.txt")
      const result = await provider.stat(uri)

      expect(result).toEqual(mockStat)
      expect(vscode.workspace.fs.stat).toHaveBeenCalled()
    })
  })

  describe("readDirectory", () => {
    it("returns resolved directory contents", async () => {
      const entries: [string, number][] = [["file.txt", 1], ["subdir", 2]]
      ;(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue(entries)

      const uri = makeUri("/mydir")
      const result = await provider.readDirectory(uri)

      expect(result).toEqual(entries)
    })

    it("returns empty array on error", async () => {
      ;(vscode.workspace.fs.readDirectory as jest.Mock).mockRejectedValue(new Error("not found"))

      const uri = makeUri("/missingdir")
      const result = await provider.readDirectory(uri)

      expect(result).toEqual([])
    })
  })

  describe("readFile", () => {
    it("resolves URI and reads file content", async () => {
      const content = new Uint8Array([65, 66, 67])
      ;(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(content)

      const uri = makeUri("/myfile.abap")
      const result = await provider.readFile(uri)

      expect(result).toEqual(content)
      expect(vscode.workspace.fs.readFile).toHaveBeenCalled()
    })
  })

  describe("createDirectory", () => {
    it("creates directory via workspace.fs", async () => {
      ;(vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined)

      const uri = makeUri("/newdir")
      await provider.createDirectory(uri)

      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled()
    })
  })

  describe("writeFile", () => {
    it("writes content to resolved URI", async () => {
      ;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

      const uri = makeUri("/writeme.txt")
      const content = new Uint8Array([72, 105])
      await provider.writeFile(uri, content, {})

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled()
    })
  })

  describe("delete", () => {
    it("deletes resolved URI", async () => {
      ;(vscode.workspace.fs.delete as jest.Mock).mockResolvedValue(undefined)

      const uri = makeUri("/deleteme.txt")
      await provider.delete(uri, { recursive: false })

      expect(vscode.workspace.fs.delete).toHaveBeenCalled()
    })
  })

  describe("rename", () => {
    it("renames from old to new resolved URI", async () => {
      ;(vscode.workspace.fs.rename as jest.Mock).mockResolvedValue(undefined)

      const oldUri = makeUri("/old.txt")
      const newUri = makeUri("/new.txt")
      await provider.rename(oldUri, newUri, {})

      expect(vscode.workspace.fs.rename).toHaveBeenCalled()
    })
  })

  describe("watch", () => {
    it("returns a Disposable", () => {
      const { LocalStorage } = require("./localStorage")
      ;(LocalStorage as jest.Mock).mockImplementation(() => ({
        resolveUri: jest.fn().mockResolvedValue(makeUri("/resolved/path", "file"))
      }))
      const p = new LocalFsProvider(context)

      const uri = makeUri("/watch-path")
      const disposable = p.watch(uri, { recursive: false, excludes: [] })

      expect(disposable).toBeDefined()
      expect(typeof disposable.dispose).toBe("function")
    })

    it("calling dispose on the returned Disposable does not throw", () => {
      const { LocalStorage } = require("./localStorage")
      ;(LocalStorage as jest.Mock).mockImplementation(() => ({
        resolveUri: jest.fn().mockResolvedValue(makeUri("/resolved/path", "file"))
      }))
      const p = new LocalFsProvider(context)

      const uri = makeUri("/watch-path2")
      const disposable = p.watch(uri, { recursive: true, excludes: [] })

      expect(() => disposable.dispose()).not.toThrow()
    })
  })
})
