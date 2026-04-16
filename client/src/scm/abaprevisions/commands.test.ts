jest.mock("vscode", () => {
  const TabInputTextDiff = jest.fn()
  return {
    commands: { executeCommand: jest.fn() },
    Uri: {
      parse: jest.fn((s: string) => ({
        toString: () => s,
        path: s.replace(/^\w+:\/\/[^/]*/, ""),
        authority: s.match(/^\w+:\/\/([^/]*)/)?.[1] || "",
        scheme: s.match(/^(\w+):/)?.[1] || "",
        with: jest.fn(function (this: any, overrides: any) {
          return { ...this, ...overrides, toString: () => s }
        })
      }))
    },
    ProgressLocation: { Notification: 15 },
    workspace: {},
    QuickPickItem: {},
    TabInputTextDiff
  }
}, { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    tabGroups: {
      activeTabGroup: { activeTab: null }
    },
    withProgress: jest.fn((_opts: any, cb: any) => cb({}, { isCancellationRequested: false }))
  }
}))

jest.mock("../../adt/conections", () => ({
  abapUri: jest.fn(),
  uriRoot: jest.fn(),
  getOrCreateRoot: jest.fn(),
  getClient: jest.fn(),
  ADTSCHEME: "adt",
  rootIsConnected: jest.fn()
}))

jest.mock("./abaprevisionservice", () => ({
  AbapRevisionService: {
    get: jest.fn().mockReturnValue({
      uriRevisions: jest.fn().mockResolvedValue([])
    })
  },
  revLabel: jest.fn((rev: any, fallback: string) => rev?.version || fallback)
}))

jest.mock("./documentprovider", () => ({
  decodeRevisioUrl: jest.fn(),
  revisionUri: jest.fn((uri: any, rev: any, norm?: boolean) => ({
    ...uri,
    scheme: "adt_revision",
    revision: rev
  })),
  ADTREVISIONSCHEME: "adt_revision"
}))

jest.mock("./quickdiff", () => ({
  AbapQuickDiff: {
    get: jest.fn().mockReturnValue({ setCurrentRev: jest.fn() })
  }
}))

jest.mock("../../config", () => ({
  RemoteManager: {
    get: jest.fn().mockReturnValue({
      selectConnection: jest.fn().mockResolvedValue({ remote: null, userCancel: true })
    })
  },
  formatKey: jest.fn((s: string) => s.toLowerCase())
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

jest.mock("../../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  atob: jest.fn((s: string) => Buffer.from(s, "base64").toString()),
  btoa: jest.fn((s: string) => Buffer.from(s).toString("base64"))
}))

jest.mock("io-ts", () => ({
  type: jest.fn().mockReturnValue({ decode: jest.fn() }),
  string: "string"
}))

jest.mock("fp-ts/lib/Either", () => ({
  isRight: jest.fn().mockReturnValue(false)
}))

jest.mock("../../langClient", () => ({
  vsCodeUri: jest.fn()
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: {
    changequickdiff: "abapfs.changequickdiff",
    remotediff: "abapfs.remotediff",
    comparediff: "abapfs.comparediff",
    prevRevLeft: "abapfs.prevRevLeft",
    nextRevLeft: "abapfs.nextRevLeft",
    prevRevRight: "abapfs.prevRevRight",
    nextRevRight: "abapfs.nextRevRight",
    mergeEditor: "abapfs.openMergeEditor",
    clearScmGroup: "abapfs.clearScmGroup",
    filterScmGroup: "abapfs.filterScmGroup",
    opendiff: "abapfs.opendiff",
    opendiffNormalized: "abapfs.opendiffNormalized",
    togglediffNormalize: "abapfs.togglediffNormalize"
  },
  command: jest.fn(() => jest.fn())
}))

import { commands, Uri } from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { abapUri } from "../../adt/conections"
import { AbapRevisionService } from "./abaprevisionservice"
import { displayRevDiff, versionRevisions } from "./commands"
import { decodeRevisioUrl, revisionUri } from "./documentprovider"

beforeEach(() => {
  jest.clearAllMocks()
})

describe("displayRevDiff", () => {
  it("calls vscode.diff with correct title and revision URIs", async () => {
    const uri = Uri.parse("adt://dev100/some/path/object.abap")
    const leftRev = { uri: "rev1", version: "v1", date: "2024-01-01", author: "user", versionTitle: "" }
    const rightRev = { uri: "rev2", version: "v2", date: "2024-01-02", author: "user", versionTitle: "" }

    await displayRevDiff(rightRev, leftRev, uri)

    expect(revisionUri).toHaveBeenCalledWith(uri, leftRev, false)
    expect(revisionUri).toHaveBeenCalledWith(uri, rightRev, false)
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("->")
    )
  })

  it("uses 'initial' label when leftRev is undefined", async () => {
    const uri = Uri.parse("adt://dev100/some/path/object.abap")

    await displayRevDiff({ uri: "r", version: "v", date: "", author: "", versionTitle: "" }, undefined, uri)

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("initial")
    )
  })

  it("uses 'current' label when rightRev is undefined", async () => {
    const uri = Uri.parse("adt://dev100/some/path/object.abap")

    await displayRevDiff(undefined, { uri: "r", version: "v", date: "", author: "", versionTitle: "" }, uri)

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("current")
    )
  })

  it("passes normalize flag to revisionUri", async () => {
    const uri = Uri.parse("adt://dev100/some/path/object.abap")
    const rev = { uri: "r", version: "v", date: "", author: "", versionTitle: "" }

    await displayRevDiff(rev, rev, uri, true)

    expect(revisionUri).toHaveBeenCalledWith(uri, rev, true)
  })
})

describe("versionRevisions", () => {
  it("returns undefined when decodeRevisioUrl returns undefined", async () => {
    ;(decodeRevisioUrl as jest.Mock).mockReturnValue(undefined)
    const uri = Uri.parse("adt_revision://dev100/path")
    const result = await versionRevisions(uri)
    expect(result).toBeUndefined()
  })

  it("returns undefined when revision not found in loaded revisions", async () => {
    const innerUri = Uri.parse("adt://dev100/path")
    const revision = { uri: "not-found-uri", version: "1", date: "", author: "", versionTitle: "" }
    ;(decodeRevisioUrl as jest.Mock).mockReturnValue({
      uri: innerUri,
      revision,
      normalized: false
    })
    const service = { uriRevisions: jest.fn().mockResolvedValue([]) }
    ;(AbapRevisionService.get as jest.Mock).mockReturnValue(service)

    const uri = Uri.parse("adt_revision://dev100/path")
    const result = await versionRevisions(uri)
    expect(result).toBeUndefined()
  })

  it("returns revision details when found", async () => {
    const innerUri = Uri.parse("adt://dev100/path")
    const revision = { uri: "found-uri", version: "2", date: "2024-01-01", author: "user", versionTitle: "" }
    ;(decodeRevisioUrl as jest.Mock).mockReturnValue({
      uri: innerUri,
      revision,
      normalized: true
    })
    const service = { uriRevisions: jest.fn().mockResolvedValue([revision]) }
    ;(AbapRevisionService.get as jest.Mock).mockReturnValue(service)

    const uri = Uri.parse("adt_revision://dev100/path")
    const result = await versionRevisions(uri, false)

    expect(result).toBeDefined()
    expect(result!.revision).toBe(revision)
    expect(result!.normalized).toBe(true)
    expect(result!.uri).toBe(innerUri)
  })
})
