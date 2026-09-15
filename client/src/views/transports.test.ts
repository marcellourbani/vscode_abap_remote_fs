/**
 * Tests for views/transports.ts
 * Focus on readTransports, failuretext helper, isTransport, ObjectItem.sameObj,
 * CollectionItem, TransportItem, and TransportsProvider structure.
 */

vi.mock("vscode", () => {
  const mockDisposable = { dispose: vi.fn() }
  return {
    TreeItem: class TreeItem {
      constructor(
        public label: string,
        public collapsibleState?: number
      ) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: vi.fn().mockImplementation(function () {
      return {
        event: vi.fn(),
        fire: vi.fn()
      }
    }),
    workspace: {
      workspaceFolders: [],
      onDidChangeWorkspaceFolders: vi.fn(function () {
        return mockDisposable
      })
    },
    Uri: {
      parse: vi.fn(function (s: string) {
        return {
          toString: () => s,
          authority: s.split("//")[1]?.split("/")[0] || "",
          scheme: s.split(":")[0]
        }
      })
    },
    ProgressLocation: { Notification: 15 },
    commands: { executeCommand: vi.fn() },
    env: { openExternal: vi.fn() }
  }
})

vi.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K"
}))

vi.mock("../commands", () => ({
  command: () => (target: any, key: string, descriptor: any) => descriptor,
  AbapFsCommands: {
    releaseTransport: "abapfs.releaseTransport",
    openTransportObject: "abapfs.openTransportObject",
    transportObjectDiff: "abapfs.transportObjectDiff",
    refreshtransports: "abapfs.refreshtransports",
    transportOpenGui: "abapfs.transportOpenGui"
  }
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    withProgress: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}))

vi.mock("../lib", () => ({
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  withp: vi.fn(function (_: string, fn: () => Promise<any>) {
    return fn()
  })
}))

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  ADTSCHEME: "adt",
  getOrCreateClient: vi.fn(),
  getRoot: vi.fn()
}))

vi.mock("abapfs", () => ({
  isFolder: vi.fn(),
  isAbapStat: vi.fn(),
  isAbapFolder: vi.fn(),
  PathItem: {}
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  createUri: vi.fn()
}))

vi.mock("../scm/abaprevisions", () => ({
  AbapScm: {},
  displayRevDiff: vi.fn()
}))

vi.mock("../scm/abaprevisions/abaprevisionservice", () => ({
  AbapRevisionService: { get: vi.fn() }
}))

vi.mock("../adt/sapgui/sapgui", () => ({
  runInSapGui: vi.fn(),
  showInGuiCb: vi.fn()
}))

vi.mock("./abaptestcockpit", () => ({
  atcProvider: {}
}))

vi.mock("./utilities", () => ({
  pickUser: vi.fn()
}))

import { readTransports, TransportsProvider } from "./transports"
import { getClient, getOrCreateClient, ADTSCHEME } from "../adt/conections"
import * as __$mock_vscode from "vscode"
import type { Mock } from "vitest"

const mockedGetClient = getClient as Mock
const mockedGetOrCreateClient = getOrCreateClient as Mock

