const mocks = vi.hoisted(() => ({
  findByAdtUri: vi.fn()
}))

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
    }),
    from: vi.fn(function (parts: { scheme: string; authority: string; path: string }) {
      return {
        toString: () => `${parts.scheme}://${parts.authority}${parts.path}`
      }
    })
  },
  LanguageModelTextPart: vi.fn(function (t: string) {
    return { value: t }
  }),
  LanguageModelToolResult: vi.fn(function (content: any[]) {
    return { content }
  }),
  window: {
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
  getOrCreateRoot: vi.fn(async () => ({ findByAdtUri: mocks.findByAdtUri }))
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
import { getClient } from "../conections"
import { AdtObjectActivator } from "../operations/AdtObjectActivator"
import type { MockedFunction, Mock } from "vitest"

const mockGetClient = getClient as MockedFunction<typeof getClient>

const mockToken = {} as any
const inactiveObject = {
  "adtcore:name": "ZTEST_I01",
  "adtcore:type": "PROG/I",
  "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_i01",
  "adtcore:parentUri": "/sap/bc/adt/programs/programs/ztest",
  user: "DEVELOPER",
  deleted: false
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findByAdtUri.mockImplementation(async (uri: string) => ({
    path: uri.replace("/sap/bc/adt", "/Source Library")
  }))
})

