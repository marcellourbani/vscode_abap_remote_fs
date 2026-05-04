jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../abapCopilotLogger", () => ({
  logCommands: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))
jest.mock("abap-adt-api", () => ({
  session_types: { stateful: "stateful", stateless: "stateless" }
}))
jest.mock("../../adt/textElements", () => ({
  getTextElementsSafe: jest.fn(),
  updateTextElementsWithTransport: jest.fn()
}))
jest.mock("../../commands/textElementsCommands", () => ({
  openTextElementsInSapGui: jest.fn()
}))

import { ManageTextElementsTool } from "./textElementsTools"
import { getClient, abapUri } from "../../adt/conections"
import { getTextElementsSafe, updateTextElementsWithTransport } from "../../adt/textElements"
import { funWindow as window } from "../funMessenger"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any
function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = { stateful: undefined as any }

describe("ManageTextElementsTool", () => {
  let tool: ManageTextElementsTool

  beforeEach(() => {
    tool = new ManageTextElementsTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
    mockClient.stateful = undefined
  })

  // =========================================================================
  // prepareInvocation
  // =========================================================================
  describe("prepareInvocation", () => {
    it("builds correct message for read action", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
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
          textElements: [{ id: "001", text: "Hello" }, { id: "002", text: "World" }],
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
        makeOptions({ objectName: "ZFG_TEST", objectType: "FUNCTION_GROUP", action: "read", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("FUNCTION_GROUP")
      expect(result.invocationMessage).toContain("FUNCTION_GROUP")
    })

    it("shows 0 elements when textElements is undefined for create", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "create", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("0")
    })
  })

  // =========================================================================
  // invoke — read action
  // =========================================================================
  describe("invoke read action", () => {
    it("calls getTextElementsSafe with correct params", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Hello", maxLength: 20 }]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(getTextElementsSafe).toHaveBeenCalledWith(mockClient, "ZREPORT", "PROGRAM")
      expect(result.parts[0].text).toContain("ZREPORT")
      expect(result.parts[0].text).toContain("001")
      expect(result.parts[0].text).toContain("Hello")
      expect(result.parts[0].text).toContain("max: 20")
    })

    it("reports empty text elements", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: []
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("No text elements found")
    })

    it("logs telemetry on invocation", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZTEST", textElements: [] })

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(logTelemetry).toHaveBeenCalledWith("tool_manage_text_elements_called", { connectionId: "dev100" })
    })
  })

  // =========================================================================
  // invoke — connectionId resolution
  // =========================================================================
  describe("invoke connectionId resolution", () => {
    it("lowercases connectionId", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZTEST", textElements: [] })

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read", connectionId: "DEV100" }),
        mockToken
      )

      expect(getClient).toHaveBeenCalledWith("dev100")
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
      ;(abapUri as jest.Mock).mockReturnValue(false)

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
      ;(abapUri as jest.Mock).mockReturnValue(true)
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZTEST", textElements: [] })

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read" }),
        mockToken
      )

      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("throws when getClient returns null", async () => {
      ;(getClient as jest.Mock).mockReturnValue(null)

      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZTEST", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
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
            objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
            textElements: [], connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required")
    })

    it("throws when textElements is undefined for update", async () => {
      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT", objectType: "PROGRAM", action: "update",
            connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Text elements array is required")
    })

    it("calls updateTextElementsWithTransport for create with merged elements", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Existing" }]
      })
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
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
        "PROGRAM"
      )
      expect(result.parts[0].text).toContain("Created")
    })

    it("update action overwrites existing elements by ID", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Old Text" }, { id: "002", text: "Keep This" }]
      })
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "update",
          textElements: [{ id: "001", text: "New Text" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // Should merge: updated 001 + existing 002
      const calledElements = (updateTextElementsWithTransport as jest.Mock).mock.calls[0][2]
      expect(calledElements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "001", text: "New Text" }),
          expect.objectContaining({ id: "002", text: "Keep This" })
        ])
      )
    })

    it("proceeds with provided elements when reading existing fails", async () => {
      ;(getTextElementsSafe as jest.Mock).mockRejectedValue(new Error("Read failed"))
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
          textElements: [{ id: "001", text: "Only New" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // Should proceed with just the provided elements
      expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
        mockClient,
        "ZREPORT",
        [{ id: "001", text: "Only New" }],
        "PROGRAM"
      )
      expect(result.parts[0].text).toContain("Created")
    })

    it("sets client to stateful mode for create/update", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
          textElements: [{ id: "001", text: "test" }],
          connectionId: "dev100"
        }),
        mockToken
      )

      // session_types.stateful is imported; the code sets client.stateful to that value
      expect(mockClient.stateful).toBeDefined()
    })

    it("includes TEXT-xxx usage hints in create response", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
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
      ;(getTextElementsSafe as jest.Mock).mockRejectedValue(new Error("SAP connection timeout"))

      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to read text elements")
    })

    it("wraps updateTextElements errors with action context", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({ programName: "ZREPORT", textElements: [] })
      ;(updateTextElementsWithTransport as jest.Mock).mockRejectedValue(new Error("Lock failed"))

      await expect(
        tool.invoke(
          makeOptions({
            objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
            textElements: [{ id: "001", text: "test" }], connectionId: "dev100"
          }),
          mockToken
        )
      ).rejects.toThrow("Failed to create text elements")
    })

    it("throws on invalid action", async () => {
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "delete", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Invalid action")
    })

    it("handles Resource does not exist error with SAP GUI fallback", async () => {
      ;(getTextElementsSafe as jest.Mock).mockRejectedValue(new Error("Resource /foo does not exist"))
      const { openTextElementsInSapGui } = require("../../commands/textElementsCommands")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(openTextElementsInSapGui).toHaveBeenCalledWith("ZREPORT.prog.abap", "dev100")
      expect(result.parts[0].text).toContain("SAP GUI")
    })

    it("uses correct file extension for CLASS in SAP GUI fallback", async () => {
      ;(getTextElementsSafe as jest.Mock).mockRejectedValue(new Error("Resource /bar does not exist"))
      const { openTextElementsInSapGui } = require("../../commands/textElementsCommands")

      await tool.invoke(
        makeOptions({ objectName: "ZCL_TEST", objectType: "CLASS", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(openTextElementsInSapGui).toHaveBeenCalledWith("ZCL_TEST.clas.abap", "dev100")
    })

    it("uses correct file extension for FUNCTION_GROUP in SAP GUI fallback", async () => {
      ;(getTextElementsSafe as jest.Mock).mockRejectedValue(new Error("Resource /baz does not exist"))
      const { openTextElementsInSapGui } = require("../../commands/textElementsCommands")

      await tool.invoke(
        makeOptions({ objectName: "ZFG_TEST", objectType: "FUNCTION_GROUP", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(openTextElementsInSapGui).toHaveBeenCalledWith("ZFG_TEST.fugr.abap", "dev100")
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe("edge cases", () => {
    it("handles maxLength in text elements display", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Long Text", maxLength: 132 }]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("max: 132")
    })

    it("handles text element without maxLength", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [{ id: "001", text: "Short" }]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).not.toContain("max:")
    })

    it("create merges new elements with existing without duplicates", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "First" },
          { id: "002", text: "Second" }
        ]
      })
      ;(updateTextElementsWithTransport as jest.Mock).mockResolvedValue(undefined)

      await tool.invoke(
        makeOptions({
          objectName: "ZREPORT", objectType: "PROGRAM", action: "create",
          textElements: [
            { id: "002", text: "Updated Second" }, // overwrite
            { id: "003", text: "Brand New" }        // new
          ],
          connectionId: "dev100"
        }),
        mockToken
      )

      const calledElements = (updateTextElementsWithTransport as jest.Mock).mock.calls[0][2]
      // Should have 3 unique elements: 001 (kept), 002 (updated), 003 (new)
      expect(calledElements).toHaveLength(3)
      const ids = calledElements.map((e: any) => e.id)
      expect(ids).toContain("001")
      expect(ids).toContain("002")
      expect(ids).toContain("003")
      // 002 should have updated text
      const el002 = calledElements.find((e: any) => e.id === "002")
      expect(el002.text).toBe("Updated Second")
    })

    it("handles multiple text elements in result display", async () => {
      ;(getTextElementsSafe as jest.Mock).mockResolvedValue({
        programName: "ZREPORT",
        textElements: [
          { id: "001", text: "Alpha" },
          { id: "002", text: "Beta" },
          { id: "003", text: "Gamma" }
        ]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", objectType: "PROGRAM", action: "read", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Total Text Elements:** 3")
      expect(result.parts[0].text).toContain("Alpha")
      expect(result.parts[0].text).toContain("Beta")
      expect(result.parts[0].text).toContain("Gamma")
    })
  })
})
