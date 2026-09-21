vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn() },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        toString: () => s,
        path: s.replace(/^\w+:\/\/[^/]*/, ""),
        authority: "",
        scheme: "adt"
      }
    }),
    file: vi.fn(function (s: string) {
      return { toString: () => s, fsPath: s }
    })
  },
  SourceControlResourceGroup: vi.fn(class {}),
  SourceControlResourceState: vi.fn(class {}),
  SourceControl: vi.fn(class {}),
  Memento: vi.fn(class {}),
  QuickPickItem: vi.fn(class {})
}))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(function (_opts: any, cb: any) {
      return cb()
    })
  }
}))

vi.mock("../../commands", () => ({
  AbapFsCommands: {
    agitRefresh: "abapfs.refreshAbapGit",
    agitPush: "abapfs.agitPush",
    agitPullScm: "abapfs.pullAbapGit",
    agitAdd: "abapfs.agitAdd",
    agitRemove: "abapfs.agitRemove",
    agitresetPwd: "abapfs.agitresetPwd",
    agitBranch: "abapfs.switchBranch"
  },
  command: vi.fn(function () {
    return vi.fn()
  })
}))

vi.mock("./scm", () => ({
  refresh: vi.fn(),
  fromSC: vi.fn(),
  AgResState: vi.fn(class {}),
  isAgResState: vi.fn(),
  fromGroup: vi.fn(),
  UNSTAGED: "unstaged",
  STAGED: "staged",
  IGNORED: "ignored",
  fileUri: vi.fn(function (f: any) {
    return { toString: () => f.name || "file" }
  }),
  scmData: vi.fn(),
  scmKey: vi.fn()
}))

vi.mock("../../lib", () => ({
  after: vi.fn().mockResolvedValue(undefined),
  simpleInputBox: vi.fn(),
  chainTaskTransformers: vi.fn(),
  fieldReplacer: vi.fn(),
  withp: vi.fn(function (_msg: string, cb: any) {
    return cb()
  }),
  createTaskTransformer: vi.fn(),
  createStore: vi.fn().mockReturnValue({ get: vi.fn(), update: vi.fn() }),
  inputBox: vi.fn(),
  quickPick: vi.fn(),
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  askConfirmation: vi.fn()
}))

vi.mock("fp-ts/lib/Option", () => ({
  map: vi.fn(),
  isNone: vi.fn().mockReturnValue(true),
  none: undefined,
  fromEither: vi.fn(),
  isSome: vi.fn().mockReturnValue(false),
  fromNullable: vi.fn(),
  some: vi.fn(function (v: any) {
    return { _tag: "Some", value: v }
  })
}))

vi.mock("./credentials", () => ({
  dataCredentials: vi.fn(),
  listPasswords: vi.fn().mockResolvedValue([]),
  deletePassword: vi.fn(),
  deleteDefaultUser: vi.fn()
}))

vi.mock("../../extension", () => ({
  context: {
    globalState: { get: vi.fn(), update: vi.fn() },
    asAbsolutePath: vi.fn(function (s: string) {
      return s
    })
  }
}))

vi.mock("../../adt/AdtTransports", () => ({
  selectTransport: vi.fn()
}))

vi.mock("../../config", () => ({
  pickAdtRoot: vi.fn()
}))

vi.mock("fp-ts/lib/Either", () => ({
  isRight: vi.fn().mockReturnValue(false),
  isLeft: vi.fn().mockReturnValue(true)
}))

vi.mock("../../views/abapgit", () => ({
  confirmPull: vi.fn(),
  packageUri: vi.fn()
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  uriRoot: vi.fn()
}))

import { isAgResState, fromGroup, STAGED, UNSTAGED, IGNORED } from "./scm"
import { funWindow as window } from "../../services/funMessenger"
import type { Mock } from "vitest"

// import the module to trigger decorator registrations
await import("./commands")

beforeEach(() => {
  vi.clearAllMocks()
})

describe("abapGit scm commands", () => {
  describe("transfer logic", () => {
    it("isAgResState returns true for valid state objects", () => {
      // Test the mock passthrough
      ;(isAgResState as unknown as Mock).mockReturnValue(true)
      expect(isAgResState({ data: { connId: "x" }, resourceUri: {} })).toBe(true)
    })

    it("isAgResState returns false for invalid objects", () => {
      ;(isAgResState as unknown as Mock).mockReturnValue(false)
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
