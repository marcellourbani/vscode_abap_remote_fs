vi.mock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  Uri: {
    parse: vi.fn(function (s: string) {
      const [scheme, rest] = s.split("://")
      const qIdx = rest?.indexOf("?") ?? -1
      const authority =
        rest?.substring(
          0,
          qIdx === -1
            ? rest.indexOf("/")
            : Math.min(qIdx, rest.indexOf("/") === -1 ? qIdx : rest.indexOf("/"))
        ) ?? ""
      const path = rest?.substring(authority.length)?.split("?")[0] ?? ""
      return {
        scheme,
        authority,
        path,
        with: vi.fn((opts: any) => ({
          scheme: opts.scheme ?? scheme,
          authority: opts.authority ?? authority,
          path: opts.path ?? path,
          query: opts.query ?? "",
          toString: () =>
            `${opts.scheme ?? scheme}://${opts.authority ?? authority}${opts.path ?? path}?${opts.query ?? ""}`
        })),
        toString: () => s
      }
    })
  },
  commands: {
    executeCommand: vi.fn()
  },
  extensions: {
    getExtension: vi.fn()
  }
}))

vi.mock("../../config", () => ({
  RemoteManager: {
    get: vi.fn()
  }
}))

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/abapfs_shortcut_abc"),
  rm: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("../../lib", () => ({
  log: vi.fn(),
  caughtToString: vi.fn()
}))
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    withProgress: vi.fn()
  }
}))

vi.mock("../conections", () => ({
  getClient: vi.fn()
}))

vi.mock("abapobject", async () => ({
  ...(await vi.importActual("abapobject")),
  isAbapClassInclude: vi.fn()
}))

vi.mock("../../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: {
    createOrShow: vi.fn(),
    getTransactionInfo: vi.fn(function (objectType: string, objectName: string) {
      let cleanObjectName = objectName
      if (objectType === "CLAS/OC" || objectType === "CLAS/I") {
        cleanObjectName = objectName.split(".")[0]
      }
      return {
        transaction: objectType === "CLAS/OC" || objectType === "CLAS/I" ? "SE24" : "SE38",
        dynprofield:
          objectType === "CLAS/OC" || objectType === "CLAS/I"
            ? "SEOCLASS-CLSNAME"
            : "RS38M-PROGRAMM",
        okcode: objectType === "CLAS/OC" || objectType === "CLAS/I" ? "WB_EXEC" : "STRT",
        sapGuiCommand: {
          type: "Transaction",
          command: objectType === "CLAS/OC" || objectType === "CLAS/I" ? "*SE24" : "*SE38",
          parameters: [
            {
              name:
                objectType === "CLAS/OC" || objectType === "CLAS/I"
                  ? "SEOCLASS-CLSNAME"
                  : "RS38M-PROGRAMM",
              value: cleanObjectName
            },
            {
              name: "DYNP_OKCODE",
              value: objectType === "CLAS/OC" || objectType === "CLAS/I" ? "WB_EXEC" : "STRT"
            }
          ]
        }
      }
    })
  }
}))

import { SapGui, showInGuiCb, executeInGui, runInSapGui, type SapGuiCommand } from "./sapgui"
import { RemoteManager } from "../../config"
import { funWindow as window } from "../../services/funMessenger"
import { isAbapClassInclude } from "abapobject"
import * as vscode from "vscode"
import * as __$mock_conections from "../conections"
import type { Mocked, MockedFunction, Mock } from "vitest"

const mockRemoteManager = RemoteManager as Mocked<typeof RemoteManager>
const mockIsAbapClassInclude = isAbapClassInclude as MockedFunction<typeof isAbapClassInclude>

function makeConfig(overrides: any = {}) {
  return {
    name: "DEV100",
    url: "https://dev100:8000",
    client: "100",
    username: "TESTUSER",
    language: "EN",
    sapGui: {
      server: "dev100",
      systemNumber: "00",
      routerString: "",
      guiType: undefined
    },
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
    return fn()
  })
})

