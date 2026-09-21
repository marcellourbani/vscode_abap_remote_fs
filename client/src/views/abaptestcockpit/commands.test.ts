vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn() },
  ProgressLocation: { Notification: 15 },
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s }
    })
  },
  workspace: { openTextDocument: vi.fn() },
  Selection: vi.fn(function (start: any, end: any) {
    return { start, end }
  }),
  WorkspaceEdit: vi.fn().mockImplementation(function () {
    return { insert: vi.fn() }
  }),
  Position: vi.fn(function (line: number, character: number) {
    return { line, character }
  })
}))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    showTextDocument: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(function (_opts: any, cb: any) {
      return cb()
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn()
}))

vi.mock("../../config", () => ({
  RemoteManager: { get: vi.fn().mockReturnValue({ byId: vi.fn() }) }
}))

vi.mock("../../lib", () => ({
  chainTaskTransformers: vi.fn(),
  fieldReplacer: vi.fn(),
  inputBox: vi.fn(),
  quickPick: vi.fn(),
  rfsExtract: vi.fn(),
  rfsTryCatch: vi.fn(),
  showErrorMessage: vi.fn()
}))

vi.mock("./documentation", () => ({
  ATCDocumentation: {
    get: vi.fn().mockReturnValue({ showDocumentation: vi.fn() })
  }
}))

vi.mock("./view", () => ({
  AtcFind: vi.fn().mockImplementation(function (
    this: any,
    finding: any,
    parent: any,
    uri: string,
    start: any
  ) {
    this.finding = finding
    this.parent = parent
    this.uri = uri
    this.start = start
  }),
  AtcSystem: vi.fn().mockImplementation(function (this: any) {
    this.refresh = vi.fn()
  }),
  AtcObject: vi.fn().mockImplementation(function (this: any) {
    this.parent = { refresh: vi.fn() }
  }),
  AtcRoot: vi.fn().mockImplementation(function (this: any) {
    this.children = []
  }),
  atcProvider: {
    root: { children: [] },
    setAutoRefresh: vi.fn(),
    setExemptFilter: vi.fn()
  }
}))

vi.mock("./codeinspector", () => ({
  findingPragmas: vi.fn()
}))

vi.mock("../../commands", () => ({
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

vi.mock("./functions", () => ({
  insertPosition: vi.fn().mockReturnValue(10)
}))

import { atcRefresh } from "./commands"
import { AtcSystem, AtcObject, AtcFind, AtcRoot, atcProvider } from "./view"
import { showErrorMessage } from "../../lib"
import { funWindow as window } from "../../services/funMessenger"
import type { MockedFunction, Mock } from "vitest"

const mockShowError = showErrorMessage as MockedFunction<typeof showErrorMessage>

describe("atcRefresh", () => {
  beforeEach(() => vi.clearAllMocks())

  it("refreshes all root children when called with no arguments", async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined)
    ;(atcProvider.root as any).children = [{ refresh: mockRefresh }, { refresh: mockRefresh }]

    await atcRefresh()

    expect(window.withProgress).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it("refreshes a single AtcSystem when passed one", async () => {
    const system = new (AtcSystem as any)()
    system.refresh = vi.fn().mockResolvedValue(undefined)
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
    ;(window.withProgress as Mock).mockRejectedValueOnce(new Error("boom"))
    await atcRefresh()
    expect(mockShowError).toHaveBeenCalled()
  })
})
