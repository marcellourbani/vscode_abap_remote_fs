jest.mock("vscode", () => ({
  window: {
    createOutputChannel: jest.fn()
  }
}), { virtual: true })

jest.mock("../lib/logger", () => {
  const mockChannel = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    show: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn()
  }
  return { channel: mockChannel }
})

import { copilotLogger, logInlineProvider, logSearch, logCommands } from "./abapCopilotLogger"
import { channel } from "../lib/logger"

const mockChannel = channel as any

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── copilotLogger singleton ──────────────────────────────────────────────────

describe("copilotLogger singleton", () => {
  test("copilotLogger is defined", () => {
    expect(copilotLogger).toBeDefined()
  })

  test("repeated require returns same exported instance", () => {
    const { copilotLogger: a } = require("./abapCopilotLogger")
    const { copilotLogger: b } = require("./abapCopilotLogger")
    expect(a).toBe(b)
  })
})

// ─── copilotLogger.info ───────────────────────────────────────────────────────

describe("copilotLogger.info", () => {
  test("calls outputChannel.info with formatted message", () => {
    copilotLogger.info("MyComponent", "test info message")
    expect(mockChannel.info).toHaveBeenCalledWith("[MyComponent] test info message")
  })

  test("formats message with component prefix", () => {
    copilotLogger.info("Search", "found 5 results")
    const call = mockChannel.info.mock.calls[0][0] as string
    expect(call).toMatch(/^\[Search\]/)
    expect(call).toContain("found 5 results")
  })
})

// ─── copilotLogger.warn ───────────────────────────────────────────────────────

describe("copilotLogger.warn", () => {
  test("calls outputChannel.warn with formatted message", () => {
    copilotLogger.warn("InlineProvider", "something might be wrong")
    expect(mockChannel.warn).toHaveBeenCalledWith("[InlineProvider] something might be wrong")
  })
})

// ─── copilotLogger.error ──────────────────────────────────────────────────────

describe("copilotLogger.error", () => {
  test("calls outputChannel.error with formatted message", () => {
    copilotLogger.error("Commands", "something failed")
    expect(mockChannel.error).toHaveBeenCalledWith("[Commands] something failed")
  })

  test("appends error object to message", () => {
    const err = new Error("underlying cause")
    copilotLogger.error("Commands", "something failed", err)

    const call = mockChannel.error.mock.calls[0][0] as string
    expect(call).toContain("Error: Error: underlying cause")
  })

  test("appends stack trace when available", () => {
    const err = new Error("with stack")
    err.stack = "Error: with stack\n  at line1"
    copilotLogger.error("Commands", "failed", err)

    const call = mockChannel.error.mock.calls[0][0] as string
    expect(call).toContain("Stack:")
    expect(call).toContain("at line1")
  })

  test("works without error argument", () => {
    expect(() => copilotLogger.error("Commands", "plain error")).not.toThrow()
    expect(mockChannel.error).toHaveBeenCalledWith("[Commands] plain error")
  })
})

// ─── copilotLogger.debug ──────────────────────────────────────────────────────

describe("copilotLogger.debug", () => {
  test("calls outputChannel.debug with formatted message", () => {
    copilotLogger.debug("Search", "debug info")
    expect(mockChannel.debug).toHaveBeenCalledWith("[Search] debug info")
  })
})

// ─── copilotLogger.trace ──────────────────────────────────────────────────────

describe("copilotLogger.trace", () => {
  test("calls outputChannel.trace with operation in message", () => {
    copilotLogger.trace("InlineProvider", "fetchData")
    const call = mockChannel.trace.mock.calls[0][0] as string
    expect(call).toContain("TRACE: fetchData")
    expect(call).toContain("[InlineProvider]")
  })

  test("includes JSON-serialized data when provided", () => {
    copilotLogger.trace("Search", "searchObjects", { query: "ZTEST*", count: 5 })
    const call = mockChannel.trace.mock.calls[0][0] as string
    expect(call).toContain('"query": "ZTEST*"')
    expect(call).toContain('"count": 5')
  })

  test("works without data argument", () => {
    expect(() => copilotLogger.trace("Search", "noData")).not.toThrow()
    expect(mockChannel.trace).toHaveBeenCalled()
  })
})

// ─── copilotLogger.show ──────────────────────────────────────────────────────

describe("copilotLogger.show", () => {
  test("delegates to outputChannel.show", () => {
    copilotLogger.show()
    expect(mockChannel.show).toHaveBeenCalled()
  })
})

// ─── copilotLogger.clear ─────────────────────────────────────────────────────

describe("copilotLogger.clear", () => {
  test("delegates to outputChannel.clear", () => {
    copilotLogger.clear()
    expect(mockChannel.clear).toHaveBeenCalled()
  })
})

