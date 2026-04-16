jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("../../views/transports", () => ({ readTransports: jest.fn() }))

import { ManageTransportRequestsTool } from "./transportTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient: any = {
  userTransports: jest.fn(),
  transportDetails: jest.fn(),
  transportObjectContents: jest.fn()
}

describe("ManageTransportRequestsTool", () => {
  let tool: ManageTransportRequestsTool

  beforeEach(() => {
    tool = new ManageTransportRequestsTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message for get_user_transports", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("transport")
    })

    it("returns get_transport_details message with transport number", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEV100001",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("DEV100001")
    })

    it("throws when get_transport_details has no transportNumber", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ action: "get_transport_details", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("transportNumber is required")
    })

    it("throws when get_transport_objects has no transportNumber", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ action: "get_transport_objects", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("transportNumber is required")
    })

    it("throws when compare_transports has fewer than 2 transport numbers", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            action: "compare_transports",
            transportNumbers: ["DEV100001"],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("At least 2 transport numbers")
    })

    it("accepts compare_transports with 2 transport numbers", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            action: "compare_transports",
            transportNumbers: ["DEV100001", "DEV100002"],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockClient.userTransports.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_manage_transport_requests_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.userTransports.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "DEV100" }),
        mockToken
      ).catch(() => {})
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("throws when no connectionId and no active ABAP editor", async () => {
      ;(window as any).activeTextEditor = undefined
      await expect(
        tool.invoke(makeOptions({ action: "get_user_transports" }), mockToken)
      ).rejects.toThrow()
    })

    it("wraps client errors", async () => {
      ;(getClient as jest.Mock).mockImplementation(() => {
        throw new Error("transport service error")
      })
      await expect(
        tool.invoke(
          makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow()
    })
  })

  // ====================================================================
  // getUserTransports: verify actual output formatting
  // ====================================================================
  describe("invoke - get_user_transports output", () => {
    it("formats user transports with category headers, targets, and transport details", async () => {
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [
          {
            "tm:name": "TRG",
            "tm:desc": "Target System",
            modifiable: [
              {
                "tm:number": "DEV100001",
                "tm:owner": "TESTUSER",
                "tm:desc": "My transport",
                "tm:status": "D",
                tasks: [{ id: 1 }],
                objects: [{ id: 1 }, { id: 2 }]
              }
            ],
            released: []
          }
        ],
        customizing: [],
        transportofcopies: []
      })
      mockClient.username = "TESTUSER"

      const result: any = await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Transport Requests for User: TESTUSER")
      expect(text).toContain("WORKBENCH")
      expect(text).toContain("Target: TRG - Target System")
      expect(text).toContain("MODIFIABLE")
      expect(text).toContain("DEV100001")
      expect(text).toContain("My transport")
      expect(text).toContain("Tasks: 1")
      expect(text).toContain("Objects: 2")
      expect(text).toContain("Summary")
      expect(text).toContain("Found 1 transport requests")
    })

    it("counts transports across multiple categories and targets", async () => {
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [
          {
            "tm:name": "TRG",
            "tm:desc": "Target",
            modifiable: [
              { "tm:number": "T1", "tm:owner": "U", "tm:desc": "D1", "tm:status": "D", tasks: [], objects: [] },
              { "tm:number": "T2", "tm:owner": "U", "tm:desc": "D2", "tm:status": "D", tasks: [], objects: [] }
            ],
            released: [
              { "tm:number": "T3", "tm:owner": "U", "tm:desc": "D3", "tm:status": "R", tasks: [], objects: [] }
            ]
          }
        ],
        customizing: [
          {
            "tm:name": "CUS",
            "tm:desc": "Cust Target",
            modifiable: [
              { "tm:number": "T4", "tm:owner": "U", "tm:desc": "D4", "tm:status": "D", tasks: [], objects: [] }
            ],
            released: []
          }
        ],
        transportofcopies: []
      })
      mockClient.username = "U"

      const result: any = await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      // 2 modifiable + 1 released + 1 customizing = 4
      expect(text).toContain("Found 4 transport requests")
    })

    it("shows released section with lock icon", async () => {
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [
          {
            "tm:name": "TRG",
            "tm:desc": "Target",
            modifiable: [],
            released: [
              { "tm:number": "REL001", "tm:owner": "U", "tm:desc": "Released one", "tm:status": "R", tasks: [], objects: [] }
            ]
          }
        ],
        customizing: [],
        transportofcopies: []
      })
      mockClient.username = "U"

      const result: any = await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("RELEASED")
      expect(text).toContain("REL001")
      expect(text).toContain("Released one")
    })

    it("skips empty categories and empty target status sections", async () => {
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [],
        customizing: [],
        transportofcopies: []
      })
      mockClient.username = "NOBODY"

      const result: any = await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).not.toContain("WORKBENCH")
      expect(text).not.toContain("CUSTOMIZING")
      expect(text).toContain("Found 0 transport requests")
    })

    it("uses client.username when user parameter is not provided", async () => {
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [],
        customizing: [],
        transportofcopies: []
      })
      mockClient.username = "DEFAULTUSER"

      const result: any = await tool.invoke(
        makeOptions({ action: "get_user_transports", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("DEFAULTUSER")
    })
  })

  // ====================================================================
  // parseTransportXML: test via getTransportDetails which calls it
  // ====================================================================
  describe("invoke - get_transport_details XML parsing", () => {
    const makeTransportXml = (opts: {
      number: string
      owner?: string
      desc?: string
      status?: string
      objects?: string
      tasks?: string
    }) => {
      return `<?xml version="1.0" encoding="utf-8"?>
<tm:root xmlns:tm="http://www.sap.com/adt/cts/transportmanagement" tm:number="${opts.number}" tm:owner="${opts.owner || "DEVUSER"}" tm:desc="${opts.desc || "Test Transport"}" tm:status="${opts.status || "D"}" tm:status_text="Modifiable" tm:type="K" tm:target="QAS" tm:target_desc="Quality System" tm:lastchanged_timestamp="20240101120000">
${opts.objects || ""}
${opts.tasks || ""}
</tm:root>`
    }

    it("extracts transport number, owner, description, status from XML", async () => {
      const xml = makeTransportXml({
        number: "DEVK900123",
        owner: "JDOE",
        desc: "Fix customer report",
        status: "D"
      })
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValue({ body: xml })
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900123", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("DEVK900123")
      expect(text).toContain("JDOE")
      expect(text).toContain("Fix customer report")
      expect(text).toContain("Quality System")
    })

    // BUG DETECTED: parseTransportXML uses regex /<tm:abap_object[^>]*>(.*?)<\/tm:abap_object>/gs
    // for main-level objects, which requires a closing tag. Self-closing <tm:abap_object .../>
    // tags (which SAP can return) are silently ignored. Only task-level objects use the
    // self-closing regex. This test SHOULD FAIL until the bug is fixed.
    it("parses objects from XML (EXPOSES BUG: self-closing tags ignored)", async () => {
      const objectsXml = `
<tm:abap_object tm:name="ZCL_MYCLASS" tm:type="CLAS" tm:pgmid="R3TR" tm:obj_desc="My class"/>
<tm:abap_object tm:name="ZMYREPORT" tm:type="PROG" tm:pgmid="R3TR" tm:obj_desc="My report"/>`
      const xml = makeTransportXml({ number: "DEVK900124", objects: objectsXml })
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValue({ body: xml })
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900124", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Objects**: 2")
      expect(text).toContain("ZCL_MYCLASS")
      expect(text).toContain("CLAS")
      expect(text).toContain("ZMYREPORT")
      expect(text).toContain("PROG")
    })

    it("parses tasks with their objects from XML", async () => {
      const tasksXml = `
<tm:task tm:number="DEVK900125" tm:owner="JDOE" tm:desc="Task 1" tm:status="D">
  <tm:abap_object tm:name="ZTABLE1" tm:type="TABL" tm:pgmid="R3TR" tm:obj_desc="A table"/>
  <tm:abap_object tm:name="ZDTEL1" tm:type="DTEL" tm:pgmid="R3TR" tm:obj_desc="A data element"/>
</tm:task>`
      const xml = makeTransportXml({ number: "DEVK900124", tasks: tasksXml })
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValue({ body: xml })
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900124", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Tasks** (1)")
      expect(text).toContain("DEVK900125")
      expect(text).toContain("Task 1")
    })

    it("returns not-found message when response body is empty", async () => {
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValue({ body: null })
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900999", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("not found")
    })

    it("detects system compatibility issue when response contains different transport number", async () => {
      // Server returns XML for a DIFFERENT transport than what was requested
      const xml = makeTransportXml({ number: "DEVK900001", desc: "Wrong transport" })
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValue({ body: xml })
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900999", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("SYSTEM COMPATIBILITY ISSUE")
      expect(text).toContain("DEVK900999")
      expect(text).toContain("not found in the response")
    })

    it("handles 404 error gracefully with not-found message", async () => {
      mockClient.httpClient = {
        request: jest.fn().mockRejectedValue(new Error("404 not found"))
      }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_details", transportNumber: "DEVK900999", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("not found")
      expect(text).not.toContain("Failed to manage")
    })

    it("throws wrapped error for non-404 API errors", async () => {
      mockClient.httpClient = {
        request: jest.fn().mockRejectedValue(new Error("500 internal server error"))
      }

      await expect(
        tool.invoke(
          makeOptions({ action: "get_transport_details", transportNumber: "DEVK900100", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to manage transport requests")
    })
  })

  // ====================================================================
  // getTransportObjects: verify object aggregation from transport + tasks
  // ====================================================================
  describe("invoke - get_transport_objects output", () => {
    const makeTransportXml = (opts: {
      number: string
      owner?: string
      desc?: string
      objects?: string
      tasks?: string
    }) => {
      return `<?xml version="1.0" encoding="utf-8"?>
<tm:root xmlns:tm="http://www.sap.com/adt/cts/transportmanagement" tm:number="${opts.number}" tm:owner="${opts.owner || "DEVUSER"}" tm:desc="${opts.desc || "Test Transport"}" tm:status="D" tm:status_text="Modifiable" tm:type="K" tm:target="QAS" tm:target_desc="Quality System" tm:lastchanged_timestamp="20240101120000">
${opts.objects || ""}
${opts.tasks || ""}
</tm:root>`
    }

    // BUG: Same parseTransportXML self-closing tag issue as in details tests.
    // Main-level objects with self-closing tags are not parsed.
    it("groups objects by type under main transport section (EXPOSES BUG)", async () => {
      const objectsXml = `
<tm:abap_object tm:name="ZCL_A" tm:type="CLAS" tm:pgmid="R3TR" tm:obj_desc="Class A"/>
<tm:abap_object tm:name="ZCL_B" tm:type="CLAS" tm:pgmid="R3TR" tm:obj_desc="Class B"/>
<tm:abap_object tm:name="ZREPORT" tm:type="PROG" tm:pgmid="R3TR" tm:obj_desc="Report"/>`
      const xml = makeTransportXml({ number: "DEVK800001", objects: objectsXml })
      mockClient.httpClient = { request: jest.fn().mockResolvedValue({ body: xml }) }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_objects", transportNumber: "DEVK800001", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("MAIN TRANSPORT")
      expect(text).toContain("CLAS")
      expect(text).toContain("2 objects")
      expect(text).toContain("PROG")
      expect(text).toContain("ZCL_A")
      expect(text).toContain("ZCL_B")
      expect(text).toContain("ZREPORT")
    })

    it("shows 'no objects' warning when transport is empty", async () => {
      const xml = makeTransportXml({ number: "DEVK800002" })
      mockClient.httpClient = { request: jest.fn().mockResolvedValue({ body: xml }) }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_objects", transportNumber: "DEVK800002", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("No objects found")
      expect(text).toContain("Total Objects**: 0")
    })

    // BUG: Main-level object is missed by parser (self-closing tag), only task objects counted.
    it("counts total objects including task objects (EXPOSES BUG)", async () => {
      const objectsXml = `<tm:abap_object tm:name="ZMAIN" tm:type="PROG" tm:pgmid="R3TR" tm:obj_desc="Main object"/>`
      const tasksXml = `
<tm:task tm:number="DEVK800003" tm:owner="USER1" tm:desc="Task1" tm:status="D">
  <tm:abap_object tm:name="ZTASK1" tm:type="TABL" tm:pgmid="R3TR" tm:obj_desc="Task table"/>
  <tm:abap_object tm:name="ZTASK2" tm:type="DTEL" tm:pgmid="R3TR" tm:obj_desc="Task dtel"/>
</tm:task>`
      const xml = makeTransportXml({ number: "DEVK800004", objects: objectsXml, tasks: tasksXml })
      mockClient.httpClient = { request: jest.fn().mockResolvedValue({ body: xml }) }

      const result: any = await tool.invoke(
        makeOptions({ action: "get_transport_objects", transportNumber: "DEVK800004", connectionId: "dev100" }),
        mockToken
      )
      const text: string = result.parts[0].text

      // 1 main + 2 task = 3 total
      expect(text).toContain("Total Objects**: 3")
    })
  })

  // ====================================================================
  // compareTransports: common vs unique objects, edge cases
  // ====================================================================
  describe("invoke - compare_transports logic", () => {
    function makeXml(number: string, objects: Array<{ name: string; type: string; pgmid: string; desc: string }>) {
      const objXml = objects
        .map(o => `<tm:abap_object tm:name="${o.name}" tm:type="${o.type}" tm:pgmid="${o.pgmid}" tm:obj_desc="${o.desc}"/>`)
        .join("\n")
      return `<?xml version="1.0" encoding="utf-8"?>
<tm:root xmlns:tm="http://www.sap.com/adt/cts/transportmanagement" tm:number="${number}" tm:owner="USER" tm:desc="Transport ${number}" tm:status="D" tm:status_text="Modifiable" tm:type="K" tm:target="QAS" tm:target_desc="QAS" tm:lastchanged_timestamp="20240101120000">
${objXml}
</tm:root>`
    }

    // BUG: parseTransportXML ignores self-closing <tm:abap_object .../> at main level.
    // compareTransports sees 0 objects because the parser regex requires closing tags.
    it("identifies common objects shared across all transports (EXPOSES BUG)", async () => {
      const xml1 = makeXml("TR001", [
        { name: "ZCL_SHARED", type: "CLAS", pgmid: "R3TR", desc: "Shared class" },
        { name: "ZUNIQUE1", type: "PROG", pgmid: "R3TR", desc: "Unique to TR001" }
      ])
      const xml2 = makeXml("TR002", [
        { name: "ZCL_SHARED", type: "CLAS", pgmid: "R3TR", desc: "Shared class" },
        { name: "ZUNIQUE2", type: "PROG", pgmid: "R3TR", desc: "Unique to TR002" }
      ])
      mockClient.httpClient = {
        request: jest.fn()
          .mockResolvedValueOnce({ body: xml1 })
          .mockResolvedValueOnce({ body: xml2 })
      }

      const result: any = await tool.invoke(
        makeOptions({
          action: "compare_transports",
          transportNumbers: ["TR001", "TR002"],
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("COMMON OBJECTS")
      expect(text).toContain("ZCL_SHARED")
      expect(text).toContain("Unique to TR001")
      expect(text).toContain("ZUNIQUE1")
      expect(text).toContain("Unique to TR002")
      expect(text).toContain("ZUNIQUE2")
    })

    // BUG: Same self-closing tag parsing issue.
    it("reports no common objects when transports have disjoint object sets (EXPOSES BUG)", async () => {
      const xml1 = makeXml("TR010", [
        { name: "ZONLY_A", type: "PROG", pgmid: "R3TR", desc: "Only in A" }
      ])
      const xml2 = makeXml("TR020", [
        { name: "ZONLY_B", type: "TABL", pgmid: "R3TR", desc: "Only in B" }
      ])
      mockClient.httpClient = {
        request: jest.fn()
          .mockResolvedValueOnce({ body: xml1 })
          .mockResolvedValueOnce({ body: xml2 })
      }

      const result: any = await tool.invoke(
        makeOptions({
          action: "compare_transports",
          transportNumbers: ["TR010", "TR020"],
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("None")
      expect(text).toContain("ZONLY_A")
      expect(text).toContain("ZONLY_B")
    })

    // BUG: Same self-closing tag parsing issue.
    it("counts total unique objects correctly (EXPOSES BUG)", async () => {
      const xml1 = makeXml("TRA", [
        { name: "OBJ1", type: "CLAS", pgmid: "R3TR", desc: "O1" },
        { name: "OBJ2", type: "CLAS", pgmid: "R3TR", desc: "O2" }
      ])
      const xml2 = makeXml("TRB", [
        { name: "OBJ2", type: "CLAS", pgmid: "R3TR", desc: "O2" },
        { name: "OBJ3", type: "CLAS", pgmid: "R3TR", desc: "O3" }
      ])
      mockClient.httpClient = {
        request: jest.fn()
          .mockResolvedValueOnce({ body: xml1 })
          .mockResolvedValueOnce({ body: xml2 })
      }

      const result: any = await tool.invoke(
        makeOptions({
          action: "compare_transports",
          transportNumbers: ["TRA", "TRB"],
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      // 3 unique objects: OBJ1, OBJ2, OBJ3
      expect(text).toContain("Total Unique Objects**: 3")
    })

    it("handles one transport not found during comparison", async () => {
      const xml1 = makeXml("TROK", [
        { name: "ZOK", type: "PROG", pgmid: "R3TR", desc: "OK" }
      ])
      mockClient.httpClient = {
        request: jest.fn()
          .mockResolvedValueOnce({ body: xml1 })
          .mockRejectedValueOnce(new Error("transport not found"))
      }

      const result: any = await tool.invoke(
        makeOptions({
          action: "compare_transports",
          transportNumbers: ["TROK", "TRBAD"],
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Not Found")
      expect(text).toContain("TRBAD")
      expect(text).toContain("Need at least 2 valid transports")
    })

    it("detects system compatibility issue during comparison", async () => {
      // Server returns a DIFFERENT transport number than requested
      const xml1 = makeXml("WRONG_NUM", [])
      mockClient.httpClient = {
        request: jest.fn().mockResolvedValueOnce({ body: xml1 })
      }

      const result: any = await tool.invoke(
        makeOptions({
          action: "compare_transports",
          transportNumbers: ["EXPECTED_NUM", "OTHER"],
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("SYSTEM COMPATIBILITY ISSUE")
    })
  })

  // ====================================================================
  // Input validation and error handling
  // ====================================================================
  describe("invoke - input validation", () => {
    it("throws for get_transport_details without transportNumber", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "get_transport_details", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("transportNumber is required")
    })

    it("throws for get_transport_objects without transportNumber", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "get_transport_objects", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("transportNumber is required")
    })

    it("throws for compare_transports with fewer than 2 numbers", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "compare_transports", transportNumbers: ["ONE"], connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("At least 2 transport numbers")
    })

    it("throws for compare_transports with empty array", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "compare_transports", transportNumbers: [], connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("At least 2 transport numbers")
    })

    it("throws for unknown action", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "nonexistent_action", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Unknown action")
    })

    it("uses active editor authority as connectionId when none provided", async () => {
      const { abapUri } = require("../../adt/conections")
      ;(abapUri as jest.Mock).mockReturnValue(true)
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "DEV200", scheme: "adt" } }
      }
      mockClient.userTransports = jest.fn()
      const { readTransports } = require("../../views/transports")
      ;(readTransports as jest.Mock).mockResolvedValue({
        workbench: [],
        customizing: [],
        transportofcopies: []
      })
      mockClient.username = "U"

      await tool.invoke(
        makeOptions({ action: "get_user_transports" }),
        mockToken
      )

      expect(getClient).toHaveBeenCalledWith("dev200")
    })
  })
})
