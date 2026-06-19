jest.mock("vscode", () => ({
  commands: { executeCommand: jest.fn() },
  ProgressLocation: { Notification: 15 },
  Uri: { parse: jest.fn((s: string) => ({ toString: () => s })) },
  workspace: { openTextDocument: jest.fn() },
  Selection: jest.fn((start: any, end: any) => ({ start, end })),
  WorkspaceEdit: jest.fn().mockImplementation(() => ({ insert: jest.fn() })),
  Position: jest.fn((line: number, character: number) => ({ line, character }))
}), { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showTextDocument: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn((_opts: any, cb: any) => cb())
  }
}))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

jest.mock("../../config", () => ({
  RemoteManager: { get: jest.fn().mockReturnValue({ byId: jest.fn() }) }
}))

jest.mock("../../lib", () => ({
  chainTaskTransformers: jest.fn(),
  fieldReplacer: jest.fn(),
  inputBox: jest.fn(),
  quickPick: jest.fn(),
  rfsExtract: jest.fn(),
  rfsTryCatch: jest.fn(),
  showErrorMessage: jest.fn()
}))

jest.mock("./documentation", () => ({
  ATCDocumentation: {
    get: jest.fn().mockReturnValue({ showDocumentation: jest.fn() })
  }
}))

jest.mock("./view", () => ({
  AtcFind: jest.fn().mockImplementation(function (this: any, finding: any, parent: any, uri: string, start: any) {
    this.finding = finding
    this.parent = parent
    this.uri = uri
    this.start = start
  }),
  AtcSystem: jest.fn().mockImplementation(function (this: any) {
    this.refresh = jest.fn()
  }),
  AtcObject: jest.fn().mockImplementation(function (this: any) {
    this.parent = { refresh: jest.fn() }
  }),
  AtcRoot: jest.fn().mockImplementation(function (this: any) {
    this.children = []
  }),
  atcProvider: {
    root: { children: [] },
    setAutoRefresh: jest.fn(),
    setExemptFilter: jest.fn()
  }
}))

jest.mock("./codeinspector", () => ({
  findingPragmas: jest.fn()
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: {
    openLocation: "openLocation",
    atcIgnore: "atcIgnore",
    atcAutoRefreshOn: "atcAutoRefreshOn",
    atcAutoRefreshOff: "atcAutoRefreshOff",
    atcFilterExemptOn: "atcFilterExemptOn",
    atcFilterExemptOff: "atcFilterExemptOff",
    atcRequestExemption: "atcRequestExemption",
    atcRefresh: "atcRefresh",
    atcRequestExemptionAll: "atcRequestExemptionAll",
    atcShowDocumentation: "atcShowDocumentation"
  },
  command: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor
}))

jest.mock("./functions", () => ({
  insertPosition: jest.fn().mockReturnValue(10)
}))

import { atcRefresh } from "./commands"
import { AtcSystem, AtcObject, AtcFind, AtcRoot, atcProvider } from "./view"
import { showErrorMessage } from "../../lib"
import { funWindow as window } from "../../services/funMessenger"

const mockShowError = showErrorMessage as jest.MockedFunction<typeof showErrorMessage>

describe("atcRefresh", () => {
  beforeEach(() => jest.clearAllMocks())

  it("refreshes all root children when called with no arguments", async () => {
    const mockRefresh = jest.fn().mockResolvedValue(undefined)
    ;(atcProvider.root as any).children = [{ refresh: mockRefresh }, { refresh: mockRefresh }]

    await atcRefresh()

    expect(window.withProgress).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it("refreshes a single AtcSystem when passed one", async () => {
    const system = new (AtcSystem as any)()
    system.refresh = jest.fn().mockResolvedValue(undefined)
    system.constructor = AtcSystem
    Object.setPrototypeOf(system, (AtcSystem as any).prototype)

    await atcRefresh(system)
    expect(system.refresh).toHaveBeenCalled()
  })

  it("does not throw on empty root children", async () => {
    ;(atcProvider.root as any).children = []
    await expect(atcRefresh()).resolves.toBeUndefined()
  })

  it("calls showErrorMessage on exception", async () => {
    ;(window.withProgress as jest.Mock).mockRejectedValueOnce(new Error("boom"))
    await atcRefresh()
    expect(mockShowError).toHaveBeenCalled()
  })
})
