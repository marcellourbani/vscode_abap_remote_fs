vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: "adt",
        authority: s.split("://")[1]?.split("/")[0] || "conn",
        path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") || ""),
        toString: () => s
      }
    })
  },
  tests: {
    createTestController: vi.fn().mockReturnValue({
      createRunProfile: vi.fn(),
      createTestItem: vi.fn().mockImplementation(function (id: string, label: string) {
        return {
          id,
          label,
          children: {
            get: vi.fn(),
            add: vi.fn(),
            delete: vi.fn(),
            [Symbol.iterator]: vi.fn().mockReturnValue([][Symbol.iterator]())
          },
          parent: undefined,
          range: undefined
        }
      }),
      items: {
        get: vi.fn(),
        add: vi.fn(),
        [Symbol.iterator]: vi.fn().mockReturnValue([][Symbol.iterator]())
      },
      createTestRun: vi.fn().mockReturnValue({
        enqueued: vi.fn(),
        started: vi.fn(),
        skipped: vi.fn(),
        passed: vi.fn(),
        failed: vi.fn(),
        end: vi.fn()
      })
    })
  },
  TestRunProfileKind: { Run: 1 },
  TestRunRequest: vi.fn().mockImplementation(function (include: any) {
    return { include, exclude: [] }
  }),
  TestMessage: vi.fn().mockImplementation(function (msg: any) {
    return { message: msg }
  }),
  MarkdownString: vi.fn().mockImplementation(function (s: string) {
    return { value: s }
  }),
  commands: { executeCommand: vi.fn() },
  TestItemCollection: vi.fn(class {}),
  TestRun: vi.fn(class {}),
  Range: vi.fn().mockImplementation(function (s: any, e: any) {
    return { start: s, end: e }
  })
}))

vi.mock("../conections", () => ({
  getClient: vi.fn(),
  getRoot: vi.fn(),
  uriRoot: vi.fn()
}))

vi.mock("../includes", () => ({
  IncludeService: {
    get: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue(null) })
  }
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn(),
  isAbapStat: vi.fn(),
  isFolder: vi.fn()
}))

vi.mock("abap-adt-api", () => ({
  UnitTestAlertKind: { warning: "warning", error: "error" },
  uriPartsToString: vi.fn(function (u: any) {
    return u?.toString() || ""
  })
}))

vi.mock("../../lib", () => ({
  lineRange: vi.fn(function (line: number) {
    return { start: { line }, end: { line } }
  })
}))

vi.mock("abapobject", () => ({
  isAbapClassInclude: vi.fn().mockReturnValue(false)
}))

vi.mock("./AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      vscodeRange: vi.fn().mockResolvedValue({ uri: "adt://conn/path", start: { line: 0 } }),
      clearCaches: vi.fn()
    }
  })
}))

vi.mock("../../services/telemetry", () => ({ logTelemetry: vi.fn() }))

import {
  UnitTestRunner,
  type UnitTestResults,
  type TestClassResult,
  type TestMethodResult
} from "./UnitTestRunner"
import * as __$mock_abap_adt_api from "abap-adt-api"

describe("UnitTestRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(UnitTestRunner as any).instances.clear()
  })

  it("creates singleton per connId via get()", () => {
    const r1 = UnitTestRunner.get("conn1")
    const r2 = UnitTestRunner.get("conn1")
    expect(r1).toBe(r2)
  })

  it("creates different instances for different connIds", () => {
    const r1 = UnitTestRunner.get("conn1")
    const r2 = UnitTestRunner.get("conn2")
    expect(r1).not.toBe(r2)
  })

  it("has a controller", () => {
    const runner = UnitTestRunner.get("conn3")
    expect(runner.controller).toBeDefined()
  })

  it("getUrlType returns object type by default", () => {
    const runner = UnitTestRunner.get("conn4")
    // TestResType.object = 0
    expect(runner.getUrlType("unknown-id")).toBe(0)
  })

  it("setUrlTypes registers class and method types", () => {
    const runner = UnitTestRunner.get("conn5")
    const classes: any[] = [
      {
        uri: "/class/uri",
        type: "CLAS/OC",
        name: "ZCL_TEST",
        alerts: [],
        srcUrl: {},
        testmethods: [
          { uri: "/method/uri", type: "PROG/I", name: "METHOD1", alerts: [], srcUrl: {} }
        ]
      }
    ]
    runner.setUrlTypes(classes)
    // TestResType.class = 1, TestResType.method = 2
    expect(runner.getUrlType("/class/uri")).toBe(1)
    expect(runner.getUrlType("/method/uri")).toBe(2)
  })
})

