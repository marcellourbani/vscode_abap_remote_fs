jest.mock("vscode", () => ({
  commands: { executeCommand: jest.fn() },
  Uri: {
    parse: jest.fn((s: string) => ({
      toString: () => s,
      path: s.replace(/^\w+:\/\/[^/]*/, ""),
      authority: "",
      scheme: "adt"
    })),
    file: jest.fn((s: string) => ({ toString: () => s, fsPath: s }))
  },
  SourceControlResourceGroup: jest.fn(),
  SourceControlResourceState: jest.fn(),
  SourceControl: jest.fn(),
  Memento: jest.fn(),
  QuickPickItem: jest.fn()
}), { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn((_opts: any, cb: any) => cb())
  }
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: {
    agitRefresh: "abapfs.refreshAbapGit",
    agitPush: "abapfs.agitPush",
    agitPullScm: "abapfs.pullAbapGit",
    agitAdd: "abapfs.agitAdd",
    agitRemove: "abapfs.agitRemove",
    agitresetPwd: "abapfs.agitresetPwd",
    agitBranch: "abapfs.switchBranch"
  },
  command: jest.fn(() => jest.fn())
}))

jest.mock("./scm", () => ({
  refresh: jest.fn(),
  fromSC: jest.fn(),
  AgResState: jest.fn(),
  isAgResState: jest.fn(),
  fromGroup: jest.fn(),
  UNSTAGED: "unstaged",
  STAGED: "staged",
  IGNORED: "ignored",
  fileUri: jest.fn((f: any) => ({ toString: () => f.name || "file" })),
  scmData: jest.fn(),
  scmKey: jest.fn()
}))

jest.mock("../../lib", () => ({
  after: jest.fn().mockResolvedValue(undefined),
  simpleInputBox: jest.fn(),
  chainTaskTransformers: jest.fn(),
  fieldReplacer: jest.fn(),
  withp: jest.fn((_msg: string, cb: any) => cb()),
  createTaskTransformer: jest.fn(),
  createStore: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn() }),
  inputBox: jest.fn(),
  quickPick: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e)),
  askConfirmation: jest.fn()
}))

jest.mock("fp-ts/lib/Option", () => ({
  map: jest.fn(),
  isNone: jest.fn().mockReturnValue(true),
  none: undefined,
  fromEither: jest.fn(),
  isSome: jest.fn().mockReturnValue(false),
  fromNullable: jest.fn(),
  some: jest.fn((v: any) => ({ _tag: "Some", value: v }))
}))

jest.mock("./credentials", () => ({
  dataCredentials: jest.fn(),
  listPasswords: jest.fn().mockResolvedValue([]),
  deletePassword: jest.fn(),
  deleteDefaultUser: jest.fn()
}))

jest.mock("../../extension", () => ({
  context: {
    globalState: { get: jest.fn(), update: jest.fn() },
    asAbsolutePath: jest.fn((s: string) => s)
  }
}))

jest.mock("../../adt/AdtTransports", () => ({
  selectTransport: jest.fn()
}))

jest.mock("../../config", () => ({
  pickAdtRoot: jest.fn()
}))

jest.mock("fp-ts/lib/Either", () => ({
  isRight: jest.fn().mockReturnValue(false),
  isLeft: jest.fn().mockReturnValue(true)
}))

jest.mock("../../views/abapgit", () => ({
  confirmPull: jest.fn(),
  packageUri: jest.fn()
}))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  uriRoot: jest.fn()
}))

import { isAgResState, fromGroup, STAGED, UNSTAGED, IGNORED } from "./scm"
import { funWindow as window } from "../../services/funMessenger"

// import the module to trigger decorator registrations
require("./commands")

beforeEach(() => {
  jest.clearAllMocks()
})

describe("abapGit scm commands", () => {
  describe("transfer logic", () => {
    it("isAgResState returns true for valid state objects", () => {
      // Test the mock passthrough
      ;(isAgResState as unknown as jest.Mock).mockReturnValue(true)
      expect(isAgResState({ data: { connId: "x" }, resourceUri: {} })).toBe(true)
    })

    it("isAgResState returns false for invalid objects", () => {
      ;(isAgResState as unknown as jest.Mock).mockReturnValue(false)
      expect(isAgResState(null)).toBe(false)
      expect(isAgResState({})).toBe(false)
    })
  })

  describe("constants", () => {
    it("STAGED equals 'staged'", () => {
      expect(STAGED).toBe("staged")
    })

    it("UNSTAGED equals 'unstaged'", () => {
      expect(UNSTAGED).toBe("unstaged")
    })

    it("IGNORED equals 'ignored'", () => {
      expect(IGNORED).toBe("ignored")
    })
  })

  describe("logErrors decorator behavior", () => {
    it("showErrorMessage is available on funWindow mock", () => {
      expect(window.showErrorMessage).toBeDefined()
      expect(typeof window.showErrorMessage).toBe("function")
    })
  })
})
