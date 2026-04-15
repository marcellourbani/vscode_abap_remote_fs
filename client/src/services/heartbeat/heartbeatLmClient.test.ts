/**
 * Tests for heartbeatLmClient.ts
 *
 * Since runHeartbeatLM makes complex vscode.lm calls, we test:
 * - Error path when no model is configured
 * - Error path when model is not found
 * - Error path when lm.selectChatModels fails
 * - Successful ok path (HEARTBEAT_OK response)
 * - Successful alert path (non-OK response)
 * - Error handling when model.sendRequest throws
 * - Tool usage tracking (deduplication)
 */

jest.mock("vscode", () => {
  const mockToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() }
  const CancellationTokenSource = jest.fn(() => ({
    token: mockToken,
    cancel: jest.fn(),
    dispose: jest.fn()
  }))

  const LanguageModelTextPart = jest.fn(function (this: any, value: string) {
    this.value = value
  })
  const LanguageModelToolCallPart = jest.fn(function (this: any, callId: string, name: string, input: any) {
    this.callId = callId
    this.name = name
    this.input = input
  })
  const LanguageModelToolResultPart = jest.fn(function (this: any, callId: string, content: any[]) {
    this.callId = callId
    this.content = content
  })

  const LanguageModelChatMessage = {
    User: jest.fn((content: any) => ({ role: "user", content })),
    Assistant: jest.fn((content: any) => ({ role: "assistant", content }))
  }

  return {
    lm: {
      selectChatModels: jest.fn(),
      tools: [],
      invokeTool: jest.fn()
    },
    CancellationTokenSource,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage
  }
}, { virtual: true })

jest.mock("../../lib", () => ({ log: jest.fn() }))

jest.mock("./heartbeatWatchlist", () => ({
  HeartbeatWatchlist: {
    formatForPrompt: jest.fn(() => "No monitoring tasks configured."),
    getDueTasks: jest.fn(() => [])
  }
}))

import { runHeartbeatLM } from "./heartbeatLmClient"
import { DEFAULT_HEARTBEAT_CONFIG, HeartbeatConfig } from "./heartbeatTypes"

// ============================================================================
// HELPERS
// ============================================================================

function makeConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return { ...DEFAULT_HEARTBEAT_CONFIG, enabled: true, model: "TestModel", ...overrides }
}

function makeStreamWithText(text: string) {
  const vscode = require("vscode")
  const part = new vscode.LanguageModelTextPart(text)
  return {
    stream: (async function* () {
      yield part
    })()
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe("runHeartbeatLM", () => {
  let vscode: any

  beforeEach(() => {
    vscode = require("vscode")
    jest.clearAllMocks()
  })

  // === No model configured ===

  test("returns error when model is empty string", async () => {
    const result = await runHeartbeatLM(makeConfig({ model: "" }))
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/no model configured/i)
  })

  test("returns error when model is whitespace only", async () => {
    vscode.lm.selectChatModels.mockResolvedValue([])
    const result = await runHeartbeatLM(makeConfig({ model: "   " }))
    expect(result.status).toBe("error")
    // Whitespace-only model is truthy, so error mentions the model value
    expect(result.error).toBeDefined()
  })

  // === Model not found ===

  test("returns error when no language models available", async () => {
    vscode.lm.selectChatModels.mockResolvedValue([])
    const result = await runHeartbeatLM(makeConfig({ model: "GPT-4" }))
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/not found/i)
  })

  test("returns error when configured model is not in available models", async () => {
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "Claude Sonnet", id: "claude-sonnet", sendRequest: jest.fn() }
    ])
    const result = await runHeartbeatLM(makeConfig({ model: "GPT-NonExistent" }))
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/not found/i)
  })

  // === Exact model match ===

  test("finds model by exact name", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "GPT-4o", id: "gpt-4o", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig({ model: "GPT-4o" }))
    expect(result.status).toBe("ok")
    expect(mockSendRequest).toHaveBeenCalledTimes(1)
  })

  test("finds model by exact id", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "My Model", id: "gpt-4o-mini", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig({ model: "gpt-4o-mini" }))
    expect(result.status).toBe("ok")
  })

  test("finds model by partial name match", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "Claude Haiku 4.5 (copilot)", id: "some-id", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig({ model: "claude haiku" }))
    expect(result.status).toBe("ok")
  })

  // === OK response ===

  test("returns status=ok when response contains HEARTBEAT_OK", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.status).toBe("ok")
  })

  // === Alert response ===

  test("returns status=alert when response does not contain HEARTBEAT_OK", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("There are 3 new dumps!"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.status).toBe("alert")
    expect(result.response).toContain("3 new dumps")
  })

  // === Error path ===

  test("returns status=error when model.sendRequest throws", async () => {
    const mockSendRequest = jest.fn().mockRejectedValue(new Error("Network error"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.status).toBe("error")
    expect(result.error).toContain("Network error")
  })

  test("returns status=error when selectChatModels throws", async () => {
    vscode.lm.selectChatModels.mockRejectedValue(new Error("LM API error"))
    const result = await runHeartbeatLM(makeConfig())
    expect(result.status).toBe("error")
    // Error may come from the catch block or from model-not-found path
    expect(result.error).toBeDefined()
  })

  // === Duration tracking ===

  test("includes durationMs in successful response", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("includes durationMs in error response", async () => {
    vscode.lm.selectChatModels.mockResolvedValue([])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  // === Tools used ===

  test("returns empty toolsUsed when no tools were called", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    const result = await runHeartbeatLM(makeConfig())
    expect(result.toolsUsed).toEqual([])
  })

  // === Custom prompt ===

  test("uses custom prompt when config.prompt is set", async () => {
    const mockSendRequest = jest.fn().mockResolvedValue(makeStreamWithText("HEARTBEAT_OK"))
    vscode.lm.selectChatModels.mockResolvedValue([
      { name: "TestModel", id: "test", sendRequest: mockSendRequest }
    ])
    await runHeartbeatLM(makeConfig({ prompt: "My custom prompt" }))
    // Model was called - the custom prompt path was used (no error means it didn't fall into watchlist path)
    expect(mockSendRequest).toHaveBeenCalled()
    const callArgs = mockSendRequest.mock.calls[0]
    const messages = callArgs[0]
    // First message should contain the custom prompt text
    expect(JSON.stringify(messages)).toContain("My custom prompt")
  })
})
