jest.mock("vscode", () => ({
  ExtensionContext: jest.fn()
}), { virtual: true })

jest.mock("./search", () => ({
  SearchTool: jest.fn().mockImplementation(() => ({ id: "search" }))
}))

jest.mock("./unit", () => ({
  UnitTool: jest.fn().mockImplementation(() => ({ id: "unit" }))
}))

jest.mock("./activate", () => ({
  ActivateTool: jest.fn().mockImplementation(() => ({ id: "activate" }))
}))

jest.mock("../../services/lm-tools/toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))

import { registerChatTools } from "./tools"
import { registerToolWithRegistry } from "../../services/lm-tools/toolRegistry"
import { ActivateTool } from "./activate"

const mockRegisterTool = registerToolWithRegistry as jest.MockedFunction<typeof registerToolWithRegistry>

describe("registerChatTools", () => {
  let mockContext: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockContext = { subscriptions: { push: jest.fn() } }
  })

  test("registers the activate tool", () => {
    registerChatTools(mockContext)

    expect(mockRegisterTool).toHaveBeenCalledWith("abap_activate", expect.any(Object))
  })

  test("pushes disposable to subscriptions", () => {
    registerChatTools(mockContext)

    expect(mockContext.subscriptions.push).toHaveBeenCalled()
  })

  test("creates an ActivateTool instance", () => {
    registerChatTools(mockContext)

    expect(ActivateTool).toHaveBeenCalledTimes(1)
  })

  test("registers only activate tool (search and unit are dead code after early return)", () => {
    registerChatTools(mockContext)

    // The function returns early after registering abap_activate
    // search and unit are never registered
    expect(mockRegisterTool).toHaveBeenCalledTimes(1)
    expect(mockRegisterTool).toHaveBeenCalledWith("abap_activate", expect.any(Object))
    expect(mockRegisterTool).not.toHaveBeenCalledWith("abap_search", expect.any(Object))
    expect(mockRegisterTool).not.toHaveBeenCalledWith("abap_unit", expect.any(Object))
  })
})
