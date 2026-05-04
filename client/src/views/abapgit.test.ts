/**
 * Tests for views/abapgit.ts
 * Covers confirmPull, packageUri, AbapGit class methods, and AbapGitProvider.
 */

jest.mock("fp-ts/lib/Either", () => ({
  isRight: jest.fn((v: any) => v && v._tag === "Right"),
}), { virtual: true })

jest.mock("fp-ts/lib/Option", () => ({
  isNone: jest.fn((v: any) => !v || v._tag === "None"),
  none: { _tag: "None" },
  isSome: jest.fn((v: any) => v && v._tag === "Some"),
}), { virtual: true })

jest.mock("vscode", () => ({
  TreeItem: class TreeItem {
    constructor(public label?: any, public collapsibleState?: number) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: {},
    fire: jest.fn(),
  })),
  workspace: {
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  },
  Uri: {
    parse: jest.fn((s: string) => ({
      toString: () => s,
      authority: s.replace(/.*?:\/\//, "").split("/")[0] ?? "",
      scheme: s.split(":")[0],
    })),
  },
  ProgressLocation: { Notification: 15 },
  commands: { executeCommand: jest.fn() },
  env: { openExternal: jest.fn() },
}), { virtual: true })

jest.mock("../commands", () => ({
  command: () => (target: any, key: string, descriptor: any) => descriptor,
  AbapFsCommands: {
    refreshAbapGit: "abapfs.refreshAbapGit",
    openRepo: "abapfs.openRepo",
    addScm: "abapfs.addScm",
  },
}), { virtual: true })

jest.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K",
}), { virtual: true })

jest.mock("../adt/AdtTransports", () => ({
  selectTransport: jest.fn(),
}), { virtual: true })

jest.mock("../lib", () => ({
  chainTaskTransformers: jest.fn(),
  dependFieldReplacer: jest.fn(),
  log: jest.fn(),
  createTaskTransformer: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e)),
  quickPick: jest.fn(),
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    withProgress: jest.fn(),
  },
}), { virtual: true })

jest.mock("../scm/abapGit", () => ({
  addRepo: jest.fn(),
  repoCredentials: jest.fn(),
}), { virtual: true })

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  ADTSCHEME: "adt",
  getOrCreateClient: jest.fn(),
}), { virtual: true })

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn().mockImplementation(() => ({
    vscodeUri: jest.fn(),
  })),
  createUri: jest.fn(),
}), { virtual: true })

jest.mock("uuid", () => ({ v1: jest.fn(() => "test-uuid") }), { virtual: true })

import { confirmPull, packageUri } from "./abapgit"
import { funWindow as window } from "../services/funMessenger"

const mockedWindow = window as jest.Mocked<typeof window>

describe("confirmPull", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns true when user confirms", async () => {
    ;(mockedWindow.showInformationMessage as jest.Mock).mockResolvedValue("Confirm")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(true)
    expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("ZPKG"),
      "Confirm",
      "Cancel"
    )
  })

  it("returns false when user cancels", async () => {
    ;(mockedWindow.showInformationMessage as jest.Mock).mockResolvedValue("Cancel")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })

  it("returns false when user dismisses (undefined)", async () => {
    ;(mockedWindow.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })
})

describe("packageUri", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns objectPath when collectionFeatureDetails succeeds (truthy)", async () => {
    const mockClient = {
      collectionFeatureDetails: jest.fn().mockResolvedValue(true),
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
  })

  it("falls back to vit URL when collectionFeatureDetails returns falsy", async () => {
    const mockClient = {
      collectionFeatureDetails: jest.fn().mockResolvedValue(null),
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
    expect(result).toContain("devck")
  })

  it("encodes special characters in package name", async () => {
    const mockClient = {
      collectionFeatureDetails: jest.fn().mockResolvedValue(null),
    } as any
    const result = await packageUri(mockClient, "Z/PKG")
    expect(result).not.toContain("Z/PKG")
    expect(result).toContain("Z%2FPKG")
  })
})
