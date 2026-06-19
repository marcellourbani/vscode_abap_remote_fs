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

jest.mock("../operations/UnitTestRunner", () => ({
  UnitTestRunner: {
    get: jest.fn()
  }
}))

import { UnitTool } from "./unit"
import { getClient, uriRoot } from "../conections"
import { isAbapFile } from "abapfs"
import { AdtObjectActivator } from "../operations/AdtObjectActivator"
import { UnitTestRunner } from "../operations/UnitTestRunner"
import * as vscode from "vscode"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockUriRoot = uriRoot as jest.MockedFunction<typeof uriRoot>
const mockIsAbapFile = isAbapFile as jest.MockedFunction<typeof isAbapFile>

const mockToken = {} as any

beforeEach(() => {
  jest.clearAllMocks()
  ;(vscode.window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) => fn())
})

describe("UnitTool", () => {
  let tool: UnitTool

  beforeEach(() => {
    tool = new UnitTool()
  })

  describe("invoke", () => {
    test("returns unit test results as JSON", async () => {
      const mockObject = {
        loadStructure: jest.fn().mockResolvedValue({
          metaData: { "adtcore:version": "active" }
        })
      }
      const mockFile = { object: mockObject }
      const mockResults = [{ name: "test1", status: "pass" }]
      const mockRunner = { addResults: jest.fn().mockResolvedValue(mockResults) }

      mockIsAbapFile.mockReturnValue(true)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: mockFile, path: "/ztest" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(UnitTestRunner.get as jest.Mock).mockReturnValue(mockRunner)
      ;(vscode.window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) =>
        fn()
      )

      // Override withProgress to return the result of fn
      ;(vscode.window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) =>
        fn()
      )

      // We need to capture return from withProgress
      ;(vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, fn: Function) => {
        return fn()
      })

      const result = await tool.invoke(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest" } } as any,
        mockToken
      )

      const content = (result as any).content
      expect(content[0].value).toContain("test1")
    })

    test("activates inactive object before running tests", async () => {
      const mockActivator = { activate: jest.fn().mockResolvedValue(undefined) }
      const mockObject = {
        loadStructure: jest.fn().mockResolvedValue({
          metaData: { "adtcore:version": "inactive" }
        })
      }
      const mockFile = { object: mockObject }
      const mockRunner = { addResults: jest.fn().mockResolvedValue([]) }

      mockIsAbapFile.mockReturnValue(true)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: mockFile, path: "/ztest" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(mockActivator)
      ;(UnitTestRunner.get as jest.Mock).mockReturnValue(mockRunner)
      ;(vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, fn: Function) => fn())

      await tool.invoke(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest" } } as any,
        mockToken
      )

      expect(mockActivator.activate).toHaveBeenCalled()
    })

    test("does not activate active object", async () => {
      const mockActivator = { activate: jest.fn() }
      const mockObject = {
        loadStructure: jest.fn().mockResolvedValue({
          metaData: { "adtcore:version": "active" }
        })
      }
      const mockFile = { object: mockObject }
      const mockRunner = { addResults: jest.fn().mockResolvedValue([]) }

      mockIsAbapFile.mockReturnValue(true)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: mockFile }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(mockActivator)
      ;(UnitTestRunner.get as jest.Mock).mockReturnValue(mockRunner)
      ;(vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, fn: Function) => fn())

      await tool.invoke(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest" } } as any,
        mockToken
      )

      expect(mockActivator.activate).not.toHaveBeenCalled()
    })

    test("throws when object not found", async () => {
      mockIsAbapFile.mockReturnValue(false)
      const mockRoot = {
        getNodePathAsync: jest.fn().mockResolvedValue([{ file: {}, path: "/" }])
      }
      mockUriRoot.mockReturnValue(mockRoot as any)
      ;(vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, fn: Function) => fn())

      await expect(
        tool.invoke(
          { input: { url: "adt://dev100/bad/path" } } as any,
          mockToken
        )
      ).rejects.toThrow("Failed to retrieve object for unit test run")
    })
  })

  describe("prepareInvocation", () => {
    test("returns invocation message when client found", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/ztest/ztest.prog.abap" } } as any,
        mockToken
      )

      expect((result as any).invocationMessage).toContain("ztest.prog.abap")
    })

    test("throws when no client registered", () => {
      mockGetClient.mockReturnValue(undefined as any)

      expect(() =>
        tool.prepareInvocation!(
          { input: { url: "adt://unknownsys/sap/bc/adt/programs" } } as any,
          mockToken
        )
      ).toThrow("No ABAP filesystem registered")
    })

    test("strips path leaving only filename", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        { input: { url: "adt://dev100/sap/bc/adt/programs/programs/zfoo.prog.abap" } } as any,
        mockToken
      )

      expect((result as any).invocationMessage).toContain("zfoo.prog.abap")
    })
  })
})
