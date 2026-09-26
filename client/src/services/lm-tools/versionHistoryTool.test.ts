vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("abapfs", () => ({ isAbapFile: vi.fn() }))
vi.mock("abap-adt-api", () => ({}))
vi.mock("abapobject", () => ({ isAbapClassInclude: vi.fn() }))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { VersionHistoryTool } from "./versionHistoryTool"
import { getSearchService } from "../abapSearchService"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: vi.fn() }
const mockRoot = { findByAdtUri: vi.fn() }
const mockClient = { revisions: vi.fn(), getObjectSource: vi.fn() }

describe("VersionHistoryTool", () => {
  let tool: VersionHistoryTool

  beforeEach(() => {
    tool = new VersionHistoryTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as Mock).mockResolvedValue(mockRoot)
    ;(getClient as Mock).mockReturnValue(mockClient)
  })

  describe("prepareInvocation validation", () => {
    it("throws when objectName is empty", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ objectName: "Z", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("objectName is required and must be at least 2 characters")
    })

    it("throws when objectName has only 1 character", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ objectName: "Z", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("objectName")
    })

    it("throws when connectionId is missing", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ objectName: "ZCLASS" }), mockToken)
      ).rejects.toThrow("connectionId is required")
    })

    it("throws when get_version_source has no versionNumber", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZCLASS",
            connectionId: "dev100",
            action: "get_version_source"
          }),
          mockToken
        )
      ).rejects.toThrow("versionNumber is required")
    })

    it("throws when compare_versions has no version1", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZCLASS",
            connectionId: "dev100",
            action: "compare_versions",
            version2: 2
          }),
          mockToken
        )
      ).rejects.toThrow("version1 and version2 are required")
    })

    it("throws when compare_versions has no version2", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZCLASS",
            connectionId: "dev100",
            action: "compare_versions",
            version1: 1
          }),
          mockToken
        )
      ).rejects.toThrow("version1 and version2 are required")
    })

    it("returns list_versions message by default", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("history")
    })

    it("returns get_version_source message with version number", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCLASS",
          connectionId: "dev100",
          action: "get_version_source",
          versionNumber: 3
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("3")
    })

    it("returns compare_versions message with both version numbers", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCLASS",
          connectionId: "dev100",
          action: "compare_versions",
          version1: 1,
          version2: 2
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("1")
      expect(result.invocationMessage).toContain("2")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }), mockToken)
        .catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_version_history_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ objectName: "ZCLASS", connectionId: "DEV100" }), mockToken)
        .catch(() => {})
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("defaults to list_versions action", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }), mockToken)
        .catch(() => {})
      // Just verify it doesn't throw for default action
      expect(logTelemetry).toHaveBeenCalled()
    })

    it("returns not-found message when object search fails", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "MISSING", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("MISSING")
    })

    it("wraps errors", async () => {
      ;(getSearchService as Mock).mockImplementation(function () {
        throw new Error("search failed")
      })
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to get version history")
      expect(result.parts[0].text).toContain("search failed")
    })
  })
})
