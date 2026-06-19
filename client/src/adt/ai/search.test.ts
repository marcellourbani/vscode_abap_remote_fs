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
  LanguageModelToolResult: jest.fn((content: any[]) => ({ content }))
}), { virtual: true })

jest.mock("../conections", () => ({
  getClient: jest.fn(),
  getRoot: jest.fn()
}))

jest.mock("../operations/AdtObjectFinder", () => ({
  createUri: jest.fn((auth: string, path: string) => ({
    scheme: "adt",
    authority: auth,
    path,
    toString: () => `adt://${auth}${path}`
  }))
}))

import { SearchTool } from "./search"
import { getClient, getRoot } from "../conections"
import { createUri } from "../operations/AdtObjectFinder"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockGetRoot = getRoot as jest.MockedFunction<typeof getRoot>

const mockToken = {} as any

beforeEach(() => {
  jest.clearAllMocks()
})

describe("SearchTool", () => {
  let tool: SearchTool

  beforeEach(() => {
    tool = new SearchTool()
  })

  describe("invoke", () => {
    test("returns search findings as JSON", async () => {
      const mockSearchResult = [
        {
          "adtcore:uri": "/sap/bc/adt/programs/programs/ztest",
          "adtcore:name": "ZTEST",
          "adtcore:type": "PROG/P"
        }
      ]
      const mockClient = {
        searchObject: jest.fn().mockResolvedValue(mockSearchResult)
      }
      const mockRoot = {
        findByAdtUri: jest.fn().mockResolvedValue({ path: "/ztest" })
      }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue(mockRoot as any)
      ;(createUri as jest.Mock).mockReturnValue({
        toString: () => "adt://dev100/ztest"
      })

      const result = await tool.invoke(
        { input: { url: "adt://dev100/", name: "ztest", type: "PROG/P" } } as any,
        mockToken
      )

      const content = (result as any).content
      expect(content.length).toBeGreaterThan(0)
      const parsed = JSON.parse(content[0].value)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe("ZTEST")
      expect(parsed[0].type).toBe("PROG/P")
    })

    test("uppercases name and appends wildcard for search query", async () => {
      const mockClient = {
        searchObject: jest.fn().mockResolvedValue([])
      }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue({ findByAdtUri: jest.fn() } as any)

      await tool.invoke(
        { input: { url: "adt://dev100/", name: "ztest", type: "" } } as any,
        mockToken
      )

      expect(mockClient.searchObject).toHaveBeenCalledWith("ZTEST*", "")
    })

    test("limits results to max 10 findings", async () => {
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        "adtcore:uri": `/sap/bc/adt/programs/programs/ztest${i}`,
        "adtcore:name": `ZTEST${i}`,
        "adtcore:type": "PROG/P"
      }))
      const mockClient = { searchObject: jest.fn().mockResolvedValue(manyResults) }
      const mockRoot = {
        findByAdtUri: jest.fn().mockImplementation(() =>
          Promise.resolve({ path: "/some/path" })
        )
      }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue(mockRoot as any)
      ;(createUri as jest.Mock).mockReturnValue({ toString: () => "adt://dev100/path" })

      const result = await tool.invoke(
        { input: { url: "adt://dev100/", name: "ztest", type: "PROG/P" } } as any,
        mockToken
      )

      const content = (result as any).content
      const parsed = JSON.parse(content[0].value)
      expect(parsed.length).toBeLessThanOrEqual(10)
    })

    test("skips objects not found in root", async () => {
      const mockResults = [
        { "adtcore:uri": "/sap/bc/adt/programs/programs/ztest", "adtcore:name": "ZTEST", "adtcore:type": "PROG/P" }
      ]
      const mockClient = { searchObject: jest.fn().mockResolvedValue(mockResults) }
      const mockRoot = { findByAdtUri: jest.fn().mockResolvedValue(undefined) }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue(mockRoot as any)

      const result = await tool.invoke(
        { input: { url: "adt://dev100/", name: "ztest", type: "PROG/P" } } as any,
        mockToken
      )

      const content = (result as any).content
      const parsed = JSON.parse(content[0].value)
      expect(parsed).toHaveLength(0)
    })

    test("includes important instruction in content", async () => {
      const mockClient = { searchObject: jest.fn().mockResolvedValue([]) }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue({ findByAdtUri: jest.fn() } as any)

      const result = await tool.invoke(
        { input: { url: "adt://dev100/", name: "ztest", type: "" } } as any,
        mockToken
      )

      const content = (result as any).content
      const texts = content.map((c: any) => c.value)
      expect(texts.some((t: string) => t.includes("IMPORTANT"))).toBe(true)
    })

    test("handles empty search type", async () => {
      const mockClient = { searchObject: jest.fn().mockResolvedValue([]) }
      mockGetClient.mockReturnValue(mockClient as any)
      mockGetRoot.mockReturnValue({ findByAdtUri: jest.fn() } as any)

      await tool.invoke(
        { input: { url: "adt://dev100/", name: "ZTEST", type: "" } } as any,
        mockToken
      )

      expect(mockClient.searchObject).toHaveBeenCalledWith("ZTEST*", "")
    })
  })

  describe("prepareInvocation", () => {
    test("returns invocation message when client found", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        { input: { url: "adt://dev100/", name: "ZCL_TEST", type: "CLAS/OC" } } as any,
        mockToken
      )

      const msg = (result as any).invocationMessage
      expect(msg).toContain("ZCL_TEST")
      expect(msg).toContain("CLAS/OC")
      expect(msg).toContain("dev100")
    })

    test("throws when no client registered", () => {
      mockGetClient.mockReturnValue(undefined as any)

      expect(() =>
        tool.prepareInvocation!(
          { input: { url: "adt://unknown/", name: "ZTEST", type: "" } } as any,
          mockToken
        )
      ).toThrow("No ABAP filesystem registered")
    })

    test("includes authority in error message", () => {
      mockGetClient.mockReturnValue(undefined as any)

      expect(() =>
        tool.prepareInvocation!(
          { input: { url: "adt://mysystem/", name: "ZTEST", type: "" } } as any,
          mockToken
        )
      ).toThrow("mysystem")
    })
  })
})
