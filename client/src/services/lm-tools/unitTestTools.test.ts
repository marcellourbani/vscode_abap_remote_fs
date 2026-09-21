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
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s, authority: "dev100", path: "/test" }
    })
  },
  commands: { executeCommand: vi.fn() },
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  },
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

vi.mock("../../listeners", () => ({
  showHideActivate: vi.fn(),
  showHideUnitTest: vi.fn()
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
vi.mock("abapobject", () => ({
  isAbapClass: vi.fn(),
  isAbapClassInclude: vi.fn()
}))
vi.mock("abapfs", () => ({ isAbapFile: vi.fn(), isAbapStat: vi.fn() }))
vi.mock("../../adt/operations/AdtObjectFinder", () => ({
  createUri: vi.fn(),
  uriAbapFile: vi.fn()
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
const { mockAddResultsWithReturn } = vi.hoisted(() => {
  const mockAddResultsWithReturn = vi.fn()
  return { mockAddResultsWithReturn }
})
vi.mock("../../adt/operations/UnitTestRunner", () => ({
  UnitTestRunner: {
    get: vi.fn(function () {
      return { addResultsWithReturn: mockAddResultsWithReturn }
    })
  }
}))

const { mockActivate } = vi.hoisted(() => {
  const mockActivate = vi.fn()
  return { mockActivate }
})
vi.mock("../../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: {
    get: vi.fn(function () {
      return { activate: mockActivate }
    })
  }
}))

import { CreateTestIncludeTool, RunUnitTestsTool } from "./unitTestTools"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { uriAbapFile } from "../../adt/operations/AdtObjectFinder"
import { isAbapClass } from "abapobject"
import { isAbapFile } from "abapfs"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: vi.fn() }
const mockRoot = { findByAdtUri: vi.fn() }

describe("CreateTestIncludeTool", () => {
  let tool: CreateTestIncludeTool

  beforeEach(() => {
    tool = new CreateTestIncludeTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as Mock).mockResolvedValue(mockRoot)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with class name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCL_TEST")
    })

    it("includes class name in confirmation", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("ZCL_TEST")
    })

    it("includes connectionId in confirmation", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_create_test_include_called", {
        connectionId: "dev100"
      })
    })

    it("returns error when class not found", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ className: "MISSING", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to create test include")
      expect(result.parts[0].text).toContain("MISSING")
    })

    it("returns error when class has no URI", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ name: "ZCL_TEST", uri: undefined }])
      const result: any = await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to create test include")
    })

    it("uses lowercase connectionId for search service", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(makeOptions({ className: "ZCL_TEST", connectionId: "DEV100" }), mockToken)
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("searches only for CLAS/OC type", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }), mockToken)
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZCL_TEST", ["CLAS/OC"], 1)
    })

    it("returns already-exists message when test include exists", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue({ path: "/zcl_test/source/main" })

      const mockParent = {
        structure: true,
        loadStructure: vi.fn(),
        findInclude: vi.fn().mockReturnValue({ some: "include" })
      }
      const mockAbapFile = {
        object: { parent: mockParent }
      }
      ;(uriAbapFile as unknown as Mock).mockReturnValue(mockAbapFile)
      ;(isAbapClass as unknown as Mock).mockReturnValue(true)

      const result: any = await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("already exists")
      expect(result.parts[0].text).toContain("ZCL_TEST")
    })

    it("returns error when findByAdtUri returns null", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue(null)

      const result: any = await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Failed to create test include")
      expect(result.parts[0].text).toContain("Could not resolve workspace path")
    })
  })
})

