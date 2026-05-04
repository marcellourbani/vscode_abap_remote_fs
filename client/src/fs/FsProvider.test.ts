// Tests for fs/FsProvider.ts
jest.mock("vscode", () => {
  const EventEmitter = class {
    event = jest.fn()
    fire = jest.fn()
  }
  const FileChangeType = { Created: 1, Changed: 2, Deleted: 3 }
  const FileType = { Unknown: 0, File: 1, Directory: 2 }
  const Disposable = class { constructor(public fn?: () => void) { this.dispose = fn ?? (() => {}) }; dispose: () => void }
  const FileSystemError = {
    FileNotFound: jest.fn(msg => Object.assign(new Error(msg), { name: "FileNotFound (FileSystemError)" })),
    NoPermissions: jest.fn(msg => new Error(msg)),
    Unavailable: jest.fn(msg => new Error(msg))
  }
  const TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 }
  const workspace = {
    textDocuments: [],
    getConfiguration: jest.fn(() => ({
      get: jest.fn(() => true),
      update: jest.fn()
    }))
  }
  const commands = { executeCommand: jest.fn() }
  const Uri = {
    parse: jest.fn((s: string) => ({
      scheme: s.split("://")[0] || "file",
      authority: "",
      path: "/" + (s.split("://")[1] || s),
      toString: () => s
    }))
  }
  return {
    EventEmitter, FileChangeType, FileType, Disposable, FileSystemError,
    TextDocumentSaveReason, workspace, commands, Uri,
    ExtensionContext: class {}
  }
}, { virtual: true })

jest.mock("../adt/conections", () => ({
  getOrCreateRoot: jest.fn(),
  ADTSCHEME: "adt"
}))

jest.mock("../lib", () => ({
  after: jest.fn(),
  caughtToString: jest.fn(e => String(e)),
  log: Object.assign(jest.fn(), { debug: jest.fn() })
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn(() => false),
  isAbapFolder: jest.fn(() => false),
  isFolder: jest.fn(() => false)
}))

jest.mock("../listeners", () => ({
  getSaveReason: jest.fn(),
  clearSaveReason: jest.fn()
}))

jest.mock("../adt/AdtTransports", () => ({
  selectTransportIfNeeded: jest.fn()
}))

jest.mock("./LocalFsProvider", () => {
  const LocalFsProvider: any = jest.fn().mockImplementation(() => ({
    onDidChangeFile: jest.fn(() => ({ event: jest.fn() })),
    watch: jest.fn(() => ({ dispose: jest.fn() })),
    stat: jest.fn(),
    readFile: jest.fn(),
    readDirectory: jest.fn(),
    writeFile: jest.fn(),
    createDirectory: jest.fn(),
    delete: jest.fn(),
    rename: jest.fn()
  }))
  LocalFsProvider.useLocalStorage = jest.fn(() => false)
  return { LocalFsProvider }
})

jest.mock("abap-adt-api", () => ({ isHttpError: jest.fn() }))
jest.mock("abapfs/out/lockManager", () => ({ ReloginError: { isReloginError: jest.fn() } }))
jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    visibleTextEditors: []
  }
}))

import { FsProvider } from "./FsProvider"
import { LocalFsProvider as _LocalFsProvider } from "./LocalFsProvider"
const LocalFsProvider = _LocalFsProvider as any
import * as vscode from "vscode"

const makeUri = (path = "/test", scheme = "adt", authority = "host") => ({
  path,
  scheme,
  authority,
  toString: () => `${scheme}://${authority}${path}`
} as any)

const makeContext = () => {
  const provider = new (LocalFsProvider as any)()
  return {
    subscriptions: [] as { push: jest.Mock }[],
    _provider: provider,
    push: jest.fn()
  } as any
}

// Reset singleton between tests
const resetFsProvider = () => {
  // Access private static field via prototype
  ;(FsProvider as any).instance = undefined
}

