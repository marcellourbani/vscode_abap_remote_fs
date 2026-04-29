jest.mock(
  "vscode",
  () => ({
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
    lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
  }),
  { virtual: true }
)

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
      await tool
        .invoke(makeOptions({ action: "get_user_transports", connectionId: "dev100" }), mockToken)
        .catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_manage_transport_requests_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.userTransports.mockResolvedValue([])
      await tool
        .invoke(makeOptions({ action: "get_user_transports", connectionId: "DEV100" }), mockToken)
        .catch(() => {})
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
              {
                "tm:number": "T1",
                "tm:owner": "U",
                "tm:desc": "D1",
                "tm:status": "D",
                tasks: [],
                objects: []
              },
              {
                "tm:number": "T2",
                "tm:owner": "U",
                "tm:desc": "D2",
                "tm:status": "D",
                tasks: [],
                objects: []
              }
            ],
            released: [
              {
                "tm:number": "T3",
                "tm:owner": "U",
                "tm:desc": "D3",
                "tm:status": "R",
                tasks: [],
                objects: []
              }
            ]
          }
        ],
        customizing: [
          {
            "tm:name": "CUS",
            "tm:desc": "Cust Target",
            modifiable: [
              {
                "tm:number": "T4",
                "tm:owner": "U",
                "tm:desc": "D4",
                "tm:status": "D",
                tasks: [],
                objects: []
              }
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
              {
                "tm:number": "REL001",
                "tm:owner": "U",
                "tm:desc": "Released one",
                "tm:status": "R",
                tasks: [],
                objects: []
              }
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
  // getTransportDetails
  // ====================================================================
  describe("invoke - get_transport_details", () => {
    function makeTransportRequest(opts: {
      number: string
      owner?: string
      desc?: string
      status?: string
      objects?: Array<{ name: string; type: string; pgmid?: string; obj_info?: string }>
      tasks?: Array<{
        number: string
        owner?: string
        desc?: string
        status?: string
        objects?: Array<{ name: string; type: string; pgmid?: string; obj_info?: string }>
      }>
    }): any {
      return {
        "tm:number": opts.number,
        "tm:owner": opts.owner || "DEVUSER",
        "tm:desc": opts.desc || "Test Transport",
        "tm:status": opts.status || "D",
        "tm:uri": `/sap/bc/adt/cts/transportrequests/${opts.number}`,
        links: [],
        objects: (opts.objects || []).map(o => ({
          "tm:name": o.name,
          "tm:type": o.type,
          "tm:pgmid": o.pgmid || "R3TR",
          "tm:dummy_uri": "",
          "tm:obj_info": o.obj_info || ""
        })),
        tasks: (opts.tasks || []).map(t => ({
          "tm:number": t.number,
          "tm:owner": t.owner || "DEVUSER",
          "tm:desc": t.desc || "",
          "tm:status": t.status || "D",
          "tm:uri": `/sap/bc/adt/cts/transportrequests/${t.number}`,
          links: [],
          objects: (t.objects || []).map(o => ({
            "tm:name": o.name,
            "tm:type": o.type,
            "tm:pgmid": o.pgmid || "R3TR",
            "tm:dummy_uri": "",
            "tm:obj_info": o.obj_info || ""
          }))
        }))
      }
    }

    it("extracts transport number, owner, description and status", async () => {
      mockClient.transportDetails.mockResolvedValue(
        makeTransportRequest({
          number: "DEVK900123",
          owner: "JDOE",
          desc: "Fix customer report",
          status: "D"
        })
      )

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEVK900123",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("DEVK900123")
      expect(text).toContain("JDOE")
      expect(text).toContain("Fix customer report")
    })

    it("parses objects", async () => {
      mockClient.transportDetails.mockResolvedValue(
        makeTransportRequest({
          number: "DEVK900124",
          objects: [
            { name: "ZCL_MYCLASS", type: "CLAS", pgmid: "R3TR", obj_info: "My class" },
            { name: "ZMYREPORT", type: "PROG", pgmid: "R3TR", obj_info: "My report" }
          ]
        })
      )

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEVK900124",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Objects**: 2")
      expect(text).toContain("ZCL_MYCLASS")
      expect(text).toContain("CLAS")
      expect(text).toContain("ZMYREPORT")
      expect(text).toContain("PROG")
    })

    it("parses tasks with their objects", async () => {
      mockClient.transportDetails.mockResolvedValue(
        makeTransportRequest({
          number: "DEVK900124",
          tasks: [
            {
              number: "DEVK900125",
              owner: "JDOE",
              desc: "Task 1",
              status: "D",
              objects: [
                { name: "ZTABLE1", type: "TABL", obj_info: "A table" },
                { name: "ZDTEL1", type: "DTEL", obj_info: "A data element" }
              ]
            }
          ]
        })
      )

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEVK900124",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("Tasks** (1)")
      expect(text).toContain("DEVK900125")
      expect(text).toContain("Task 1")
    })

    it("returns not-found message when transport does not exist", async () => {
      mockClient.transportDetails.mockRejectedValue(new Error("404 not found"))

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEVK900999",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("not found")
    })

    it("handles 404 error gracefully with not-found message", async () => {
      mockClient.transportDetails.mockRejectedValue(new Error("404 not found"))

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_details",
          transportNumber: "DEVK900999",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("not found")
      expect(text).not.toContain("Failed to manage")
    })

    it("throws wrapped error for non-404 API errors", async () => {
      mockClient.transportDetails.mockRejectedValue(new Error("500 internal server error"))

      await expect(
        tool.invoke(
          makeOptions({
            action: "get_transport_details",
            transportNumber: "DEVK900100",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Failed to manage transport requests")
    })
  })

  // ====================================================================
  // getTransportObjects: verify object aggregation from transport + tasks
  // ====================================================================
  describe("invoke - get_transport_objects", () => {
    function makeTransportRequest(opts: {
      number: string
      owner?: string
      desc?: string
      objects?: Array<{ name: string; type: string; pgmid?: string; obj_info?: string }>
      tasks?: Array<{
        number: string
        owner?: string
        desc?: string
        status?: string
        objects?: Array<{ name: string; type: string; pgmid?: string; obj_info?: string }>
      }>
    }): any {
      return {
        "tm:number": opts.number,
        "tm:owner": opts.owner || "DEVUSER",
        "tm:desc": opts.desc || "Test Transport",
        "tm:status": "D",
        "tm:uri": `/sap/bc/adt/cts/transportrequests/${opts.number}`,
        links: [],
        objects: (opts.objects || []).map(o => ({
          "tm:name": o.name,
          "tm:type": o.type,
          "tm:pgmid": o.pgmid || "R3TR",
          "tm:dummy_uri": "",
          "tm:obj_info": o.obj_info || ""
        })),
        tasks: (opts.tasks || []).map(t => ({
          "tm:number": t.number,
          "tm:owner": t.owner || "DEVUSER",
          "tm:desc": t.desc || "",
          "tm:status": t.status || "D",
          "tm:uri": `/sap/bc/adt/cts/transportrequests/${t.number}`,
          links: [],
          objects: (t.objects || []).map(o => ({
            "tm:name": o.name,
            "tm:type": o.type,
            "tm:pgmid": o.pgmid || "R3TR",
            "tm:dummy_uri": "",
            "tm:obj_info": o.obj_info || ""
          }))
        }))
      }
    }

    it("groups objects by type under main transport section", async () => {
      mockClient.transportDetails.mockResolvedValue(
        makeTransportRequest({
          number: "DEVK800001",
          objects: [
            { name: "ZCL_A", type: "CLAS", pgmid: "R3TR", obj_info: "Class A" },
            { name: "ZCL_B", type: "CLAS", pgmid: "R3TR", obj_info: "Class B" },
            { name: "ZREPORT", type: "PROG", pgmid: "R3TR", obj_info: "Report" }
          ]
        })
      )

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_objects",
          transportNumber: "DEVK800001",
          connectionId: "dev100"
        }),
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
      mockClient.transportDetails.mockResolvedValue(makeTransportRequest({ number: "DEVK800002" }))

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_objects",
          transportNumber: "DEVK800002",
          connectionId: "dev100"
        }),
        mockToken
      )
      const text: string = result.parts[0].text

      expect(text).toContain("No objects found")
      expect(text).toContain("Total Objects**: 0")
    })

    it("counts total objects including task objects", async () => {
      mockClient.transportDetails.mockResolvedValue(
        makeTransportRequest({
          number: "DEVK800004",
          objects: [{ name: "ZMAIN", type: "PROG", obj_info: "Main object" }],
          tasks: [
            {
              number: "DEVK800003",
              owner: "USER1",
              desc: "Task1",
              status: "D",
              objects: [
                { name: "ZTASK1", type: "TABL", obj_info: "Task table" },
                { name: "ZTASK2", type: "DTEL", obj_info: "Task dtel" }
              ]
            }
          ]
        })
      )

      const result: any = await tool.invoke(
        makeOptions({
          action: "get_transport_objects",
          transportNumber: "DEVK800004",
          connectionId: "dev100"
        }),
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
    function makeTransportRequest(
      number: string,
      objects: Array<{ name: string; type: string; pgmid?: string; obj_info?: string }>
    ): any {
      return {
        "tm:number": number,
        "tm:owner": "USER",
        "tm:desc": `Transport ${number}`,
        "tm:status": "D",
        "tm:uri": `/sap/bc/adt/cts/transportrequests/${number}`,
        links: [],
        objects: objects.map(o => ({
          "tm:name": o.name,
          "tm:type": o.type,
          "tm:pgmid": o.pgmid || "R3TR",
          "tm:dummy_uri": "",
          "tm:obj_info": o.obj_info || ""
        })),
        tasks: []
      }
    }

    it("identifies common objects shared across all transports", async () => {
      mockClient.transportDetails
        .mockResolvedValueOnce(
          makeTransportRequest("TR001", [
            { name: "ZCL_SHARED", type: "CLAS", pgmid: "R3TR", obj_info: "Shared class" },
            { name: "ZUNIQUE1", type: "PROG", pgmid: "R3TR", obj_info: "Unique to TR001" }
          ])
        )
        .mockResolvedValueOnce(
          makeTransportRequest("TR002", [
            { name: "ZCL_SHARED", type: "CLAS", pgmid: "R3TR", obj_info: "Shared class" },
            { name: "ZUNIQUE2", type: "PROG", pgmid: "R3TR", obj_info: "Unique to TR002" }
          ])
        )

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

    it("reports no common objects when transports have disjoint object sets", async () => {
      mockClient.transportDetails
        .mockResolvedValueOnce(
          makeTransportRequest("TR010", [
            { name: "ZONLY_A", type: "PROG", pgmid: "R3TR", obj_info: "Only in A" }
          ])
        )
        .mockResolvedValueOnce(
          makeTransportRequest("TR020", [
            { name: "ZONLY_B", type: "TABL", pgmid: "R3TR", obj_info: "Only in B" }
          ])
        )

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

    it("counts total unique objects correctly", async () => {
      mockClient.transportDetails
        .mockResolvedValueOnce(
          makeTransportRequest("TRA", [
            { name: "OBJ1", type: "CLAS", pgmid: "R3TR", obj_info: "O1" },
            { name: "OBJ2", type: "CLAS", pgmid: "R3TR", obj_info: "O2" }
          ])
        )
        .mockResolvedValueOnce(
          makeTransportRequest("TRB", [
            { name: "OBJ2", type: "CLAS", pgmid: "R3TR", obj_info: "O2" },
            { name: "OBJ3", type: "CLAS", pgmid: "R3TR", obj_info: "O3" }
          ])
        )

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
      mockClient.transportDetails
        .mockResolvedValueOnce(
          makeTransportRequest("TROK", [
            { name: "ZOK", type: "PROG", pgmid: "R3TR", obj_info: "OK" }
          ])
        )
        .mockRejectedValueOnce(new Error("transport not found"))

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
          makeOptions({
            action: "compare_transports",
            transportNumbers: ["ONE"],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("At least 2 transport numbers")
    })

    it("throws for compare_transports with empty array", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            action: "compare_transports",
            transportNumbers: [],
            connectionId: "dev100"
          }),
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

      await tool.invoke(makeOptions({ action: "get_user_transports" }), mockToken)

      expect(getClient).toHaveBeenCalledWith("dev200")
    })
  })
})
