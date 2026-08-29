jest.mock(
  "vscode",
  () => ({
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts }))
  }),
  { virtual: true }
)

jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))

import { SapTestSetupTool } from "./sapTestSetupTool"
import { logTelemetry } from "../telemetry"

describe("SapTestSetupTool", () => {
  it("describes the setup before invocation", async () => {
    const tool = new SapTestSetupTool()
    const result = await tool.prepareInvocation()

    expect(result.invocationMessage).toBe(
      "Discovering ABAP FS SAP Testing Factory and how to enable it"
    )
  })

  it("returns the testing overview and setup guidance", async () => {
    const tool = new SapTestSetupTool()
    const result: any = await tool.invoke({ input: {} } as any, {} as any)
    const text = result.parts[0].text

    expect(text).toContain("complete SAP UI testing factory")
    expect(text).toContain("ABAP FS: Enable SAP UI Testing Features")
    expect(text).toContain("ABAP FS: Set Models for Subagents")
    expect(text).toContain("abapfs_manage_subagents")
    expect(text).toContain('abapfs_search_documentation" with action "search_documentation"')
    expect(text).toContain("/sap-testing")
    expect(logTelemetry).toHaveBeenCalledWith("tool_sap_test_setup_called")
  })
})