describe("FsProvider", () => {
  let context: any

  beforeEach(() => {
    jest.clearAllMocks()
    resetFsProvider()
    context = {
      subscriptions: { push: jest.fn() }
    }
    // Mock localProvider.onDidChangeFile to return a function
    ;(LocalFsProvider as jest.Mock).mockImplementation(() => ({
      onDidChangeFile: jest.fn(),
      watch: jest.fn(() => ({ dispose: jest.fn() })),
      stat: jest.fn(),
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      writeFile: jest.fn(),
      createDirectory: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn()
    }))
  })

  describe("FsProvider.get (singleton)", () => {
    it("throws if called without context on first call", () => {
      expect(() => FsProvider.get()).toThrow("FsProvider not initialized, context is required")
    })

    it("creates instance when context provided", () => {
      const instance = FsProvider.get(context)
      expect(instance).toBeDefined()
    })

    it("returns same instance on subsequent calls", () => {
      const a = FsProvider.get(context)
      const b = FsProvider.get()
      expect(a).toBe(b)
    })

    it("returns existing instance even if new context provided", () => {
      const a = FsProvider.get(context)
      const b = FsProvider.get({ subscriptions: { push: jest.fn() } } as any)
      expect(a).toBe(b)
    })
  })

  describe("onDidChangeFile", () => {
    it("exposes an event", () => {
      const instance = FsProvider.get(context)
      expect(instance.onDidChangeFile).toBeDefined()
    })
  })

  describe("watch", () => {
    it("delegates to localProvider when useLocalStorage returns true", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const uri = makeUri("/.hidden")
      const mockWatch = jest.fn(() => ({ dispose: jest.fn() }))
      ;(instance as any).localProvider.watch = mockWatch

      instance.watch(uri, { recursive: false, excludes: [] })

      expect(mockWatch).toHaveBeenCalledWith(uri, { recursive: false, excludes: [] })
    })

    it("returns a no-op Disposable for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(false)
      const instance = FsProvider.get(context)
      const uri = makeUri("/sap/bc/adt/program")

      const disposable = instance.watch(uri, { recursive: false, excludes: [] })
      expect(disposable).toBeDefined()
      expect(() => disposable.dispose()).not.toThrow()
    })
  })

  describe("notifyChanges", () => {
    it("fires the event emitter with changes", () => {
      const instance = FsProvider.get(context)
      const spy = jest.spyOn((instance as any).pEventEmitter, "fire")
      const changes = [{ type: 2, uri: makeUri("/changed") }]

      instance.notifyChanges(changes as any)

      expect(spy).toHaveBeenCalledWith(changes)
    })
  })

  describe("createDirectory", () => {
    it("delegates to localProvider for local URIs", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockCreate = jest.fn()
      ;(instance as any).localProvider.createDirectory = mockCreate

      const uri = makeUri("/.hidden")
      instance.createDirectory(uri)

      expect(mockCreate).toHaveBeenCalledWith(uri)
    })

    it("throws NoPermissions for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(false)
      const instance = FsProvider.get(context)

      const uri = makeUri("/sap/bc/adt/program")
      expect(() => instance.createDirectory(uri)).toThrow()
    })
  })

  describe("rename", () => {
    it("delegates to localProvider for local URIs", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockRename = jest.fn()
      ;(instance as any).localProvider.rename = mockRename

      const oldUri = makeUri("/.hidden")
      const newUri = makeUri("/.renamed")
      instance.rename(oldUri, newUri, { overwrite: false })

      expect(mockRename).toHaveBeenCalledWith(oldUri, newUri, { overwrite: false })
    })

    it("throws for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(false)
      const instance = FsProvider.get(context)

      const oldUri = makeUri("/old")
      const newUri = makeUri("/new")
      expect(() => instance.rename(oldUri, newUri, { overwrite: false })).toThrow()
    })
  })

  describe("readFile", () => {
    it("delegates to localProvider for local URIs", async () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const content = new Uint8Array([72, 101, 108, 108, 111])
      const mockReadFile = jest.fn().mockResolvedValue(content)
      ;(instance as any).localProvider.readFile = mockReadFile

      const uri = makeUri("/.hidden")
      const result = await instance.readFile(uri)

      expect(result).toEqual(content)
      expect(mockReadFile).toHaveBeenCalledWith(uri)
    })

    it("throws Unavailable when no ABAP file found", async () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(false)
      const { getOrCreateRoot } = require("../adt/conections")
      const { isAbapFile } = require("abapfs")
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({
        getNodeAsync: jest.fn().mockResolvedValue(null)
      })
      ;(isAbapFile as jest.Mock).mockReturnValue(false)

      const instance = FsProvider.get(context)
      const uri = makeUri("/sap/bc/adt/prog")

      await expect(instance.readFile(uri)).rejects.toThrow()
    })
  })

  describe("stat", () => {
    it("delegates to localProvider for local URIs", async () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockStat = { type: 1, ctime: 0, mtime: 0, size: 100 }
      const mockStatFn = jest.fn().mockResolvedValue(mockStat)
      ;(instance as any).localProvider.stat = mockStatFn

      const uri = makeUri("/.hidden")
      const result = await instance.stat(uri)

      expect(result).toEqual(mockStat)
    })

    it("throws FileNotFound when node not found", async () => {
      ;(LocalFsProvider.useLocalStorage as jest.Mock).mockReturnValue(false)
      const { getOrCreateRoot } = require("../adt/conections")
      ;(getOrCreateRoot as jest.Mock).mockResolvedValue({
        getNodeAsync: jest.fn().mockResolvedValue(null)
      })

      const instance = FsProvider.get(context)
      const uri = makeUri("/sap/bc/adt/missing")

      await expect(instance.stat(uri)).rejects.toBeDefined()
    })
  })
})
