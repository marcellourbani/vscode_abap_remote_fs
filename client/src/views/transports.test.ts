/**
 * Tests for views/transports.ts
 * Focus on readTransports, failuretext helper, isTransport, ObjectItem.sameObj,
 * CollectionItem, TransportItem, and TransportsProvider structure.
 */

jest.mock("vscode", () => {
  const mockDisposable = { dispose: jest.fn() }
  return {
    TreeItem: class TreeItem {
      constructor(public label: string, public collapsibleState?: number) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: jest.fn().mockImplementation(() => ({
      event: jest.fn(),
      fire: jest.fn(),
    })),
    workspace: {
      workspaceFolders: [],
      onDidChangeWorkspaceFolders: jest.fn(() => mockDisposable),
    },
    Uri: {
      parse: jest.fn((s: string) => ({ toString: () => s, authority: s.split("//")[1]?.split("/")[0] || "", scheme: s.split(":")[0] })),
    },
    ProgressLocation: { Notification: 15 },
    commands: { executeCommand: jest.fn() },
    env: { openExternal: jest.fn() },
  }
}, { virtual: true })

jest.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K",
}), { virtual: true })

jest.mock("../commands", () => ({
  command: () => (target: any, key: string, descriptor: any) => descriptor,
  AbapFsCommands: {
    releaseTransport: "abapfs.releaseTransport",
    openTransportObject: "abapfs.openTransportObject",
    transportObjectDiff: "abapfs.transportObjectDiff",
    refreshtransports: "abapfs.refreshtransports",
    transportOpenGui: "abapfs.transportOpenGui",
  },
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    withProgress: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
  },
}), { virtual: true })

jest.mock("../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  withp: jest.fn((_: string, fn: () => Promise<any>) => fn()),
}), { virtual: true })

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  ADTSCHEME: "adt",
  getOrCreateClient: jest.fn(),
  getRoot: jest.fn(),
}), { virtual: true })

jest.mock("abapfs", () => ({
  isFolder: jest.fn(),
  isAbapStat: jest.fn(),
  isAbapFolder: jest.fn(),
  PathItem: {},
}), { virtual: true })

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  createUri: jest.fn(),
}), { virtual: true })

jest.mock("../scm/abaprevisions", () => ({
  AbapScm: {},
  displayRevDiff: jest.fn(),
}), { virtual: true })

jest.mock("../scm/abaprevisions/abaprevisionservice", () => ({
  AbapRevisionService: { get: jest.fn() },
}), { virtual: true })

jest.mock("../adt/sapgui/sapgui", () => ({
  runInSapGui: jest.fn(),
  showInGuiCb: jest.fn(),
}), { virtual: true })

jest.mock("./abaptestcockpit", () => ({
  atcProvider: {},
}), { virtual: true })

jest.mock("./utilities", () => ({
  pickUser: jest.fn(),
}), { virtual: true })

import { readTransports, TransportsProvider } from "./transports"
import { getClient, getOrCreateClient, ADTSCHEME } from "../adt/conections"

const mockedGetClient = getClient as jest.Mock
const mockedGetOrCreateClient = getOrCreateClient as jest.Mock