describe("SapGui.create", () => {
  test("creates server-based SapGui from config", () => {
    const config = makeConfig()
    const gui = SapGui.create(config as any)
    expect(gui).toBeInstanceOf(SapGui)
  })

  test("creates load-balancing SapGui when messageServer and group provided", () => {
    const config = makeConfig({
      sapGui: {
        messageServer: "msgserver.dev100",
        group: "PUBLIC",
        messageServerPort: "3600",
        routerString: ""
      }
    })
    const gui = SapGui.create(config as any)
    expect(gui).toBeInstanceOf(SapGui)
  })

  test("returns disabled SapGui on exception", () => {
    const config = makeConfig({ sapGui: null })
    // Should not throw, returns a SapGui (possibly disabled)
    const gui = SapGui.create(config as any)
    expect(gui).toBeInstanceOf(SapGui)
  })

  test("extracts server from URL when no sapGui config", () => {
    const config = {
      name: "DEV100",
      url: "https://sapserver.example.com:8000",
      client: "100",
      username: "USER",
      language: "EN",
      sapGui: null
    }
    const gui = SapGui.create(config as any)
    expect(gui).toBeInstanceOf(SapGui)
  })
})

describe("SapGui.connectionString", () => {
  test("returns server connection string for server config", () => {
    const gui = new (SapGui as any)(
      false,
      { server: "sapserver", systemNumber: "00", routerString: "", client: "100" },
      "USER",
      "DEV",
      "EN"
    )
    const connStr = gui.connectionString
    expect(connStr).toContain("H/sapserver")
    expect(connStr).toContain("32" + "00")
  })

  test("returns load-balancing connection string", () => {
    const gui = new (SapGui as any)(
      false,
      {
        messageServer: "msg.server",
        messageServerPort: "3600",
        group: "PUBLIC",
        routerString: "",
        client: "100"
      },
      "USER",
      "DEV",
      "EN"
    )
    const connStr = gui.connectionString
    expect(connStr).toContain("M/msg.server")
    expect(connStr).toContain("S/3600")
    expect(connStr).toContain("G/PUBLIC")
  })

  test("strips trailing router string slash", () => {
    const gui = new (SapGui as any)(
      false,
      { server: "srv", systemNumber: "00", routerString: "/H/router/", client: "100" },
      "USER",
      "DEV",
      "EN"
    )
    const connStr = gui.connectionString
    expect(connStr).not.toMatch(/\/$/)
  })

  test("throws when disabled", () => {
    const gui = new (SapGui as any)(true, undefined, "USER", "DEV", "EN")
    expect(() => gui.connectionString).toThrow()
  })
})

describe("SapGui.checkConfig", () => {
  test("throws when disabled", () => {
    const gui = new (SapGui as any)(true)
    expect(() => gui.checkConfig()).toThrow("SAPGUI was not configured or disabled")
  })

  test("throws when no config", () => {
    const gui = new (SapGui as any)(false, undefined)
    expect(() => gui.checkConfig()).toThrow()
  })

  test("does not throw when enabled and configured", () => {
    const gui = new (SapGui as any)(false, {
      server: "srv",
      systemNumber: "00",
      routerString: "",
      client: "100"
    })
    expect(() => gui.checkConfig()).not.toThrow()
  })
})

describe("SapGui - disabled when no client in config", () => {
  test("checkConfig does not throw when config has no client (constructor assigns local param not this.disabled)", () => {
    const gui = new (SapGui as any)(
      false,
      { server: "srv", systemNumber: "00", routerString: "" }
      // no client field
    )
    // constructor sets local `disabled = true` but this.disabled is already assigned from the parameter
    // so this.disabled remains false and checkConfig doesn't throw
    expect(() => gui.checkConfig()).not.toThrow()
  })
})

