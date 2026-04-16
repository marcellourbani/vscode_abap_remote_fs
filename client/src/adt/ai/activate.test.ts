jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((url: string) => {
      const match = url.match(/^([^:]+):\/\/([^\/]*)(.*)$/)
      return {
        scheme: match?.[1] ?? "",
        authority: match?.[2] ?? "",
        path: match?.[3] ?? "",
        toString: () => url
      }
    })
  },
  LanguageModelTextPart: jest.fn((t: string) => ({ value: t })),
  LanguageModelToolResult: jest.fn((content: any[]) => ({ content })),
  ProgressLocation: { Window: 10 },
  window: {
    withProgress: jest.fn()
  }
}), { virtual: true })

jest.mock("../conections", () => ({
  getClient: jest.fn(),
  uriRoot: jest.fn()
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

jest.mock("../operations/AdtObjectActivator", () => ({
  AdtObjectActivator: {
    get: jest.fn()
  }
}))

jest.mock("../../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

import { ActivateTool } from "./activate"
import { getClient, uriRoot } from "../conections"
import { isAbapFile } from "abapfs"
import { AdtObjectActivator } from "../operations/AdtObjectActivator"
import * as vscode from "vscode"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockUriRoot = uriRoot as jest.MockedFunction<typeof uriRoot>
const mockIsAbapFile = isAbapFile as jest.MockedFunction<typeof isAbapFile>

const mockToken = {} as any

beforeEach(() => {
  jest.clearAllMocks()
  ;(vscode.window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) => fn())
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
      const mockActivator = { activate: jest.fn().mockResolvedValue(undefined) }

      mockIsAbapFile.mockReturnValue(true)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: mockFile, path: "/ztest" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(mockActivator)

      const result = await tool.invoke(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest" } } as any,
        mockToken
      )

      expect(mockActivator.activate).toHaveBeenCalled()
      const resultContent = (result as any).content
      expect(resultContent[0].value).toContain("Activation successful")
    })

    test("throws when object not found in path", async () => {
      mockIsAbapFile.mockReturnValue(false)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: {}, path: "/" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(vscode.window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) =>
        fn()
      )

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