describe("readTransports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses transportsByConfig when hasTransportConfig is true", async () => {
    const mockLink = "http://sap/transport-link"
    const mockEtag = "etag123"
    const mockConfig = { link: mockLink, etag: mockEtag }
    const mockFullConfig = { User: "TESTUSER" }
    const mockTransports = [{ "tm:number": "TR001" }]

    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(true),
      transportConfigurations: vi.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: vi.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: vi.fn().mockResolvedValue(undefined),
      transportsByConfig: vi.fn().mockResolvedValue(mockTransports)
    }
    mockedGetClient.mockReturnValue(mockClient)

    const result = await readTransports("dev100", "testuser")
    expect(mockClient.hasTransportConfig).toHaveBeenCalled()
    expect(mockClient.transportsByConfig).toHaveBeenCalledWith(mockLink)
    expect(result).toBe(mockTransports)
  })

  it("updates config if user does not match", async () => {
    const mockLink = "http://sap/transport-link"
    const mockEtag = "etag123"
    const mockConfig = { link: mockLink, etag: mockEtag }
    const mockFullConfig = { User: "DIFFERENTUSER" }

    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(true),
      transportConfigurations: vi.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: vi.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: vi.fn().mockResolvedValue(undefined),
      transportsByConfig: vi.fn().mockResolvedValue([])
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "MYUSER")
    expect(mockClient.setTransportsConfig).toHaveBeenCalledWith(mockLink, mockEtag, {
      User: "MYUSER"
    })
  })

  it("does not update config if user already matches (case-insensitive)", async () => {
    const mockLink = "http://sap/transport-link"
    const mockConfig = { link: mockLink, etag: "e1" }
    const mockFullConfig = { User: "MYUSER" }

    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(true),
      transportConfigurations: vi.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: vi.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: vi.fn(),
      transportsByConfig: vi.fn().mockResolvedValue([])
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "myuser")
    expect(mockClient.setTransportsConfig).not.toHaveBeenCalled()
  })

  it("falls back to userTransports when hasTransportConfig is false", async () => {
    const mockTransports = [{ "tm:number": "TR002" }]
    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(false),
      userTransports: vi.fn().mockResolvedValue(mockTransports)
    }
    mockedGetClient.mockReturnValue(mockClient)

    const result = await readTransports("dev100", "user1")
    expect(mockClient.userTransports).toHaveBeenCalledWith("user1")
    expect(result).toBe(mockTransports)
  })

  it("creates transport config if none found on first call", async () => {
    const mockLink = "http://sap/transport-link-new"
    const mockConfig = { link: mockLink, etag: "new" }
    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(true),
      transportConfigurations: vi
        .fn()
        .mockResolvedValueOnce([]) // first call returns empty
        .mockResolvedValueOnce([mockConfig]), // second call after create
      createTransportsConfig: vi.fn().mockResolvedValue(undefined),
      getTransportConfiguration: vi.fn().mockResolvedValue({ User: "USER1" }),
      setTransportsConfig: vi.fn().mockResolvedValue(undefined),
      transportsByConfig: vi.fn().mockResolvedValue([])
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "user1")
    expect(mockClient.createTransportsConfig).toHaveBeenCalled()
    expect(mockClient.transportsByConfig).toHaveBeenCalledWith(mockLink)
  })

  it("throws when transport config cannot be created", async () => {
    const mockClient = {
      hasTransportConfig: vi.fn().mockResolvedValue(true),
      transportConfigurations: vi.fn().mockResolvedValue([]),
      createTransportsConfig: vi.fn().mockResolvedValue(undefined)
    }
    // Make second call return empty too
    ;(mockClient.transportConfigurations as Mock).mockResolvedValue([])
    mockedGetClient.mockReturnValue(mockClient)

    await expect(readTransports("dev100", "user1")).rejects.toThrow(
      "Transport configuration not found"
    )
  })
})

describe("TransportsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset singleton
    ;(TransportsProvider as any).instance = undefined
  })

  it("returns singleton instance", () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    const i1 = TransportsProvider.get()
    const i2 = TransportsProvider.get()
    expect(i1).toBe(i2)
  })

  it("getTreeItem returns the element itself", () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const item = { label: "test" } as any
    const result = provider.getTreeItem(item)
    expect(result).toBe(item)
  })

  it("getChildren with no element returns root children", async () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const children = await provider.getChildren()
    expect(Array.isArray(children)).toBe(true)
  })

  it("getChildren with element delegates to element.getChildren", async () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const mockChild = { label: "child" } as any
    const element = { getChildren: vi.fn().mockResolvedValue([mockChild]) } as any
    const result = await provider.getChildren(element)
    expect(element.getChildren).toHaveBeenCalled()
    expect(result).toEqual([mockChild])
  })
})