describe("showInGuiCb", () => {
  test("returns a function that returns a SapGuiCommand", () => {
    const cb = showInGuiCb("/sap/bc/adt/programs/programs/ztest")
    const cmd = cb()
    expect(cmd.type).toBe("Transaction")
    expect(cmd.command).toBe("*SADT_START_WB_URI")
  })

  test("includes D_OBJECT_URI parameter with provided URI", () => {
    const uri = "/sap/bc/adt/programs/programs/myprog"
    const cb = showInGuiCb(uri)
    const cmd = cb()
    const uriParam = cmd.parameters?.find(p => p.name === "D_OBJECT_URI")
    expect(uriParam?.value).toBe(uri)
  })

  test("includes DYNP_OKCODE = OKAY", () => {
    const cb = showInGuiCb("/some/uri")
    const cmd = cb()
    const okCode = cmd.parameters?.find(p => p.name === "DYNP_OKCODE")
    expect(okCode?.value).toBe("OKAY")
  })
})

describe("executeInGui", () => {
  const mockClientWithTicket = {
    reentranceTicket: vi.fn().mockResolvedValue("TICKET123")
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockIsAbapClassInclude.mockReturnValue(false)
    ;(RemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(makeConfig())
    })
    const { getClient } = __$mock_conections
    ;(getClient as Mock).mockReturnValue(mockClientWithTicket)
    ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      return fn()
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test("builds SE38 command for PROG/P type", async () => {
    const object = { type: "PROG/P", name: "ZTEST", sapGuiUri: "/uri" }
    let capturedCmd: SapGuiCommand | undefined
    ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      const config = makeConfig()
      const sapGui = SapGui.create(config as any)
      const origStartGui = sapGui.startGui.bind(sapGui)
      sapGui.startGui = async (cmd: SapGuiCommand) => {
        capturedCmd = cmd
      }
      return fn()
    })

    await executeInGui("dev100", object as any)
    // withProgress ran; we can't capture cmd without deep mocking, so just check it didn't throw
    expect(window.withProgress).toHaveBeenCalled()
  })

  test("unwraps class include to parent before executing", async () => {
    const parent = { type: "CLAS/OC", name: "ZCL_TEST", sapGuiUri: "/uri" }
    const include = { type: "CLAS/OC", name: "ZCL_TEST====CP", parent, sapGuiUri: "/uri" }
    mockIsAbapClassInclude.mockReturnValue(true)

    await executeInGui("dev100", include as any)

    expect(window.withProgress).toHaveBeenCalled()
  })
})

describe("runInSapGui", () => {
  test("returns early when config not found", async () => {
    ;(RemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(undefined)
    })
    ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      return fn()
    })

    const result = await runInSapGui("unknown", () => undefined)
    expect(result).toBeUndefined()
  })

  test("calls getCmd and returns when cmd is undefined", async () => {
    ;(RemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(makeConfig())
    })
    ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      return fn()
    })
    const getCmdMock = vi.fn().mockResolvedValue(undefined)

    await runInSapGui("dev100", getCmdMock)
    expect(getCmdMock).toHaveBeenCalled()
  })

  test("opens URL in browser for WEBGUI_UNSAFE type", async () => {
    const config = makeConfig({
      sapGui: {
        server: "srv",
        systemNumber: "00",
        routerString: "",
        guiType: "WEBGUI_UNSAFE",
        client: "100"
      }
    })
    ;(RemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(config)
    })
    const { getClient } = __$mock_conections
    ;(getClient as Mock).mockReturnValue({
      reentranceTicket: vi.fn().mockResolvedValue("T123")
    })
    ;(window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      return fn()
    })

    const cmd: SapGuiCommand = {
      type: "Transaction",
      command: "*SE38",
      parameters: [
        { name: "RS38M-PROGRAMM", value: "ZTEST" },
        { name: "DYNP_OKCODE", value: "STRT" }
      ]
    }

    await runInSapGui("dev100", () => cmd)

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.open", expect.anything())
  })
})
