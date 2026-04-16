jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  Uri: { parse: jest.fn((s: string) => ({ toString: () => s, authority: "dev100", path: "/test" })) },
  commands: { executeCommand: jest.fn() },
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  getOrCreateRoot: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("abapobject", () => ({ isAbapClass: jest.fn() }))
jest.mock("abapfs", () => ({ isAbapFile: jest.fn(), isAbapStat: jest.fn() }))
jest.mock("../../adt/operations/AdtObjectFinder", () => ({
  createUri: jest.fn(),
  uriAbapFile: jest.fn()
}))

const mockAddResultsWithReturn = jest.fn()
jest.mock("../../adt/operations/UnitTestRunner", () => ({
  UnitTestRunner: { get: jest.fn(() => ({ addResultsWithReturn: mockAddResultsWithReturn })) }
}))

const mockActivate = jest.fn()
jest.mock("../../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: { get: jest.fn(() => ({ activate: mockActivate })) }
}))

import { CreateTestIncludeTool, RunUnitTestsTool } from "./unitTestTools"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { uriAbapFile } from "../../adt/operations/AdtObjectFinder"
import { isAbapClass } from "abapobject"
import { isAbapFile } from "abapfs"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: jest.fn() }
const mockRoot = { findByAdtUri: jest.fn() }

describe("CreateTestIncludeTool", () => {
  let tool: CreateTestIncludeTool

  beforeEach(() => {
    tool = new CreateTestIncludeTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(mockRoot)
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
      await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
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
      await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "DEV100" }),
        mockToken
      )
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("searches only for CLAS/OC type", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ className: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      )
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZCL_TEST", ["CLAS/OC"], 1)
    })

    it("returns already-exists message when test include exists", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", uri: "/sap/bc/adt/oo/classes/zcl_test", type: "CLAS/OC" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue({ path: "/zcl_test/source/main" })

      const mockParent = {
        structure: true,
        loadStructure: jest.fn(),
        findInclude: jest.fn().mockReturnValue({ some: "include" })
      }
      const mockAbapFile = {
        object: { parent: mockParent }
      }
      ;(uriAbapFile as unknown as jest.Mock).mockReturnValue(mockAbapFile)
      ;(isAbapClass as unknown as jest.Mock).mockReturnValue(true)

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
        loadStructure: jest.fn().mockResolvedValue({
          metaData: { "adtcore:version": opts.version || "active" }
        })
      }
    }
    mockRoot.findByAdtUri.mockResolvedValue({
      path: "/zcl_test/source/main",
      file: mockFile
    })
    ;(isAbapFile as unknown as jest.Mock).mockReturnValue(true)
  }

  /** Helper to build a UnitTestResults object */
  function makeTestResults(overrides: Partial<{
    objectName: string
    totalTests: number
    passed: number
    failed: number
    totalTime: number
    allPassed: boolean
    classes: any[]
  }> = {}) {
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
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(mockRoot)
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
      await tool.invoke(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_run_unit_tests_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ objectName: "ZCL_TEST", connectionId: "DEV100" }),
        mockToken
      ).catch(() => {})
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
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
          totalTests: 5,
          passed: 5,
          failed: 0,
          totalTime: 1.234,
          allPassed: true,
          classes: [{
            name: "LCL_TEST",
            passed: true,
            alerts: [],
            methods: [
              { name: "test_method_1", passed: true, executionTime: 0.5, alerts: [] },
              { name: "test_method_2", passed: true, executionTime: 0.734, alerts: [] }
            ]
          }]
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ALL TESTS PASSED")
        expect(text).toContain("Total Tests:** 5")
        expect(text).toContain("Passed:** 5")
        expect(text).toContain("Failed:** 0")
        expect(text).toContain("1.234s")
        expect(text).toContain("LCL_TEST")
        expect(text).toContain("test_method_1")
        expect(text).toContain("test_method_2")
      })

      it("formats all-failing results with failure details", async () => {
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
          totalTests: 2,
          passed: 0,
          failed: 2,
          totalTime: 0.1,
          allPassed: false,
          classes: [{
            name: "LCL_TEST",
            passed: false,
            alerts: [],
            methods: [
              {
                name: "test_fail_1", passed: false, executionTime: 0.05,
                alerts: [{ kind: "failedAssertion", title: "Expected 1 but got 2", details: ["CX_AUNIT_ASSERT"] }]
              },
              {
                name: "test_fail_2", passed: false, executionTime: 0.05,
                alerts: [{ kind: "failedAssertion", title: "Values differ", details: ["Line 42", "CX_AUNIT_ASSERT"] }]
              }
            ]
          }]
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("SOME TESTS FAILED")
        expect(text).toContain("Passed:** 0")
        expect(text).toContain("Failed:** 2")
        expect(text).toContain("Expected 1 but got 2")
        expect(text).toContain("Values differ")
        expect(text).toContain("Line 42")
      })

      it("shows no-test-classes message when classes array is empty", async () => {
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
          totalTests: 0,
          passed: 0,
          failed: 0,
          totalTime: 0,
          allPassed: true,
          classes: []
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("No test classes found")
      })

      it("shows class-level alerts when present", async () => {
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
          totalTests: 1,
          passed: 1,
          failed: 0,
          totalTime: 0.001,
          allPassed: true,
          classes: [{
            name: "LCL_TEST",
            passed: true,
            alerts: [{ kind: "warning", title: "Setup method took too long", details: [] }],
            methods: [
              { name: "test_ok", passed: true, executionTime: 0.001, alerts: [] }
            ]
          }]
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Setup method took too long")
      })

      it("formats execution time with 3 decimal places", async () => {
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
          totalTests: 1,
          passed: 1,
          failed: 0,
          totalTime: 0.1,
          allPassed: true,
          classes: [{
            name: "LCL_TEST",
            passed: true,
            alerts: [],
            methods: [
              { name: "test_fast", passed: true, executionTime: 0.1, alerts: [] }
            ]
          }]
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        // 0.1 should be formatted as 0.100
        expect(text).toContain("0.100s")
      })

      it("shows mixed pass/fail correctly with multiple classes", async () => {
        mockAddResultsWithReturn.mockResolvedValue(makeTestResults({
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
              methods: [
                { name: "test_ok", passed: true, executionTime: 0.1, alerts: [] }
              ]
            },
            {
              name: "LCL_TEST_BAD",
              passed: false,
              alerts: [],
              methods: [
                { name: "test_ok2", passed: true, executionTime: 0.1, alerts: [] },
                {
                  name: "test_fail", passed: false, executionTime: 0.3,
                  alerts: [{ kind: "failedAssertion", title: "Assertion failed", details: [] }]
                }
              ]
            }
          ]
        }))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("Passed:** 2")
        expect(text).toContain("Failed:** 1")
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
        ;(isAbapFile as unknown as jest.Mock).mockReturnValue(false)

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZCL_TEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Failed to run unit tests")
      })
    })
  })
})
