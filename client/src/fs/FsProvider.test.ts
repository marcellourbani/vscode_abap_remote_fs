// Tests for fs/FsProvider.ts
vi.mock("vscode", () => {
  const EventEmitter = class {
    event = vi.fn()
    fire = vi.fn()
  }
  const FileChangeType = { Created: 1, Changed: 2, Deleted: 3 }
  const FileType = { Unknown: 0, File: 1, Directory: 2 }
  const Disposable = class {
    constructor(public fn?: () => void) {
      this.dispose = fn ?? (() => {})
    }
    dispose: () => void
  }
  const FileSystemError = {
    FileNotFound: vi.fn(function (msg) {
      return Object.assign(new Error(msg), { name: "FileNotFound (FileSystemError)" })
    }),
    NoPermissions: vi.fn(function (msg) {
      return new Error(msg)
    }),
    Unavailable: vi.fn(function (msg) {
      return new Error(msg)
    })
  }
  const TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 }
  const workspace = {
    textDocuments: [],
    getConfiguration: vi.fn(function () {
      return {
        get: vi.fn(() => true),
        update: vi.fn()
      }
    }),
    onDidOpenTextDocument: vi.fn(function () {
      return new Disposable()
    })
  }
  const commands = { executeCommand: vi.fn() }
  const Uri = {
    parse: vi.fn(function (s: string) {
      return {
        scheme: s.split("://")[0] || "file",
        authority: "",
        path: "/" + (s.split("://")[1] || s),
        toString: () => s
      }
    })
  }
  return {
    EventEmitter,
    FileChangeType,
    FileType,
    Disposable,
    FileSystemError,
    TextDocumentSaveReason,
    workspace,
    commands,
    Uri,
    ExtensionContext: class {}
  }
})

vi.mock("../adt/conections", () => ({
  getOrCreateRoot: vi.fn(),
  ADTSCHEME: "adt"
}))

vi.mock("../lib", () => ({
  after: vi.fn(),
  caughtToString: vi.fn(function (e) {
    return String(e)
  }),
  log: Object.assign(vi.fn(), { debug: vi.fn() })
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn(function () {
    return false
  }),
  isAbapFolder: vi.fn(function () {
    return false
  }),
  isFolder: vi.fn(function () {
    return false
  })
}))

vi.mock("../listeners", () => ({
  getSaveReason: vi.fn(),
  clearSaveReason: vi.fn()
}))

vi.mock("../adt/AdtTransports", () => ({
  selectTransportIfNeeded: vi.fn()
}))

vi.mock("./LocalFsProvider", () => {
  const LocalFsProvider: any = vi.fn().mockImplementation(function () {
    return {
      onDidChangeFile: vi.fn(() => ({ event: vi.fn() })),
      watch: vi.fn(() => ({ dispose: vi.fn() })),
      stat: vi.fn(),
      readFile: vi.fn(),
      readDirectory: vi.fn(),
      writeFile: vi.fn(),
      createDirectory: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn()
    }
  })
  LocalFsProvider.useLocalStorage = vi.fn(function () {
    return false
  })
  return { LocalFsProvider }
})

vi.mock("abap-adt-api", () => ({ isHttpError: vi.fn() }))
vi.mock("abapfs/src/lockManager", () => ({ ReloginError: { isReloginError: vi.fn() } }))
vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    visibleTextEditors: []
  }
}))

import { FsProvider } from "./FsProvider"
import { LocalFsProvider as _LocalFsProvider } from "./LocalFsProvider"
// vi.mock replaced this class with mock fns; type it as a Mocked class for the test call sites.
const LocalFsProvider = _LocalFsProvider as unknown as Mocked<typeof _LocalFsProvider>
import * as vscode from "vscode"
import * as __$mock_adt_conections from "../adt/conections"
import * as __$mock_abapfs from "abapfs"
import type { Mocked, Mock } from "vitest"

const makeUri = (path = "/test", scheme = "adt", authority = "host") =>
  ({
    path,
    scheme,
    authority,
    toString: () => `${scheme}://${authority}${path}`
  }) as any

