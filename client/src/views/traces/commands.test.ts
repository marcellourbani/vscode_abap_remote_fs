jest.mock("vscode", () => ({
  commands: { registerCommand: jest.fn() },
  Uri: {
    parse: (s: string) => ({ authority: "", path: s, scheme: "file", fsPath: s, toString: () => s })
  }
}), { virtual: true })

jest.mock("../../commands", () => ({
  AbapFsCommands: {
    refreshTraces: "abapfs.refreshTraces",
    deleteTrace: "abapfs.deleteTrace"
  },
  command: () => () => {} // decorator that does nothing in tests
}))

jest.mock("./views", () => {
  const emitterFire = jest.fn()
  return {
    tracesProvider: {
      emitter: { fire: emitterFire },
      root: jest.fn()
    },
    TraceRunItem: jest.fn()
  }
})

jest.mock("./fsProvider", () => ({
  adtProfileUri: jest.fn(() => ({
    scheme: "adt-trace",
    fsPath: "/trace/profile",
    toString: () => "adt-trace:/trace/profile"
  }))
}))

jest.mock("../../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))

import { Commands, openCommand } from "./commands"
import { tracesProvider } from "./views"
import { getOrCreateClient } from "../../adt/conections"

describe("openCommand", () => {
  it("returns a Command with 'Open' title", () => {
    const uri = { scheme: "file", fsPath: "/test" } as any
    const result = openCommand(uri)
    expect(result.title).toBe("Open")
  })

  it("uses vscode.open command", () => {
    const uri = { scheme: "file", fsPath: "/test" } as any
    const result = openCommand(uri)
    expect(result.command).toBe("vscode.open")
  })

  it("passes uri as first argument", () => {
    const uri = { scheme: "adt-trace", fsPath: "/trace" } as any
    const result = openCommand(uri)
    expect(result.arguments).toEqual([uri])
  })

  it("arguments array has exactly one element", () => {
    const uri = {} as any
    const result = openCommand(uri)
    expect(result.arguments).toHaveLength(1)
  })
})

describe("Commands class", () => {
  let cmds: Commands

  beforeEach(() => {
    jest.clearAllMocks()
    cmds = new Commands()
  })

  describe("openTrace (refreshTraces handler)", () => {
    // The openTrace method is private but decorated with @command.
    // We can test it indirectly by accessing it through prototype.
    const openTrace = (Commands.prototype as any).openTrace

    it("fires emitter for 'configfolder' contextValue", async () => {
      const view = { contextValue: "configfolder" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(view)
    })

    it("fires emitter for 'runfolder' contextValue", async () => {
      const view = { contextValue: "runfolder" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(view)
    })

    it("fires emitter for 'system' contextValue", async () => {
      const view = { contextValue: "system" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(view)
    })

    it("does NOT fire emitter for 'run' contextValue", async () => {
      const view = { contextValue: "run" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).not.toHaveBeenCalled()
    })

    it("does NOT fire emitter for 'configuration' contextValue", async () => {
      const view = { contextValue: "configuration" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).not.toHaveBeenCalled()
    })

    it("does NOT fire emitter for unknown contextValue", async () => {
      const view = { contextValue: "unknown" } as any
      await openTrace.call(cmds, view)
      expect(tracesProvider.emitter.fire).not.toHaveBeenCalled()
    })
  })

  describe("deleteTraces (deleteTrace handler)", () => {
    const deleteTraces = (Commands.prototype as any).deleteTraces

    it("deletes a trace run and refreshes runs folder", async () => {
      const mockClient = { tracesDelete: jest.fn().mockResolvedValue(undefined) }
      ;(getOrCreateClient as jest.Mock).mockResolvedValue(mockClient)
      const runsFolder = { contextValue: "runfolder" }
      ;(tracesProvider.root as jest.Mock).mockReturnValue({ runs: runsFolder })

      const item = {
        contextValue: "run",
        connId: "dev100",
        run: { id: "trace-run-123" }
      } as any

      await deleteTraces.call(cmds, item)

      expect(getOrCreateClient).toHaveBeenCalledWith("dev100")
      expect(mockClient.tracesDelete).toHaveBeenCalledWith("trace-run-123")
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(runsFolder)
    })

    it("deletes a trace configuration and refreshes configs folder", async () => {
      const mockClient = { tracesDeleteConfiguration: jest.fn().mockResolvedValue(undefined) }
      ;(getOrCreateClient as jest.Mock).mockResolvedValue(mockClient)
      const configsFolder = { contextValue: "configfolder" }
      ;(tracesProvider.root as jest.Mock).mockReturnValue({ configs: configsFolder })

      const item = {
        contextValue: "configuration",
        connId: "dev100",
        config: { id: "trace-config-456" }
      } as any

      await deleteTraces.call(cmds, item)

      expect(getOrCreateClient).toHaveBeenCalledWith("dev100")
      expect(mockClient.tracesDeleteConfiguration).toHaveBeenCalledWith("trace-config-456")
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(configsFolder)
    })

    it("does nothing for non-run, non-configuration items", async () => {
      const item = { contextValue: "system", connId: "dev100" } as any
      await deleteTraces.call(cmds, item)
      expect(getOrCreateClient).not.toHaveBeenCalled()
    })

    it("propagates client errors on run deletion", async () => {
      const mockClient = {
        tracesDelete: jest.fn().mockRejectedValue(new Error("delete failed"))
      }
      ;(getOrCreateClient as jest.Mock).mockResolvedValue(mockClient)

      const item = {
        contextValue: "run",
        connId: "dev100",
        run: { id: "bad-id" }
      } as any

      await expect(deleteTraces.call(cmds, item)).rejects.toThrow("delete failed")
    })

    it("propagates client errors on configuration deletion", async () => {
      const mockClient = {
        tracesDeleteConfiguration: jest.fn().mockRejectedValue(new Error("config delete failed"))
      }
      ;(getOrCreateClient as jest.Mock).mockResolvedValue(mockClient)

      const item = {
        contextValue: "configuration",
        connId: "dev100",
        config: { id: "bad-id" }
      } as any

      await expect(deleteTraces.call(cmds, item)).rejects.toThrow("config delete failed")
    })

    it("handles tracesProvider.root returning undefined", async () => {
      const mockClient = { tracesDelete: jest.fn().mockResolvedValue(undefined) }
      ;(getOrCreateClient as jest.Mock).mockResolvedValue(mockClient)
      ;(tracesProvider.root as jest.Mock).mockReturnValue(undefined)

      const item = {
        contextValue: "run",
        connId: "dev100",
        run: { id: "some-id" }
      } as any

      // tracesProvider.root(connId)?.runs evaluates to undefined
      // emitter.fire(undefined) should still be called
      await deleteTraces.call(cmds, item)
      expect(mockClient.tracesDelete).toHaveBeenCalledWith("some-id")
      expect(tracesProvider.emitter.fire).toHaveBeenCalledWith(undefined)
    })
  })
})
