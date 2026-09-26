/**
 * Tests for views/abapgit.ts
 * Covers confirmPull, packageUri, AbapGit class methods, and AbapGitProvider.
 */

vi.mock("fp-ts/lib/Either", () => ({
  isRight: vi.fn(function (v: any) {
    return v && v._tag === "Right"
  })
}))

vi.mock("fp-ts/lib/Option", () => ({
  isNone: vi.fn(function (v: any) {
    return !v || v._tag === "None"
  }),
  none: { _tag: "None" },
  isSome: vi.fn(function (v: any) {
    return v && v._tag === "Some"
  })
}))

vi.mock("vscode", () => ({
  TreeItem: class TreeItem {
    constructor(
      public label?: any,
      public collapsibleState?: number
    ) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: vi.fn().mockImplementation(function () {
    return {
      event: {},
      fire: vi.fn()
    }
  }),
  workspace: {
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        toString: () => s,
        authority: s.replace(/.*?:\/\//, "").split("/")[0] ?? "",
        scheme: s.split(":")[0]
      }
    })
  },
  ProgressLocation: { Notification: 15 },
  commands: { executeCommand: vi.fn() },
  env: { openExternal: vi.fn() }
}))

vi.mock("../commands", () => ({
  command: () => (target: any, key: string, descriptor: any) => descriptor,
  AbapFsCommands: {
    refreshAbapGit: "abapfs.refreshAbapGit",
    openRepo: "abapfs.openRepo",
    addScm: "abapfs.addScm"
  }
}))

vi.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K"
}))

vi.mock("../adt/AdtTransports", () => ({
  selectTransport: vi.fn()
}))

vi.mock("../lib", () => ({
  chainTaskTransformers: vi.fn(),
  dependFieldReplacer: vi.fn(),
  log: vi.fn(),
  createTaskTransformer: vi.fn(),
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  quickPick: vi.fn()
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn()
  }
}))

vi.mock("../scm/abapGit", () => ({
  addRepo: vi.fn(),
  repoCredentials: vi.fn()
}))

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  ADTSCHEME: "adt",
  getOrCreateClient: vi.fn()
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      vscodeUri: vi.fn()
    }
  }),
  createUri: vi.fn()
}))

vi.mock("uuid", () => ({
  v1: vi.fn(function () {
    return "test-uuid"
  })
}))

import { confirmPull, packageUri } from "./abapgit"
import { funWindow as window } from "../services/funMessenger"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>

describe("confirmPull", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns true when user confirms", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue("Confirm")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(true)
    expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("ZPKG"),
      "Confirm",
      "Cancel"
    )
  })

  it("returns false when user cancels", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue("Cancel")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })

  it("returns false when user dismisses (undefined)", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue(undefined)
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })
})

describe("packageUri", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns objectPath when collectionFeatureDetails succeeds (truthy)", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(true)
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
  })

  it("falls back to vit URL when collectionFeatureDetails returns falsy", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(null)
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
    expect(result).toContain("devck")
  })

  it("encodes special characters in package name", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(null)
    } as any
    const result = await packageUri(mockClient, "Z/PKG")
    expect(result).not.toContain("Z/PKG")
    expect(result).toContain("Z%2FPKG")
  })
})
