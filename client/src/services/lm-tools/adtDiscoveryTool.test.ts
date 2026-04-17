jest.mock("vscode", () => {
  class LanguageModelToolResult { constructor(public parts: any[]) {} }
  class LanguageModelTextPart { constructor(public text: string) {} }
  class MarkdownString { constructor(public value: string) {} }
  return {
    LanguageModelToolResult,
    LanguageModelTextPart,
    MarkdownString,
    lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: "/test", scheme: "file" } }
      ],
      fs: {
        writeFile: jest.fn().mockResolvedValue(undefined),
        createDirectory: jest.fn().mockResolvedValue(undefined)
      }
    },
    Uri: {
      parse: (s: string) => ({ authority: "", path: s, scheme: "file", fsPath: s, toString: () => s }),
      file: (s: string) => ({ fsPath: s, scheme: "file", toString: () => s }),
      joinPath: jest.fn((...args: any[]) => ({
        fsPath: args.map((a: any) => a.fsPath || a).join("/"),
        toString: () => args.map((a: any) => a.fsPath || a).join("/")
      }))
    }
  }
}, { virtual: true })

jest.mock("../../adt/conections", () => ({ getClient: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))

import { AdtDiscoveryTool } from "./adtDiscoveryTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any) {
  return { input } as any
}

/** Extract text from the mock LanguageModelToolResult */
function resultText(result: any): string {
  return result.parts[0].text
}

const mockClient = {
  adtDiscovery: jest.fn(),
  adtCoreDiscovery: jest.fn(),
  runQuery: jest.fn()
}

