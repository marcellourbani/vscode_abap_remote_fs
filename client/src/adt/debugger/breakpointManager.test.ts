jest.mock("abap-adt-api", () => ({
  isDebuggerBreakpoint: jest.fn((bp: any) => bp && bp.__isDebuggerBP === true)
}))
jest.mock("abapfs", () => ({
  isAbapFile: jest.fn((node: any) => node && node.__isAbapFile === true)
}))
jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: "adt", path: s.replace(/^adt:\/\/[^/]+/, ""), toString: () => s }))
  }
}), { virtual: true })
jest.mock("@vscode/debugadapter", () => ({
  Breakpoint: jest.fn().mockImplementation((verified: boolean, line?: number) => ({
    verified, line
  })),
  Source: jest.fn().mockImplementation((name: string, path: string) => ({ name, path }))
}))
jest.mock("../../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  ignore: jest.fn(),
  isDefined: jest.fn((x: any) => x !== undefined && x !== null),
  log: jest.fn()
}))
jest.mock("../conections", () => ({
  getClient: jest.fn(),
  getRoot: jest.fn()
}))
jest.mock("./debugListener", () => ({}))
jest.mock("./debugService", () => ({}))

import { BreakpointManager } from "./breakpointManager"
import { isDebuggerBreakpoint } from "abap-adt-api"
import { isAbapFile } from "abapfs"
import { getClient, getRoot } from "../conections"

const mockIsDebuggerBP = isDebuggerBreakpoint as jest.MockedFunction<typeof isDebuggerBreakpoint>
const mockIsAbapFile = isAbapFile as jest.MockedFunction<typeof isAbapFile>
const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockGetRoot = getRoot as jest.MockedFunction<typeof getRoot>

function makeListener(overrides: Partial<any> = {}) {
  return {
    connId: "TST",
    mode: "user" as const,
    ideId: "IDEABC",
    terminalId: "TERM123",
    username: "TESTUSER",
    activeServices: jest.fn(() => []),
    ...overrides
  } as any
}

function makeStatelessClient(overrides: Partial<any> = {}) {
  return {
    debuggerDeleteBreakpoints: jest.fn().mockResolvedValue(undefined),
    debuggerSetBreakpoints: jest.fn().mockResolvedValue([]),
    ...overrides
  }
}

function makeAdtClient(overrides: Partial<any> = {}) {
  const stateless = makeStatelessClient(overrides.statelessClone)
  return {
    statelessClone: stateless,
    debuggerDeleteBreakpoints: jest.fn().mockResolvedValue(undefined),
    debuggerSetBreakpoints: jest.fn().mockResolvedValue([]),
    ...overrides
  }
}

function makeAbapNode(overrides: Partial<any> = {}) {
  return {
    __isAbapFile: true,
    object: {
      structure: {},
      contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/ZPROG"),
      loadStructure: jest.fn().mockResolvedValue(undefined),
      mainPrograms: jest.fn().mockResolvedValue([]),
      name: "ZPROG"
    },
    ...overrides
  }
}

