vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn(function (url: string) {
      const match = url.match(/^([^:]+):\/\/([^\/]*)(.*)$/)
      return {
        scheme: match?.[1] ?? "",
        authority: match?.[2] ?? "",
        path: match?.[3] ?? "",
        toString: () => url
      }
    })
  },
  LanguageModelTextPart: vi.fn(function (t: string) {
    return { value: t }
  }),
  LanguageModelToolResult: vi.fn(function (content: any[]) {
    return { content }
  }),
  ProgressLocation: { Window: 10 },
  window: {
    withProgress: vi.fn(),
    createOutputChannel: vi.fn(function () {
      return {
        appendLine: vi.fn(),
        show: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    })
  }
}))

vi.mock("../conections", () => ({
  getClient: vi.fn(),
  uriRoot: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn()
}))

vi.mock("../operations/AdtObjectActivator", () => ({
  AdtObjectActivator: {
    get: vi.fn()
  }
}))

vi.mock("../../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

vi.mock("../../services/lm-tools/toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))

vi.mock("../../listeners", () => ({
  showHideActivate: vi.fn()
}))

import { ActivateTool } from "./activate"
import { getClient, uriRoot } from "../conections"
import { isAbapFile } from "abapfs"
import { AdtObjectActivator } from "../operations/AdtObjectActivator"
import * as vscode from "vscode"
import type { MockedFunction, Mock } from "vitest"

const mockGetClient = getClient as MockedFunction<typeof getClient>
const mockUriRoot = uriRoot as MockedFunction<typeof uriRoot>
const mockIsAbapFile = isAbapFile as MockedFunction<typeof isAbapFile>

const mockToken = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(vscode.window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
    return fn()
  })
})

describe("ActivateTool", () => {
  let tool: ActivateTool

  beforeEach(() => {
    tool = new ActivateTool()
  })

  describe("invoke", () => {
    test("activates object and returns success message", async () => {
      const mockObject = { path: "/sap/bc/adt/programs/programs/ztest" }
      const mockFile = { object: mockObject }
      const mockActivator = { activate: vi.fn().mockResolvedValue({ ok: true }) }

      mockIsAbapFile.mockReturnValue(true)
      const mockRoot = {
        getNodePathAsync: vi.fn().mockResolvedValue([{ file: mockFile, path: "/ztest" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(AdtObjectActivator.get as Mock).mockReturnValue(mockActivator)

      const result = await tool.invoke(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest" } } as any,
        mockToken
      )

      expect(mockActivator.activate).toHaveBeenCalled()
      const resultContent = (result as any).content
      expect(resultContent[0].value).toContain("Activation successful")
      expect(resultContent[0].value).toContain("abapfs_get_object_source")
      expect(resultContent[0].value).toContain("does not prove")
    })

    test("throws when object not found in path", async () => {
      mockIsAbapFile.mockReturnValue(false)
      const mockRoot = {
        getNodePathAsync: vi.fn().mockResolvedValue([{ file: {}, path: "/" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(vscode.window.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
        return fn()
      })

      await expect(
        tool.invoke({ input: { url: "adt://dev100/bad/path" } } as any, mockToken)
      ).rejects.toThrow("Failed to retrieve object for activation")
    })
  })

  describe("prepareInvocation", () => {
    test("returns invocation message when client found", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        {
          input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest/ztest.prog.abap" }
        } as any,
        mockToken
      )

      expect((result as any).invocationMessage).toContain("Activating")
    })

    test("throws when no client for authority", () => {
      mockGetClient.mockReturnValue(undefined as any)

      expect(() =>
        tool.prepareInvocation!(
          { input: { url: "adt://unknown/sap/bc/adt/programs" } } as any,
          mockToken
        )
      ).toThrow("No ABAP filesystem registered")
    })

    test("strips path and shows only filename in message", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        {
          input: { url: "adt://dev100/sap/bc/adt/programs/programs/myprogram.prog.abap" }
        } as any,
        mockToken
      )

      expect((result as any).invocationMessage).toContain("myprogram.prog.abap")
      expect((result as any).invocationMessage).not.toContain("/sap/bc/adt")
    })
  })
})