describe("UnitTestResults type structure", () => {
  it("can create a valid UnitTestResults object", () => {
    const results: UnitTestResults = {
      objectName: "ZCL_TEST",
      totalTests: 3,
      passed: 2,
      failed: 1,
      totalTime: 0.5,
      allPassed: false,
      classes: [
        {
          name: "LTCL_TESTS",
          passed: false,
          methods: [
            { name: "METHOD_OK", passed: true, executionTime: 0.1, alerts: [] },
            {
              name: "METHOD_FAIL",
              passed: false,
              executionTime: 0.2,
              alerts: [{ kind: "error", title: "Assert failed", details: ["Expected X, got Y"] }]
            }
          ],
          alerts: []
        }
      ]
    }
    expect(results.objectName).toBe("ZCL_TEST")
    expect(results.classes[0]!.methods).toHaveLength(2)
    expect(results.classes[0]!.methods[0]!.passed).toBe(true)
    expect(results.classes[0]!.methods[1]!.passed).toBe(false)
  })

  it("allPassed reflects overall test outcome", () => {
    const passing: UnitTestResults = {
      objectName: "ZCL_FOO",
      totalTests: 1,
      passed: 1,
      failed: 0,
      totalTime: 0.1,
      allPassed: true,
      classes: []
    }
    expect(passing.allPassed).toBe(true)
    expect(passing.failed).toBe(0)
  })
})

describe("buildTestResults", () => {
  it("builds structured results from classes", () => {
    const { UnitTestAlertKind } = __$mock_abap_adt_api
    const runner = UnitTestRunner.get("connBuild")

    const classes: any[] = [
      {
        uri: "/class1",
        type: "CLAS/OC",
        name: "LTCL_MAIN",
        alerts: [],
        srcUrl: {},
        testmethods: [
          { uri: "/m1", name: "TEST_OK", executionTime: 0.1, alerts: [], srcUrl: {} },
          {
            uri: "/m2",
            name: "TEST_FAIL",
            executionTime: 0.2,
            alerts: [{ kind: "error", title: "Assert", details: [] }],
            srcUrl: {}
          }
        ]
      }
    ]

    const results = (runner as any).buildTestResults(classes, "ZCL_MAIN")
    expect(results.objectName).toBe("ZCL_MAIN")
    expect(results.totalTests).toBe(2)
    expect(results.passed).toBe(1)
    expect(results.failed).toBe(1)
    expect(results.allPassed).toBe(false)
    expect(results.classes).toHaveLength(1)
    expect(results.classes[0].name).toBe("LTCL_MAIN")
    expect(results.classes[0].methods).toHaveLength(2)
  })

  it("counts warnings-only as passed", () => {
    const runner = UnitTestRunner.get("connWarn")
    const classes: any[] = [
      {
        uri: "/class1",
        name: "LTCL_WARN",
        alerts: [],
        srcUrl: {},
        testmethods: [
          {
            uri: "/m1",
            name: "TEST_WARN",
            executionTime: 0.1,
            alerts: [{ kind: "warning", title: "Warning", details: [] }],
            srcUrl: {}
          }
        ]
      }
    ]
    const results = (runner as any).buildTestResults(classes, "ZCL_WARN")
    expect(results.passed).toBe(1)
    expect(results.failed).toBe(0)
    expect(results.allPassed).toBe(true)
  })

  it("marks class as failed when class-level non-warning alerts exist", () => {
    const runner = UnitTestRunner.get("connClassFail")
    const classes: any[] = [
      {
        uri: "/class1",
        name: "LTCL_FAIL",
        alerts: [{ kind: "error", title: "Class error", details: [] }],
        srcUrl: {},
        testmethods: [{ uri: "/m1", name: "TEST_OK", executionTime: 0.1, alerts: [], srcUrl: {} }]
      }
    ]
    const results = (runner as any).buildTestResults(classes, "ZCL_FAIL")
    expect(results.classes[0].passed).toBe(false)
  })
})