describe("RunUnitTestsTool", () => {
  let tool: RunUnitTestsTool

  /** Helper to set up mocks so invoke() reaches the test runner */
  function setupInvokeToRunner(opts: { version?: string } = {}) {
    mockSearcher.searchObjects.mockResolvedValue([
      { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
    ])
    const mockFile = {
      object: {
        loadStructure: vi.fn().mockResolvedValue({
          metaData: { "adtcore:version": opts.version || "active" }
        })
      }
    }
    mockRoot.findByAdtUri.mockResolvedValue({
      path: "/zcl_test/source/main",
      file: mockFile
    })
    ;(isAbapFile as unknown as Mock).mockReturnValue(true)
  }

  /** Helper to build a UnitTestResults object */
  function makeTestResults(
    overrides: Partial<{
      objectName: string
      totalTests: number
      passed: number
      failed: number
      totalTime: number
      allPassed: boolean
      classes: any[]
    }> = {}
  ) {
    return {
      objectName: overrides.objectName ?? "ZCL_TEST",
      totalTests: overrides.totalTests ?? 0,
      passed: overrides.passed ?? 0,
      failed: overrides.failed ?? 0,
      totalTime: overrides.totalTime ?? 0,
      allPassed: overrides.allPassed ?? true,
      classes: overrides.classes ?? []
    }
  }

  beforeEach(() => {
    tool = new RunUnitTestsTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as Mock).mockResolvedValue(mockRoot)
    mockAddResultsWithReturn.mockResolvedValue(makeTestResults())
    mockActivate.mockResolvedValue(undefined)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with object name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCL_TEST")
    })

    it("includes connection in confirmation", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }), mockToken)
        .catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_run_unit_tests_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ objectName: "ZCL_TEST", connectionId: "DEV100" }), mockToken)
        .catch(() => {})
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("returns error message when object not found", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "MISSING", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("MISSING")
      expect(result.parts[0].text).toContain("Failed to run unit tests")
    })

    it("returns error when object has no URI", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", uri: undefined, type: "CLAS/OC" }
      ])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to run unit tests")
      expect(result.parts[0].text).toContain("Could not get URI")
    })

    it("returns error when findByAdtUri returns null", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue(null)

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to run unit tests")
    })

    describe("with successful test execution", () => {
      beforeEach(() => {
        setupInvokeToRunner()
      })

      it("formats all-passing results with pass/fail counts", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 5,
            passed: 5,
            failed: 0,
            totalTime: 1.234,
            allPassed: true,
            classes: [
              {
                name: "LCL_TEST",
                passed: true,
                alerts: [],
                methods: [
                  { name: "test_method_1", passed: true, executionTime: 0.5, alerts: [] },
                  { name: "test_method_2", passed: true, executionTime: 0.734, alerts: [] }
                ]
              }
            ]
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ALL TESTS PASSED")
        expect(text).toContain("Total: 5")
        expect(text).toContain("Passed: 5")
        expect(text).toContain("Failed: 0")
        expect(text).toContain("1.234s")
        expect(text).toContain("LCL_TEST")
        expect(text).toContain("test_method_1")
        expect(text).toContain("test_method_2")
      })

      it("formats all-failing results with failure details", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 2,
            passed: 0,
            failed: 2,
            totalTime: 0.1,
            allPassed: false,
            classes: [
              {
                name: "LCL_TEST",
                passed: false,
                alerts: [],
                methods: [
                  {
                    name: "test_fail_1",
                    passed: false,
                    executionTime: 0.05,
                    alerts: [
                      {
                        kind: "failedAssertion",
                        title: "Expected 1 but got 2",
                        details: ["CX_AUNIT_ASSERT"]
                      }
                    ]
                  },
                  {
                    name: "test_fail_2",
                    passed: false,
                    executionTime: 0.05,
                    alerts: [
                      {
                        kind: "failedAssertion",
                        title: "Values differ",
                        details: ["Line 42", "CX_AUNIT_ASSERT"]
                      }
                    ]
                  }
                ]
              }
            ]
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("SOME TESTS FAILED")
        expect(text).toContain("Passed: 0")
        expect(text).toContain("Failed: 2")
        expect(text).toContain("Expected 1 but got 2")
        expect(text).toContain("Values differ")
        expect(text).toContain("Line 42")
      })

      it("shows no-test-classes message when classes array is empty", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 0,
            passed: 0,
            failed: 0,
            totalTime: 0,
            allPassed: true,
            classes: []
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("No test classes found")
      })

      it("shows class-level alerts when present", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 1,
            passed: 1,
            failed: 0,
            totalTime: 0.001,
            allPassed: true,
            classes: [
              {
                name: "LCL_TEST",
                passed: true,
                alerts: [{ kind: "warning", title: "Setup method took too long", details: [] }],
                methods: [{ name: "test_ok", passed: true, executionTime: 0.001, alerts: [] }]
              }
            ]
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Setup method took too long")
      })

      it("formats execution time with 3 decimal places", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 1,
            passed: 1,
            failed: 0,
            totalTime: 0.1,
            allPassed: true,
            classes: [
              {
                name: "LCL_TEST",
                passed: true,
                alerts: [],
                methods: [{ name: "test_fast", passed: true, executionTime: 0.1, alerts: [] }]
              }
            ]
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        // 0.1 should be formatted as 0.100
        expect(text).toContain("0.100s")
      })

      it("shows mixed pass/fail correctly with multiple classes", async () => {
        mockAddResultsWithReturn.mockResolvedValue(
          makeTestResults({
            totalTests: 3,
            passed: 2,
            failed: 1,
            totalTime: 0.5,
            allPassed: false,
            classes: [
              {
                name: "LCL_TEST_GOOD",
                passed: true,
                alerts: [],
                methods: [{ name: "test_ok", passed: true, executionTime: 0.1, alerts: [] }]
              },
              {
                name: "LCL_TEST_BAD",
                passed: false,
                alerts: [],
                methods: [
                  { name: "test_ok2", passed: true, executionTime: 0.1, alerts: [] },
                  {
                    name: "test_fail",
                    passed: false,
                    executionTime: 0.3,
                    alerts: [{ kind: "failedAssertion", title: "Assertion failed", details: [] }]
                  }
                ]
              }
            ]
          })
        )

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("Passed: 2")
        expect(text).toContain("Failed: 1")
        expect(text).toContain("LCL_TEST_GOOD")
        expect(text).toContain("LCL_TEST_BAD")
      })
    })

    describe("error handling during test execution", () => {
      it("returns error when addResultsWithReturn throws", async () => {
        setupInvokeToRunner()
        mockAddResultsWithReturn.mockRejectedValue(new Error("Test runner crashed"))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Failed to run unit tests")
        expect(result.parts[0].text).toContain("Test runner crashed")
      })

      it("returns error when activate throws (object has no file)", async () => {
        mockSearcher.searchObjects.mockResolvedValue([
          { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
        ])
        mockRoot.findByAdtUri.mockResolvedValue({
          path: "/zcl_test/source/main",
          file: null
        })
        ;(isAbapFile as unknown as Mock).mockReturnValue(false)

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Failed to run unit tests")
      })
    })
  })
})
