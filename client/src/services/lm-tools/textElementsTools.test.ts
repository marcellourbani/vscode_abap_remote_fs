vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (value: string) {
    return { value }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  abapUri: vi.fn()
}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapCopilotLogger", () => ({
  logCommands: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))
vi.mock("abap-adt-api", () => ({
  session_types: { stateful: "stateful", stateless: "stateless" }
}))
vi.mock("../../adt/textElements", () => ({
  getTextElementsSafe: vi.fn(),
  updateTextElementsWithTransport: vi.fn()
}))
vi.mock("../../commands/textElementsCommands", () => ({
  openTextElementsInSapGui: vi.fn()
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { ManageTextElementsTool } from "./textElementsTools"
import { getClient, abapUri } from "../../adt/conections"
import { getTextElementsSafe, updateTextElementsWithTransport } from "../../adt/textElements"
import { funWindow as window } from "../funMessenger"
import { logTelemetry } from "../telemetry"
import * as __$mock_commands_textElementsCommands from "../../commands/textElementsCommands"
import type { Mock } from "vitest"

const mockToken = {} as any
function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = { stateful: undefined as any }

describe("ManageTextElementsTool", () => {
  let tool: ManageTextElementsTool

  beforeEach(() => {
    tool = new ManageTextElementsTool()
    vi.clearAllMocks()
    ;(getClient as Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
    mockClient.stateful = undefined
  })

  // =========================================================================
  // prepareInvocation
  // =========================================================================
  describe("prepareInvocation", () => {
    it("builds correct message for read action", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("Reading")
      expect(result.invocationMessage).toContain("ZREPORT")
      expect(result.confirmationMessages.title).toBe("Read Text Elements")
    })

    it("builds correct message for create action with element count", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCL_TEST",
          objectType: "CLASS",
          action: "create",
          textElements: [
            { id: "001", text: "Hello" },
            { id: "002", text: "World" }
          ],
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("Creating")
      expect(result.invocationMessage).toContain("ZCL_TEST")
      expect(result.confirmationMessages.title).toBe("Create Text Elements")
      // The message should include element count
      expect(result.confirmationMessages.message.value).toContain("2")
      // Should include best practice tip
      expect(result.confirmationMessages.message.value).toContain("Best Practice")
    })

    it("builds correct message for update action with warning", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "update",
          textElements: [{ id: "001", text: "Updated" }],
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("Updating")
      expect(result.confirmationMessages.title).toBe("Update Text Elements")
      // Update should have a warning about modifying
      expect(result.confirmationMessages.message.value).toContain("modify existing")
    })

    it("shows auto-detect when no connectionId", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("auto-detect")
    })

    it("shows objectType in message when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZFG_TEST",
          objectType: "FUNCTION_GROUP",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("FUNCTION_GROUP")
      expect(result.invocationMessage).toContain("FUNCTION_GROUP")
    })

    it("rejects create without textElements", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required for create operations")
    })
  })

  // =========================================================================
  // invoke — read action
  // =========================================================================
  describe("invoke read action", () => {
    it("calls getTextElementsSafe with correct params", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Hello", maxLength: 20 }]
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(getTextElementsSafe).toHaveBeenCalledWith(mockClient, "ZREPORT", "PROGRAM", "symbols")
      expect(result.parts[0].text).toContain("ZREPORT")
      expect(result.parts[0].text).toContain("001")
      expect(result.parts[0].text).toContain("Hello")
      expect(result.parts[0].text).toContain("max: 20")
    })

    it("passes the requested category to the ADT helper", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "P_NAME", text: "Name" }]
      })

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "selections",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(getTextElementsSafe).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        "PROGRAM",
        "selections"
      )
    })

    it("reports empty text elements", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: []
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("No text elements found")
    })

    it("logs telemetry on invocation", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZTEST",
        textElements: []
      })

      await tool.invoke(
        makeOptions({
          objectName: "ZTEST",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(logTelemetry).toHaveBeenCalledWith("tool_manage_text_elements_called", {
        connectionId: "dev100"
      })
    })
  })

  // =========================================================================
  // invoke — connectionId resolution
  // =========================================================================
  describe("invoke connectionId resolution", () => {
    it("lowercases connectionId", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZTEST",
        textElements: []
      })

      await tool.invoke(
        makeOptions({
          objectName: "ZTEST",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "DEV100"
        }),
        mockToken
      )

      expect(getClient).toHaveBeenCalledWith("dev100", true)
    })

    it("throws when no connectionId and no active editor", async () => {
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read" }),
          mockToken
        )
      ).rejects.toThrow("No active ABAP document")
    })

    it("throws when active editor has non-ABAP uri", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "local", scheme: "file" } }
      }
      ;(abapUri as Mock).mockReturnValue(false)

      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read" }),
          mockToken
        )
      ).rejects.toThrow("No active ABAP document")
    })

    it("resolves connectionId from active ABAP editor", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "dev100", scheme: "adt" } }
      }
      ;(abapUri as Mock).mockReturnValue(true)
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZTEST",
        textElements: []
      })

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read" }),
        mockToken
      )

      expect(getClient).toHaveBeenCalledWith("dev100", true)
    })

    it("throws when getClient returns null", async () => {
      ;(getClient as Mock).mockReturnValue(null)

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZTEST",
            objectType: "PROGRAM",
            action: "read",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("No ADT connection available")
    })
  })

  // =========================================================================
  // invoke — create/update actions
  // =========================================================================
  describe("invoke create/update actions", () => {
    it("throws when textElements is empty for create", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required")
    })

    it("throws when textElements is undefined for update", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "update",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required")
    })

    it("rejects create for selection texts before contacting SAP", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            category: "selections",
            action: "create",
            textElements: [{ id: "P_NEW", text: "New" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("supports update only")

      expect(getClient).not.toHaveBeenCalled()
    })

    it("calls updateTextElementsWithTransport for create with merged elements", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Existing" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "create",
          textElements: [{ id: "002", text: "New Element" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // Should merge: existing 001 + new 002
      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        expect.arrayContaining([
          expect.objectContaining({ id: "001", text: "Existing" }),
          expect.objectContaining({ id: "002", text: "New Element" })
        ]),
        "PROGRAM",
        "symbols"
      )
      expect(result.parts[0].text).toContain("Created")
    })

    it("update action overwrites existing elements by ID", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "Old Text" },
          { id: "002", text: "Keep This" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "update",
          textElements: [{ id: "001", text: "New Text" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // Should merge: updated 001 + existing 002
      const calledElements = (updateTextElementsWithTransport as Mock).mock.calls[0][2]
      expect(calledElements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "001", text: "New Text" }),
          expect.objectContaining({ id: "002", text: "Keep This" })
        ])
      )
    })

    it("does not write when reading existing elements fails", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Read failed"))
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "Only New" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Could not read existing text elements for create operation")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("sets client to stateful mode for create/update", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: []
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "create",
          textElements: [{ id: "001", text: "test" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // session_types.stateful is imported; the code sets client.stateful to that value
      expect(mockClient.stateful).toBeDefined()
    })

    it("includes TEXT-xxx usage hints in create response", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: []
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "create",
          textElements: [{ id: "T01", text: "Title" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("TEXT-T01")
    })
  })

  // =========================================================================
  // invoke — error handling
  // =========================================================================
  describe("invoke error handling", () => {
    it("wraps SAP API errors with action context", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("SAP connection timeout"))

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "read",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Failed to read text elements")
    })

    it("wraps updateTextElements errors with action context", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: []
      })
      ;(updateTextElementsWithTransport as Mock).mockRejectedValue(new Error("Lock failed"))

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "test" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Failed to create text elements")
    })

    it("throws on invalid action", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "invalid_action",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Invalid action")
    })

    it("returns unsupported guidance instead of opening SE38 for read", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Resource /foo does not exist"))
      const { openTextElementsInSapGui } = __$mock_commands_textElementsCommands

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(openTextElementsInSapGui).not.toHaveBeenCalled()
      expect(result.parts[0].text).toContain("not available on system DEV100")
      expect(result.parts[0].text).toContain("SE38 was not opened")
      expect(result.parts[0].text).toContain("Ask the user whether to open ZREPORT in SE38")
      expect(result.parts[0].text).toContain("Only if they say yes")
      expect(result.parts[0].text).toContain(
        'abapfs_get_sap_webgui_url with connectionId "dev100" and transaction "SE38"'
      )
    })

    it.each([
      ["CLASS", "ZCL_TEST"],
      ["FUNCTION_GROUP", "ZFG_TEST"]
    ])("does not open SE38 for %s reads on unsupported systems", async (objectType, objectName) => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Resource /bar does not exist"))
      const { openTextElementsInSapGui } = __$mock_commands_textElementsCommands

      const result: any = await tool.invoke(
        makeOptions({ objectName, objectType, action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(openTextElementsInSapGui).not.toHaveBeenCalled()
      expect(result.parts[0].text).toContain(objectName)
    })

    it.each(["create", "update", "delete"])(
      "%s on an unsupported system throws guidance and writes nothing",
      async action => {
        ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Resource /foo does not exist"))
        const { openTextElementsInSapGui } = __$mock_commands_textElementsCommands

        await expect(
          tool.invoke(
            makeOptions({
              objectName: "ZREPORT",
              objectType: "PROGRAM",
              action,
              textElements: [{ id: "001", text: "x" }],
              connectionId: "dev100"
            }),
            mockToken
          )
        ).rejects.toThrow("ADT text elements API is not available on system DEV100")

        expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
        expect(openTextElementsInSapGui).not.toHaveBeenCalled()
      }
    )
  })

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe("edge cases", () => {
    it("handles maxLength in text elements display", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Long Text", maxLength: 132 }]
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("max: 132")
    })

    it("handles text element without maxLength", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Short" }]
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).not.toContain("max:")
    })

    it("create adds new elements alongside existing ones", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "First" },
          { id: "002", text: "Second" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "create",
          textElements: [{ id: "003", text: "Brand New" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      const calledElements = (updateTextElementsWithTransport as Mock).mock.calls[0][2]
      expect(calledElements).toEqual([
        { id: "001", text: "First" },
        { id: "002", text: "Second" },
        { id: "003", text: "Brand New" }
      ])
    })

    it("handles multiple text elements in result display", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "Alpha" },
          { id: "002", text: "Beta" },
          { id: "003", text: "Gamma" }
        ]
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "read",
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Total: 3")
      expect(result.parts[0].text).toContain("Alpha")
      expect(result.parts[0].text).toContain("Beta")
      expect(result.parts[0].text).toContain("Gamma")
    })
  })

  // =========================================================================
  // prepareInvocation — input validation and delete
  // =========================================================================
  describe("prepareInvocation input validation", () => {
    it("builds delete message with count and warning without requiring text", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "selections",
          action: "delete",
          textElements: [{ id: "P_NAME" }, { id: "P_DATE" }],
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("Deleting")
      expect(result.confirmationMessages.title).toBe("Delete Text Elements")
      expect(result.confirmationMessages.message.value).toContain("**Text Elements:** 2")
      expect(result.confirmationMessages.message.value).toContain(
        "This will delete existing text elements"
      )
    })

    it("rejects delete without textElements", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "delete" }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required for delete operations")
    })

    it("rejects create when one element has no text", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "Ok" }, { id: "002" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text is required for create operations; element 002 has no text")
    })

    it("rejects update when text is whitespace only", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "update",
            textElements: [{ id: "001", text: "   " }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("element 001 has no text")
    })

    it("rejects an unknown action", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "bogus" }),
          mockToken
        )
      ).rejects.toThrow("Invalid action: bogus")
    })
  })

  // =========================================================================
  // invoke — delete action
  // =========================================================================
  describe("invoke delete action", () => {
    const existing = [
      { id: "001", text: "Alpha", maxLength: 10 },
      { id: "002", text: "Beta", maxLength: 10 },
      { id: "003", text: "Gamma", maxLength: 10 }
    ]

    it("writes only the remaining elements when deleting by ID", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "002" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [existing[0], existing[2]],
        "PROGRAM",
        "symbols"
      )
    })

    it("reports only the elements that were actually deleted", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "002" }, { id: "999" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Deleted: 1")
      expect(result.parts[0].text).toContain("• 002")
      expect(result.parts[0].text).not.toContain("999")
    })

    it("does not write to SAP when no requested ID exists", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "999" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
      expect(result.parts[0].text).toContain("No matching text elements to delete in ZREPORT")
      expect(result.parts[0].text).toContain("SAP was not changed")
    })

    it("keeps the client stateless when nothing matches", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "999" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(mockClient.stateful).toBeUndefined()
    })

    it("does not write to SAP when the object has no text elements", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "001" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
      expect(result.parts[0].text).toContain("No matching text elements")
    })

    it("throws without writing when existing elements cannot be read", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Read failed"))

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "delete",
            textElements: [{ id: "001" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Could not read existing text elements for delete operation")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("sends an empty set when every element is deleted", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "001" }, { id: "002" }, { id: "003" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [],
        "PROGRAM",
        "symbols"
      )
      expect(result.parts[0].text).toContain("Deleted: 3")
    })

    it("keeps existing blank-text elements when deleting another element", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "" },
          { id: "002", text: "Beta" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "002" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "001", text: "" }],
        "PROGRAM",
        "symbols"
      )
    })

    it("sets the client to stateful when a delete writes", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "001" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(mockClient.stateful).toBeDefined()
    })

    it("omits TEXT- usage hints after delete", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: existing
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "001" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).not.toContain("TEXT-")
    })

    it("deletes from selection texts", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "P_NAME", text: "Name" },
          { id: "P_DATE", text: "Date" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "selections",
          action: "delete",
          textElements: [{ id: "P_NAME" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(getTextElementsSafe).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        "PROGRAM",
        "selections"
      )
      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "P_DATE", text: "Date" }],
        "PROGRAM",
        "selections"
      )
    })

    it("deletes from list headings", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "LISTHEADER", text: "Heading" },
          { id: "COLUMNHEADER_1", text: "Column" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "headings",
          action: "delete",
          textElements: [{ id: "LISTHEADER" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(getTextElementsSafe).toHaveBeenCalledWith(mockClient, "ZREPORT", "PROGRAM", "headings")
      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "COLUMNHEADER_1", text: "Column" }],
        "PROGRAM",
        "headings"
      )
    })

    it("reports a heading delete as cleared", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "LISTHEADER", text: "Heading" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "headings",
          action: "delete",
          textElements: [{ id: "LISTHEADER" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Text Elements Cleared for ZREPORT")
      expect(result.parts[0].text).toContain("Cleared: 1")
      expect(result.parts[0].text).not.toContain("Deleted")
    })

    it("reports a selection delete as cleared", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "P_NAME", text: "Name" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "selections",
          action: "delete",
          textElements: [{ id: "P_NAME" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Text Elements Cleared for ZREPORT")
      expect(result.parts[0].text).toContain("Cleared: 1")
      expect(result.parts[0].text).not.toContain("Deleted")
    })

    it("keeps the Deleted wording for symbol deletes", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Alpha" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "delete",
          textElements: [{ id: "001" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Text Elements Deleted for ZREPORT")
      expect(result.parts[0].text).not.toContain("Cleared")
    })
  })

  // =========================================================================
  // invoke — input validation and category support for create/update
  // =========================================================================
  describe("invoke input validation and categories", () => {
    it("rejects update with blank text before contacting SAP", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "update",
            textElements: [{ id: "001", text: "" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text is required for update operations; element 001 has no text")

      expect(getClient).not.toHaveBeenCalled()
      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("rejects create when text is missing from a later element", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "Ok" }, { id: "002" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("element 002 has no text")
    })

    it("rejects whitespace-only text on create", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "  " }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text is required for create operations")
    })

    it("rejects create without textElements before contacting SAP", async () => {
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "create" }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required for create operations")

      expect(getClient).not.toHaveBeenCalled()
    })

    it("rejects create for list headings", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            category: "headings",
            action: "create",
            textElements: [{ id: "LISTHEADER", text: "Heading" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Cannot create headings text elements")

      expect(getClient).not.toHaveBeenCalled()
    })

    it("allows update for list headings without TEXT- hints", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "LISTHEADER", text: "Old" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "headings",
          action: "update",
          textElements: [{ id: "LISTHEADER", text: "New" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "LISTHEADER", text: "New" }],
        "PROGRAM",
        "headings"
      )
      expect(result.parts[0].text).toContain("Updated: 1")
      expect(result.parts[0].text).not.toContain("TEXT-")
    })

    it("allows update for selection texts without TEXT- hints", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "P_NAME", text: "Name" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "selections",
          action: "update",
          textElements: [{ id: "P_NAME", text: "Full name" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).not.toContain("TEXT-")
    })

    it("keeps existing blank-text elements when creating another", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "create",
          textElements: [{ id: "002", text: "New" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [
          { id: "001", text: "" },
          { id: "002", text: "New" }
        ],
        "PROGRAM",
        "symbols"
      )
    })

    it("reports only the updated elements, not untouched existing ones", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "First" },
          { id: "002", text: "Second" }
        ]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          action: "update",
          textElements: [{ id: "001", text: "Changed" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Updated: 1")
      expect(result.parts[0].text).not.toContain("002:")
    })

    it("rejects an unknown action before writing", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "bogus",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Invalid action: bogus")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // ID normalization
  // =========================================================================
  describe("ID normalization", () => {
    const invokeWith = (input: any) =>
      tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          connectionId: "dev100",
          ...input
        }),
        mockToken
      )

    beforeEach(() => {
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)
    })

    it("deletes an uppercase element when the ID is given in lowercase", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "P_NAME", text: "Name" },
          { id: "P_DATE", text: "Date" }
        ]
      })

      const result: any = await invokeWith({
        category: "selections",
        action: "delete",
        textElements: [{ id: "p_name" }]
      })

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "P_DATE", text: "Date" }],
        "PROGRAM",
        "selections"
      )
      expect(result.parts[0].text).toContain("Cleared: 1")
    })

    it("trims whitespace around IDs before matching", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "A" },
          { id: "002", text: "B" }
        ]
      })

      await invokeWith({ action: "delete", textElements: [{ id: " 001 " }] })

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "002", text: "B" }],
        "PROGRAM",
        "symbols"
      )
    })

    it("matches existing elements whose IDs SAP returned in lowercase", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "a01", text: "A" },
          { id: "b01", text: "B" }
        ]
      })

      await invokeWith({ action: "delete", textElements: [{ id: "A01" }] })

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "b01", text: "B" }],
        "PROGRAM",
        "symbols"
      )
    })

    it("allows the same ID twice in a delete and deletes it once", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "A" },
          { id: "002", text: "B" }
        ]
      })

      const result: any = await invokeWith({
        action: "delete",
        textElements: [{ id: "001" }, { id: "001" }]
      })

      expect(result.parts[0].text).toContain("Deleted: 1")
    })

    it("updates an existing uppercase element instead of adding a duplicate", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "A01", text: "Old" },
          { id: "B01", text: "Keep" }
        ]
      })

      const result: any = await invokeWith({
        action: "update",
        textElements: [{ id: "a01", text: "New" }]
      })

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [
          { id: "A01", text: "New" },
          { id: "B01", text: "Keep" }
        ],
        "PROGRAM",
        "symbols"
      )
      expect(result.parts[0].text).toContain("• A01:")
      expect(result.parts[0].text).toContain("TEXT-A01")
    })

    it("writes new elements with uppercase IDs", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })

      const result: any = await invokeWith({
        action: "create",
        textElements: [{ id: "t01", text: "Title", maxLength: 20 }]
      })

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "T01", text: "Title", maxLength: 20 }],
        "PROGRAM",
        "symbols"
      )
      expect(result.parts[0].text).toContain("TEXT-T01")
    })

    it("rejects create for an ID that already exists, without writing", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "First" }]
      })

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "001", text: "Overwrite" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow('Text element 001 already exists; use action "update"')

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("rejects update for an ID that does not exist, without writing", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "First" }]
      })

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "update",
            textElements: [{ id: "099", text: "Ghost" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow('Text element 099 does not exist; use action "create"')

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("rejects update of a selection that does not exist", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            category: "selections",
            action: "update",
            textElements: [{ id: "P_NAME", text: "Name" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text element P_NAME does not exist")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("rejects update of a heading that does not exist", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            category: "headings",
            action: "update",
            textElements: [{ id: "LISTHEADER", text: "Heading" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text element LISTHEADER does not exist")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("matches an existing heading stored in mixed case", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "listHeader", text: "Old" }]
      })
      ;(updateTextElementsWithTransport as Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT",
          objectType: "PROGRAM",
          category: "headings",
          action: "update",
          textElements: [{ id: "LISTHEADER", text: "New" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "LISTHEADER", text: "New" }],
        "PROGRAM",
        "headings"
      )
    })

    it("rejects a create for an ID that matches an existing one in another case", async () => {
      ;(getTextElementsSafe as Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "A01", text: "Old" }]
      })

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ id: "a01", text: "Overwrite" }],
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text element A01 already exists")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("does not write when reading existing elements fails for create", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Read failed"))

      await expect(
        invokeWith({ action: "create", textElements: [{ id: "t01", text: "Title" }] })
      ).rejects.toThrow("Could not read existing text elements for create operation")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("does not write when reading existing elements fails for update", async () => {
      ;(getTextElementsSafe as Mock).mockRejectedValue(new Error("Read failed"))

      await expect(
        invokeWith({ action: "update", textElements: [{ id: "t01", text: "Title" }] })
      ).rejects.toThrow("Could not read existing text elements for update operation")

      expect(updateTextElementsWithTransport).not.toHaveBeenCalled()
    })

    it("rejects IDs that differ only by case before contacting SAP", async () => {
      await expect(
        invokeWith({
          action: "create",
          textElements: [
            { id: "a01", text: "One" },
            { id: "A01", text: "Two" }
          ]
        })
      ).rejects.toThrow("Duplicate text element ID: A01")

      expect(getClient).not.toHaveBeenCalled()
    })

    it("rejects case-duplicate IDs in prepareInvocation", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "update",
            textElements: [
              { id: "a01", text: "One" },
              { id: " A01", text: "Two" }
            ]
          }),
          mockToken
        )
      ).rejects.toThrow("Duplicate text element ID: A01")
    })

    it("rejects a blank ID for delete before contacting SAP", async () => {
      await expect(invokeWith({ action: "delete", textElements: [{ id: "  " }] })).rejects.toThrow(
        "Each text element needs an id for delete operations"
      )

      expect(getClient).not.toHaveBeenCalled()
    })

    it("rejects a missing ID in prepareInvocation", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            objectName: "ZREPORT",
            objectType: "PROGRAM",
            action: "create",
            textElements: [{ text: "No id" }]
          }),
          mockToken
        )
      ).rejects.toThrow("Each text element needs an id for create operations")
    })
  })
})