describe("ActivateTool", () => {
  let tool: ActivateTool

  beforeEach(() => {
    tool = new ActivateTool()
  })

  describe("invoke", () => {
    test("gets and filters inactive objects", async () => {
      const mockActivator = {
        getInactiveObjects: vi.fn().mockResolvedValue([
          inactiveObject,
          {
            ...inactiveObject,
            "adtcore:name": "ZOTHER",
            "adtcore:uri": "/sap/bc/adt/programs/includes/zother"
          }
        ])
      }
      mockGetClient.mockReturnValue({} as any)
      ;(AdtObjectActivator.get as Mock).mockReturnValue(mockActivator)

      const result = await tool.invoke(
        {
          input: {
            action: "get_inactive_objects",
            connectionId: "dev100",
            regex: "I01$"
          }
        } as any,
        mockToken
      )

      const payload = JSON.parse((result as any).content[0].value)
      expect(payload.count).toBe(1)
      expect(payload.objects[0]).toMatchObject({
        name: "ZTEST_I01",
        url: "adt://dev100/sap/bc/adt/programs/includes/ztest_i01",
        workspaceUri: "adt://dev100/Source Library/programs/includes/ztest_i01"
      })
      expect(mocks.findByAdtUri).toHaveBeenCalledWith(
        "/sap/bc/adt/programs/includes/ztest_i01",
        false
      )
    })

    test("keeps an inactive object visible when no workspace URI can be resolved", async () => {
      mocks.findByAdtUri.mockRejectedValue(new Error("not mapped"))
      const mockActivator = {
        getInactiveObjects: vi.fn().mockResolvedValue([inactiveObject])
      }
      mockGetClient.mockReturnValue({} as any)
      ;(AdtObjectActivator.get as Mock).mockReturnValue(mockActivator)

      const result = await tool.invoke(
        {
          input: {
            action: "get_inactive_objects",
            connectionId: "dev100"
          }
        } as any,
        mockToken
      )

      const payload = JSON.parse((result as any).content[0].value)
      expect(payload.objects[0]).toMatchObject({
        name: "ZTEST_I01",
        url: "adt://dev100/sap/bc/adt/programs/includes/ztest_i01"
      })
      expect(payload.objects[0]).not.toHaveProperty("workspaceUri")
    })

    test("activates URLs in one batch and reports verified results", async () => {
      const relatedInclude = {
        ...inactiveObject,
        "adtcore:name": "ZTEST_C01",
        "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_c01"
      }
      const mockActivator = {
        activateMultiple: vi.fn().mockResolvedValue({
          ok: true,
          availableCount: 2,
          selectedCount: 2,
          selectedObjects: [inactiveObject, relatedInclude],
          stillInactiveObjects: [],
          relatedStillInactive: [],
          notInactiveUris: []
        })
      }
      mockGetClient.mockReturnValue({} as any)
      ;(AdtObjectActivator.get as Mock).mockReturnValue(mockActivator)

      const url = "adt://dev100/sap/bc/adt/programs/includes/ztest_i01"
      const relatedUrl = "adt://dev100/sap/bc/adt/programs/includes/ztest_c01"
      const result = await tool.invoke(
        {
          input: {
            action: "activate",
            connectionId: "dev100",
            urls: [url, relatedUrl]
          }
        } as any,
        mockToken
      )

      expect(mockActivator.activateMultiple).toHaveBeenCalledWith(false, [
        "/sap/bc/adt/programs/includes/ztest_i01",
        "/sap/bc/adt/programs/includes/ztest_c01"
      ])
      const payload = JSON.parse((result as any).content[0].value)
      expect(payload.status).toBe("success")
      expect(payload.activatedObjects).toHaveLength(2)
      expect(payload.stillInactiveObjects).toBeUndefined()
      expect(payload.relatedStillInactive).toBeUndefined()
    })

    test("reports related objects that were left inactive", async () => {
      const mainProgram = {
        ...inactiveObject,
        "adtcore:name": "ZTEST",
        "adtcore:type": "PROG/P",
        "adtcore:uri": "/sap/bc/adt/programs/programs/ztest"
      }
      const summary =
        "Activated 1 object, but related objects that were not requested are still inactive: ZTEST"
      const mockActivator = {
        activateMultiple: vi.fn().mockResolvedValue({
          ok: true,
          summary,
          availableCount: 2,
          selectedCount: 1,
          selectedObjects: [inactiveObject],
          stillInactiveObjects: [],
          relatedStillInactive: [mainProgram],
          notInactiveUris: []
        })
      }
      mockGetClient.mockReturnValue({} as any)
      ;(AdtObjectActivator.get as Mock).mockReturnValue(mockActivator)

      const result = await tool.invoke(
        {
          input: {
            action: "activate",
            connectionId: "dev100",
            urls: ["adt://dev100/sap/bc/adt/programs/includes/ztest_i01"]
          }
        } as any,
        mockToken
      )

      const payload = JSON.parse((result as any).content[0].value)
      expect(payload.status).toBe("success")
      expect(payload.summary).toBe(summary)
      expect(payload.activatedObjects).toHaveLength(1)
      expect(payload.relatedStillInactive).toHaveLength(1)
      expect(payload.relatedStillInactive[0]).toMatchObject({
        name: "ZTEST",
        url: "adt://dev100/sap/bc/adt/programs/programs/ztest"
      })
    })

    test("rejects activation URLs for another connection", async () => {
      mockGetClient.mockReturnValue({} as any)

      await expect(
        tool.invoke(
          {
            input: {
              action: "activate",
              connectionId: "dev100",
              urls: ["adt://qas100/sap/bc/adt/programs/includes/ztest_i01"]
            }
          } as any,
          mockToken
        )
      ).rejects.toThrow("belongs to connection qas100")
    })
  })

  describe("prepareInvocation", () => {
    test("returns activation count when client found", () => {
      mockGetClient.mockReturnValue({} as any)

      const result = tool.prepareInvocation!(
        {
          input: {
            action: "activate",
            connectionId: "dev100",
            urls: [
              "adt://dev100/sap/bc/adt/programs/includes/ztest_c01",
              "adt://dev100/sap/bc/adt/programs/includes/ztest_i01"
            ]
          }
        } as any,
        mockToken
      )

      expect((result as any).invocationMessage).toContain("Activating 2 object(s)")
    })

    test("throws when no client for authority", () => {
      mockGetClient.mockReturnValue(undefined as any)

      expect(() =>
        tool.prepareInvocation!(
          { input: { action: "get_inactive_objects", connectionId: "unknown" } } as any,
          mockToken
        )
      ).toThrow("No ABAP filesystem registered")
    })
  })
})