describe("AdtDiscoveryTool", () => {
  let tool: AdtDiscoveryTool

  beforeEach(() => {
    tool = new AdtDiscoveryTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
  })

  describe("prepareInvocation", () => {
    it("includes connectionId in invocationMessage", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("dev100")
    })

    it("includes uppercase connectionId literally", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ connectionId: "DEV100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("DEV100")
    })

    it("message contains 'Exporting ADT discovery'", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ connectionId: "sys" }),
        mockToken
      )
      expect(result.invocationMessage).toMatch(/exporting adt discovery/i)
    })
  })

  describe("invoke", () => {
    const minimalDiscovery = [
      {
        title: "WS1",
        collection: [
          {
            href: "/sap/bc/adt/something",
            title: "Col1",
            templateLinks: [
              { rel: "self", template: "/sap/bc/adt/{id}" }
            ]
          }
        ]
      }
    ]
    const minimalCoreDiscovery = [
      {
        title: "Core1",
        collection: { href: "/sap/bc/adt/core/foo", title: "Foo", category: "cat1" }
      }
    ]

    beforeEach(() => {
      mockClient.adtDiscovery.mockResolvedValue(minimalDiscovery)
      mockClient.adtCoreDiscovery.mockResolvedValue(minimalCoreDiscovery)
      mockClient.runQuery.mockResolvedValue({ values: [] })
    })

    it("throws when connectionId is empty string", async () => {
      await expect(
        tool.invoke(makeOptions({ connectionId: "" }), mockToken)
      ).rejects.toThrow("connectionId is required")
    })

    it("throws when connectionId is undefined", async () => {
      await expect(
        tool.invoke(makeOptions({ connectionId: undefined }), mockToken)
      ).rejects.toThrow()
    })

    it("lowercases connectionId when calling getClient", async () => {
      await tool.invoke(makeOptions({ connectionId: "DEV100" }), mockToken)
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("calls getClient with already-lowercase id", async () => {
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("logs telemetry on invocation", async () => {
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_adt_discovery_called")
    })

    it("calls adtDiscovery and adtCoreDiscovery", async () => {
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(mockClient.adtDiscovery).toHaveBeenCalled()
      expect(mockClient.adtCoreDiscovery).toHaveBeenCalled()
    })

    it("calls discovery endpoints in parallel via Promise.all", async () => {
      // Both should be called before either resolves (parallel behavior)
      let discoveryResolved = false
      let coreResolved = false
      mockClient.adtDiscovery.mockImplementation(
        () => new Promise(r => setTimeout(() => { discoveryResolved = true; r(minimalDiscovery) }, 10))
      )
      mockClient.adtCoreDiscovery.mockImplementation(
        () => new Promise(r => setTimeout(() => { coreResolved = true; r(minimalCoreDiscovery) }, 10))
      )

      const resultPromise = tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      // Both should have been kicked off before waiting
      expect(mockClient.adtDiscovery).toHaveBeenCalledTimes(1)
      expect(mockClient.adtCoreDiscovery).toHaveBeenCalledTimes(1)
      await resultPromise
    })

    it("queries SEOMETAREL for RES_APP classes", async () => {
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(mockClient.runQuery).toHaveBeenCalled()
      const firstCall = (mockClient.runQuery as jest.Mock).mock.calls[0][0] as string
      expect(firstCall).toContain("SEOMETAREL")
      expect(firstCall).toContain("CL_ADT_DISC_RES_APP_BASE")
    })

    it("makes second query for CL_ADT_RES_APP_BASE", async () => {
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(mockClient.runQuery).toHaveBeenCalledTimes(2)
      const secondCall = (mockClient.runQuery as jest.Mock).mock.calls[1][0] as string
      expect(secondCall).toContain("CL_ADT_RES_APP_BASE")
    })

    it("deduplicates RES_APP classes from both queries", async () => {
      mockClient.runQuery
        .mockResolvedValueOnce({ values: [{ CLSNAME: "CL_FOO", DESCRIPT: "Foo" }] })
        .mockResolvedValueOnce({ values: [{ CLSNAME: "CL_FOO", DESCRIPT: "Foo" }, { CLSNAME: "CL_BAR", DESCRIPT: "Bar" }] })

      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      // Should have 2 unique classes, not 3
      expect(resultText(result)).toContain("2 RES_APP classes")
    })

    it("handles empty discovery results", async () => {
      mockClient.adtDiscovery.mockResolvedValue([])
      mockClient.adtCoreDiscovery.mockResolvedValue([])

      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(resultText(result)).toContain("0 discovery workspaces")
      expect(resultText(result)).toContain("0 core discovery entries")
    })

    it("handles runQuery returning null values", async () => {
      mockClient.runQuery.mockResolvedValue(null)
      // Should not throw
      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(resultText(result)).toContain("0 RES_APP classes")
    })

    it("survives runQuery throwing (non-fatal)", async () => {
      mockClient.runQuery.mockRejectedValue(new Error("SQL error"))
      // Should not throw - RES_APP query failure is non-fatal
      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(resultText(result)).toContain("0 RES_APP classes")
    })

    it("handles adtDiscovery rejecting with error", async () => {
      mockClient.adtDiscovery.mockRejectedValue(new Error("network fail"))
      await expect(
        tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("network fail")
    })

    it("handles adtCoreDiscovery rejecting with error", async () => {
      mockClient.adtCoreDiscovery.mockRejectedValue(new Error("timeout"))
      await expect(
        tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("timeout")
    })

    it("writes 4 markdown files to workspace", async () => {
      const vscode = require("vscode")
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      // createDirectory for the folder + 4 writeFile calls
      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledTimes(1)
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(4)
    })

    it("throws when no workspace folders exist", async () => {
      const vscode = require("vscode")
      const original = vscode.workspace.workspaceFolders
      vscode.workspace.workspaceFolders = []
      try {
        await expect(
          tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
        ).rejects.toThrow(/workspace folder/)
      } finally {
        vscode.workspace.workspaceFolders = original
      }
    })

    it("throws when workspaceFolders is undefined", async () => {
      const vscode = require("vscode")
      const original = vscode.workspace.workspaceFolders
      vscode.workspace.workspaceFolders = undefined
      try {
        await expect(
          tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
        ).rejects.toThrow(/workspace folder/)
      } finally {
        vscode.workspace.workspaceFolders = original
      }
    })

    it("skips ADT-scheme folders when picking workspace folder", async () => {
      const vscode = require("vscode")
      const original = vscode.workspace.workspaceFolders
      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/adt-folder", scheme: "adt" } },
        { uri: { fsPath: "/local-folder", scheme: "file" } }
      ]
      try {
        await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
        // joinPath should be called with the file-scheme folder
        const firstJoinArg = vscode.Uri.joinPath.mock.calls[0][0]
        expect(firstJoinArg.scheme).toBe("file")
      } finally {
        vscode.workspace.workspaceFolders = original
      }
    })

    it("result mentions all file names", async () => {
      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const text = resultText(result)
      expect(text).toContain("README.md")
      expect(text).toContain("workspaces.md")
      expect(text).toContain("core-discovery.md")
      expect(text).toContain("res-app-classes.md")
    })

    it("handles RES_APP rows with missing fields", async () => {
      mockClient.runQuery
        .mockResolvedValueOnce({
          values: [
            { CLSNAME: "CL_ONLY_NAME" },
            { DESCRIPT: "only desc" },
            {}
          ]
        })
        .mockResolvedValueOnce({ values: [] })

      // Should not throw
      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(resultText(result)).toBeDefined()
    })

    it("folder name includes connectionId and timestamp", async () => {
      const vscode = require("vscode")
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const joinCall = vscode.Uri.joinPath.mock.calls[0]
      const folderName = joinCall[1] as string
      expect(folderName).toContain("dev100")
      expect(folderName).toMatch(/adt-discovery_dev100_\d{4}/)
    })

    it("result includes stats in correct format", async () => {
      mockClient.adtDiscovery.mockResolvedValue([
        {
          title: "WS",
          collection: [
            { href: "/a", title: "C1", templateLinks: [{ rel: "r", template: "t1" }, { rel: "r2", template: "t2" }] },
            { href: "/b", title: "C2", templateLinks: [] }
          ]
        }
      ])
      mockClient.adtCoreDiscovery.mockResolvedValue([
        { title: "Core", collection: { href: "/c", title: "X", category: "y" } },
        { title: "Core2", collection: { href: "/d", title: "Y", category: "z" } }
      ])
      mockClient.runQuery.mockResolvedValue({ values: [{ CLSNAME: "CL_A", DESCRIPT: "" }] })

      const result = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const text = resultText(result)
      expect(text).toContain("1 discovery workspaces")
      expect(text).toContain("2 collections")
      expect(text).toContain("2 template links")
      expect(text).toContain("2 core discovery entries")
    })
  })
})