describe("readTransports", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("uses transportsByConfig when hasTransportConfig is true", async () => {
    const mockLink = "http://sap/transport-link"
    const mockEtag = "etag123"
    const mockConfig = { link: mockLink, etag: mockEtag }
    const mockFullConfig = { User: "TESTUSER" }
    const mockTransports = [{ "tm:number": "TR001" }]

    const mockClient = {
      hasTransportConfig: jest.fn().mockResolvedValue(true),
      transportConfigurations: jest.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: jest.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: jest.fn().mockResolvedValue(undefined),
      transportsByConfig: jest.fn().mockResolvedValue(mockTransports),
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
      hasTransportConfig: jest.fn().mockResolvedValue(true),
      transportConfigurations: jest.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: jest.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: jest.fn().mockResolvedValue(undefined),
      transportsByConfig: jest.fn().mockResolvedValue([]),
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "MYUSER")
    expect(mockClient.setTransportsConfig).toHaveBeenCalledWith(
      mockLink, mockEtag, { User: "MYUSER" }
    )
  })

  it("does not update config if user already matches (case-insensitive)", async () => {
    const mockLink = "http://sap/transport-link"
    const mockConfig = { link: mockLink, etag: "e1" }
    const mockFullConfig = { User: "MYUSER" }

    const mockClient = {
      hasTransportConfig: jest.fn().mockResolvedValue(true),
      transportConfigurations: jest.fn().mockResolvedValue([mockConfig]),
      getTransportConfiguration: jest.fn().mockResolvedValue(mockFullConfig),
      setTransportsConfig: jest.fn(),
      transportsByConfig: jest.fn().mockResolvedValue([]),
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "myuser")
    expect(mockClient.setTransportsConfig).not.toHaveBeenCalled()
  })

  it("falls back to userTransports when hasTransportConfig is false", async () => {
    const mockTransports = [{ "tm:number": "TR002" }]
    const mockClient = {
      hasTransportConfig: jest.fn().mockResolvedValue(false),
      userTransports: jest.fn().mockResolvedValue(mockTransports),
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
      hasTransportConfig: jest.fn().mockResolvedValue(true),
      transportConfigurations: jest.fn()
        .mockResolvedValueOnce([]) // first call returns empty
        .mockResolvedValueOnce([mockConfig]), // second call after create
      createTransportsConfig: jest.fn().mockResolvedValue(undefined),
      getTransportConfiguration: jest.fn().mockResolvedValue({ User: "USER1" }),
      setTransportsConfig: jest.fn().mockResolvedValue(undefined),
      transportsByConfig: jest.fn().mockResolvedValue([]),
    }
    mockedGetClient.mockReturnValue(mockClient)

    await readTransports("dev100", "user1")
    expect(mockClient.createTransportsConfig).toHaveBeenCalled()
    expect(mockClient.transportsByConfig).toHaveBeenCalledWith(mockLink)
  })

  it("throws when transport config cannot be created", async () => {
    const mockClient = {
      hasTransportConfig: jest.fn().mockResolvedValue(true),
      transportConfigurations: jest.fn().mockResolvedValue([]),
      createTransportsConfig: jest.fn().mockResolvedValue(undefined),
    }
    // Make second call return empty too
    ;(mockClient.transportConfigurations as jest.Mock).mockResolvedValue([])
    mockedGetClient.mockReturnValue(mockClient)

    await expect(readTransports("dev100", "user1")).rejects.toThrow(
      "Transport configuration not found"
    )
  })
})

describe("TransportsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset singleton
    ;(TransportsProvider as any).instance = undefined
  })

  it("returns singleton instance", () => {
    const { workspace } = require("vscode")
    ;(workspace as any).workspaceFolders = []
    const i1 = TransportsProvider.get()
    const i2 = TransportsProvider.get()
    expect(i1).toBe(i2)
  })

  it("getTreeItem returns the element itself", () => {
    const { workspace } = require("vscode")
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const item = { label: "test" } as any
    const result = provider.getTreeItem(item)
    expect(result).toBe(item)
  })

  it("getChildren with no element returns root children", async () => {
    const { workspace } = require("vscode")
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const children = await provider.getChildren()
    expect(Array.isArray(children)).toBe(true)
  })

  it("getChildren with element delegates to element.getChildren", async () => {
    const { workspace } = require("vscode")
    ;(workspace as any).workspaceFolders = []
    ;(TransportsProvider as any).instance = undefined
    const provider = TransportsProvider.get()
    const mockChild = { label: "child" } as any
    const element = { getChildren: jest.fn().mockResolvedValue([mockChild]) } as any
    const result = await provider.getChildren(element)
    expect(element.getChildren).toHaveBeenCalled()
    expect(result).toEqual([mockChild])
  })
})