const makeContext = () => {
  const provider = new (LocalFsProvider as any)()
  return {
    subscriptions: [] as { push: Mock }[],
    _provider: provider,
    push: vi.fn()
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
    vi.clearAllMocks()
    resetFsProvider()
    context = {
      subscriptions: { push: vi.fn() }
    }
    // Mock localProvider.onDidChangeFile to return a function
    ;(LocalFsProvider as unknown as Mock).mockImplementation(function () {
      return {
        onDidChangeFile: vi.fn(),
        watch: vi.fn(() => ({ dispose: vi.fn() })),
        stat: vi.fn(),
        readFile: vi.fn(),
        readDirectory: vi.fn(),
        writeFile: vi.fn(),
        createDirectory: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn()
      }
    })
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
      const b = FsProvider.get({ subscriptions: { push: vi.fn() } } as any)
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
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const uri = makeUri("/.hidden")
      const mockWatch = vi.fn(function () {
        return { dispose: vi.fn() }
      })
      ;(instance as any).localProvider.watch = mockWatch

      instance.watch(uri, { recursive: false, excludes: [] })

      expect(mockWatch).toHaveBeenCalledWith(uri, { recursive: false, excludes: [] })
    })

    it("returns a no-op Disposable for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(false)
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
      const spy = vi.spyOn((instance as any).pEventEmitter, "fire")
      const changes = [{ type: 2, uri: makeUri("/changed") }]

      instance.notifyChanges(changes as any)

      expect(spy).toHaveBeenCalledWith(changes)
    })
  })

  describe("createDirectory", () => {
    it("delegates to localProvider for local URIs", () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockCreate = vi.fn()
      ;(instance as any).localProvider.createDirectory = mockCreate

      const uri = makeUri("/.hidden")
      instance.createDirectory(uri)

      expect(mockCreate).toHaveBeenCalledWith(uri)
    })

    it("throws NoPermissions for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(false)
      const instance = FsProvider.get(context)

      const uri = makeUri("/sap/bc/adt/program")
      expect(() => instance.createDirectory(uri)).toThrow()
    })
  })

  describe("rename", () => {
    it("delegates to localProvider for local URIs", () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockRename = vi.fn()
      ;(instance as any).localProvider.rename = mockRename

      const oldUri = makeUri("/.hidden")
      const newUri = makeUri("/.renamed")
      instance.rename(oldUri, newUri, { overwrite: false })

      expect(mockRename).toHaveBeenCalledWith(oldUri, newUri, { overwrite: false })
    })

    it("throws for remote URIs", () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(false)
      const instance = FsProvider.get(context)

      const oldUri = makeUri("/old")
      const newUri = makeUri("/new")
      expect(() => instance.rename(oldUri, newUri, { overwrite: false })).toThrow()
    })
  })

  describe("readFile", () => {
    it("delegates to localProvider for local URIs", async () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const content = new Uint8Array([72, 101, 108, 108, 111])
      const mockReadFile = vi.fn().mockResolvedValue(content)
      ;(instance as any).localProvider.readFile = mockReadFile

      const uri = makeUri("/.hidden")
      const result = await instance.readFile(uri)

      expect(result).toEqual(content)
      expect(mockReadFile).toHaveBeenCalledWith(uri)
    })

    it("throws Unavailable when no ABAP file found", async () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(false)
      const { getOrCreateRoot } = __$mock_adt_conections
      const { isAbapFile } = __$mock_abapfs
      ;(getOrCreateRoot as Mock).mockResolvedValue({
        getNodeAsync: vi.fn().mockResolvedValue(null)
      })
      ;(isAbapFile as unknown as Mock).mockReturnValue(false)

      const instance = FsProvider.get(context)
      const uri = makeUri("/sap/bc/adt/prog")

      await expect(instance.readFile(uri)).rejects.toThrow()
    })
  })

  describe("stat", () => {
    it("delegates to localProvider for local URIs", async () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(true)
      const instance = FsProvider.get(context)
      const mockStat = { type: 1, ctime: 0, mtime: 0, size: 100 }
      const mockStatFn = vi.fn().mockResolvedValue(mockStat)
      ;(instance as any).localProvider.stat = mockStatFn

      const uri = makeUri("/.hidden")
      const result = await instance.stat(uri)

      expect(result).toEqual(mockStat)
    })

    it("throws FileNotFound when node not found", async () => {
      ;(LocalFsProvider.useLocalStorage as Mock).mockReturnValue(false)
      const { getOrCreateRoot } = __$mock_adt_conections
      ;(getOrCreateRoot as Mock).mockResolvedValue({
        getNodeAsync: vi.fn().mockResolvedValue(null)
      })

      const instance = FsProvider.get(context)
      const uri = makeUri("/sap/bc/adt/missing")

      await expect(instance.stat(uri)).rejects.toBeDefined()
    })
  })
})