// ─── copilotLogger.dispose ───────────────────────────────────────────────────

describe("copilotLogger.dispose", () => {
  test("delegates to outputChannel.dispose", () => {
    copilotLogger.dispose()
    expect(mockChannel.dispose).toHaveBeenCalled()
  })
})

// ─── logInlineProvider facade ─────────────────────────────────────────────────

describe("logInlineProvider facade", () => {
  test("info uses 'InlineProvider' component", () => {
    logInlineProvider.info("something happened")
    expect(mockChannel.info).toHaveBeenCalledWith("[InlineProvider] something happened")
  })

  test("warn uses 'InlineProvider' component", () => {
    logInlineProvider.warn("warning here")
    expect(mockChannel.warn).toHaveBeenCalledWith("[InlineProvider] warning here")
  })

  test("error uses 'InlineProvider' component", () => {
    logInlineProvider.error("error occurred")
    expect(mockChannel.error).toHaveBeenCalledWith("[InlineProvider] error occurred")
  })

  test("debug uses 'InlineProvider' component", () => {
    logInlineProvider.debug("debug info")
    expect(mockChannel.debug).toHaveBeenCalledWith("[InlineProvider] debug info")
  })

  test("trace uses 'InlineProvider' component", () => {
    logInlineProvider.trace("operation", { key: "value" })
    const call = mockChannel.trace.mock.calls[0][0] as string
    expect(call).toContain("[InlineProvider]")
    expect(call).toContain("TRACE: operation")
  })
})

// ─── logSearch facade ─────────────────────────────────────────────────────────

describe("logSearch facade", () => {
  test("info uses 'Search' component", () => {
    logSearch.info("search info")
    expect(mockChannel.info).toHaveBeenCalledWith("[Search] search info")
  })

  test("warn uses 'Search' component", () => {
    logSearch.warn("search warn")
    expect(mockChannel.warn).toHaveBeenCalledWith("[Search] search warn")
  })

  test("error uses 'Search' component", () => {
    logSearch.error("search error")
    expect(mockChannel.error).toHaveBeenCalledWith("[Search] search error")
  })

  test("debug uses 'Search' component", () => {
    logSearch.debug("search debug")
    expect(mockChannel.debug).toHaveBeenCalledWith("[Search] search debug")
  })

  test("trace uses 'Search' component", () => {
    logSearch.trace("findObjects", { pattern: "Z*" })
    const call = mockChannel.trace.mock.calls[0][0] as string
    expect(call).toContain("[Search]")
    expect(call).toContain("TRACE: findObjects")
  })
})

// ─── logCommands facade ───────────────────────────────────────────────────────

describe("logCommands facade", () => {
  test("info uses 'Commands' component", () => {
    logCommands.info("command info")
    expect(mockChannel.info).toHaveBeenCalledWith("[Commands] command info")
  })

  test("warn uses 'Commands' component", () => {
    logCommands.warn("command warn")
    expect(mockChannel.warn).toHaveBeenCalledWith("[Commands] command warn")
  })

  test("error uses 'Commands' component", () => {
    logCommands.error("command error")
    expect(mockChannel.error).toHaveBeenCalledWith("[Commands] command error")
  })

  test("debug uses 'Commands' component", () => {
    logCommands.debug("command debug")
    expect(mockChannel.debug).toHaveBeenCalledWith("[Commands] command debug")
  })

  test("trace uses 'Commands' component", () => {
    logCommands.trace("executeActivate", { object: "ZCL_TEST" })
    const call = mockChannel.trace.mock.calls[0][0] as string
    expect(call).toContain("[Commands]")
    expect(call).toContain("TRACE: executeActivate")
  })
})

// ─── Message formatting edge cases ───────────────────────────────────────────

describe("message formatting edge cases", () => {
  test("empty component string still formats message", () => {
    copilotLogger.info("", "test message")
    expect(mockChannel.info).toHaveBeenCalledWith("[] test message")
  })

  test("empty message string still formats correctly", () => {
    copilotLogger.info("MyComponent", "")
    expect(mockChannel.info).toHaveBeenCalledWith("[MyComponent] ")
  })

  test("component and message with special characters", () => {
    copilotLogger.info("My/Component[1]", "message: value=42 & done")
    expect(mockChannel.info).toHaveBeenCalledWith("[My/Component[1]] message: value=42 & done")
  })

  test("trace with null data does not crash", () => {
    expect(() => copilotLogger.trace("Component", "operation", null)).not.toThrow()
  })

  test("error with string as error argument", () => {
    copilotLogger.error("Component", "failed", "plain string error")
    const call = mockChannel.error.mock.calls[0][0] as string
    expect(call).toContain("plain string error")
  })
})