describe("BreakpointManager", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("getBreakpoints", () => {
    test("returns empty array for unknown path", () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      expect(bpm.getBreakpoints("/unknown/path")).toEqual([])
    })
  })

  describe("setBreakpoints", () => {
    test("returns empty array when source has no path", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      const result = await bpm.setBreakpoints({} as any, [{ line: 10 }])
      expect(result).toEqual([])
    })

    test("returns empty array when node is not an ABAP file", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)

      const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue({ __isAbapFile: false }) }
      mockGetRoot.mockReturnValueOnce(mockRoot as any)
      mockIsAbapFile.mockReturnValueOnce(false)

      const result = await bpm.setBreakpoints(
        { path: "adt://TST/sap/bc/adt/programs/programs/ZPROG" },
        [{ line: 10 }]
      )
      expect(result).toEqual([])
    })

    test("stores breakpoints after successful sync", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      const node = makeAbapNode()
      const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue(node) }
      mockGetRoot.mockReturnValueOnce(mockRoot as any)
      mockIsAbapFile.mockReturnValueOnce(true)

      const fakeBp = { __isDebuggerBP: true, uri: { range: { start: { line: 10 } } } }
      mockIsDebuggerBP.mockReturnValue(true)
      const adtClient = makeAdtClient({
        statelessClone: makeStatelessClient({
          debuggerSetBreakpoints: jest.fn().mockResolvedValue([fakeBp])
        })
      })
      mockGetClient.mockReturnValueOnce(adtClient as any)

      const path = "adt://TST/sap/bc/adt/programs/programs/ZPROG"
      const bps = await bpm.setBreakpoints({ path, name: "ZPROG" }, [{ line: 10 }])
      expect(bpm.getBreakpoints(path)).toHaveLength(1)
    })

    test("returns unverified breakpoints when server returns none", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      const node = makeAbapNode()
      const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue(node) }
      mockGetRoot.mockReturnValueOnce(mockRoot as any)
      mockIsAbapFile.mockReturnValueOnce(true)
      mockIsDebuggerBP.mockReturnValue(false)
      const adtClient = makeAdtClient({
        statelessClone: makeStatelessClient({
          debuggerSetBreakpoints: jest.fn().mockResolvedValue([])
        })
      })
      mockGetClient.mockReturnValueOnce(adtClient as any)

      const path = "adt://TST/sap/bc/adt/programs/programs/ZPROG"
      const bps = await bpm.setBreakpoints({ path, name: "ZPROG" }, [{ line: 5 }])
      // syncBreakpoints returns one AdtBreakpoint per input breakpoint, unverified when no match found
      expect(bps).toHaveLength(1)
      expect(bps[0].verified).toBe(false)
    })

    test("handles exception in syncBreakpoints gracefully", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      const node = makeAbapNode()
      const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue(node) }
      mockGetRoot.mockReturnValueOnce(mockRoot as any)
      mockIsAbapFile.mockReturnValueOnce(true)
      const adtClient = makeAdtClient({
        statelessClone: makeStatelessClient({
          debuggerSetBreakpoints: jest.fn().mockRejectedValue(new Error("network error"))
        })
      })
      mockGetClient.mockReturnValueOnce(adtClient as any)

      const path = "adt://TST/sap/bc/adt/programs/programs/ZPROG"
      const result = await bpm.setBreakpoints({ path, name: "ZPROG" }, [{ line: 5 }])
      // The rejection is caught by .then(_, () => []), so syncBreakpoints continues
      // and returns unverified breakpoints (one per input breakpoint)
      expect(result).toHaveLength(1)
      expect(result[0].verified).toBe(false)
    })
  })

  describe("removeAllBreakpoints", () => {
    test("does nothing when no breakpoints stored", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)
      const thread = { client: makeAdtClient() } as any
      await expect(bpm.removeAllBreakpoints(thread)).resolves.not.toThrow()
    })

    test("calls deleteBreakpoints for each stored ADT breakpoint", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)

      // Manually seed the internal map by spying on setBreakpoints
      const path = "/some/path"
      const fakeBp = {
        __isDebuggerBP: true,
        adtBp: { uri: { range: { start: { line: 10 } } } },
        verified: true
      }
      // Inject via getBreakpoints by going through setBreakpoints route
      // Using internal access via any cast
      ;(bpm as any).breakpoints.set(path, [fakeBp])

      const mockDeleteBp = jest.fn().mockResolvedValue(undefined)
      const thread = {
        client: {
          debuggerDeleteBreakpoints: mockDeleteBp
        }
      } as any

      await bpm.removeAllBreakpoints(thread)
      expect(mockDeleteBp).toHaveBeenCalled()
    })
  })

  describe("include breakpoint URI handling", () => {
    test("builds VIT URI for includes (with mainPrograms)", async () => {
      const listener = makeListener()
      const bpm = new BreakpointManager(listener)

      const mainProg = { "adtcore:name": "ZMAINPROG" }
      const node = makeAbapNode({
        object: {
          structure: {},
          contentsPath: jest.fn(() => "/sap/bc/adt/programs/includes/ZINCLUDE"),
          loadStructure: jest.fn().mockResolvedValue(undefined),
          mainPrograms: jest.fn().mockResolvedValue([mainProg]),
          name: "ZINCLUDE"
        }
      })
      const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue(node) }
      mockGetRoot.mockReturnValueOnce(mockRoot as any)
      mockIsAbapFile.mockReturnValueOnce(true)
      mockIsDebuggerBP.mockReturnValue(false)
      const adtClient = makeAdtClient({
        statelessClone: makeStatelessClient({
          debuggerSetBreakpoints: jest.fn().mockResolvedValue([])
        })
      })
      mockGetClient.mockReturnValueOnce(adtClient as any)

      const path = "adt://TST/sap/bc/adt/programs/includes/ZINCLUDE"
      await bpm.setBreakpoints({ path, name: "ZINCLUDE" }, [{ line: 20 }])

      const setCall = adtClient.statelessClone.debuggerSetBreakpoints.mock.calls[0]
      // The 5th argument (bps array) should contain VIT URI
      const bpsArg: string[] = setCall[4]
      expect(bpsArg[0]).toContain("/sap/bc/adt/vit/wb/object_type/")
    })
  })
})
