jest.mock("vscode", () => ({
  window: {
    createStatusBarItem: jest.fn(),
    showInformationMessage: jest.fn()
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  Disposable: jest.fn().mockImplementation((fn: () => void) => ({ dispose: fn })),
  env: { openExternal: jest.fn() },
  Uri: { parse: jest.fn(url => ({ toString: () => url })) },
  commands: { registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }) }
}), { virtual: true })

import * as vscode from "vscode"
import {
  initializeReviewPrompt,
  incrementReviewCounter
} from "./reviewPrompt"

const mockShowInfoMessage = vscode.window.showInformationMessage as jest.Mock
const mockCreateStatusBarItem = vscode.window.createStatusBarItem as jest.Mock
const mockEnvOpenExternal = vscode.env.openExternal as jest.Mock
const mockRegisterCommand = vscode.commands.registerCommand as jest.Mock

function makeStatusBarItem() {
  return {
    text: "",
    tooltip: "",
    command: "",
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn()
  }
}

function makeContext(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = {}
  const subscriptions: any[] = []
  return {
    globalState: {
      get: jest.fn((key: string) => state[key]),
      update: jest.fn((key: string, value: any) => {
        state[key] = value
      }),
      _state: state
    },
    subscriptions,
    ...overrides
  } as any as vscode.ExtensionContext
}

// Reset module-level state between tests by re-importing
beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
  // Re-apply the mock after resetModules
  jest.mock("vscode", () => ({
    window: {
      createStatusBarItem: jest.fn().mockReturnValue(makeStatusBarItem()),
      showInformationMessage: jest.fn().mockResolvedValue(undefined)
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    Disposable: jest.fn().mockImplementation((fn: () => void) => ({ dispose: fn })),
    env: { openExternal: jest.fn() },
    Uri: { parse: jest.fn(url => ({ toString: () => url })) },
    commands: { registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }) }
  }), { virtual: true })
})

// Separate describe block that doesn't use resetModules so imports work
describe("initializeReviewPrompt", () => {
  test("stores first activation date when not already stored", () => {
    // Use fresh require after beforeEach resetModules
    const {
      initializeReviewPrompt: init
    } = require("./reviewPrompt")

    const ctx = makeContext()
    ;(ctx.globalState.get as jest.Mock).mockReturnValue(undefined)

    init(ctx)

    const updateCalls = (ctx.globalState.update as jest.Mock).mock.calls
    const firstActivationCall = updateCalls.find(
      (c: any[]) => c[0] === "abapfs.reviewPrompt.firstActivationDate"
    )
    expect(firstActivationCall).toBeDefined()
    expect(typeof firstActivationCall![1]).toBe("string")
  })

  test("does NOT overwrite existing activation date", () => {
    const { initializeReviewPrompt: init } = require("./reviewPrompt")

    const existingDate = "2024-01-01T00:00:00.000Z"
    const ctx = makeContext()
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "abapfs.reviewPrompt.firstActivationDate") return existingDate
      return undefined
    })

    init(ctx)

    const updateCalls = (ctx.globalState.update as jest.Mock).mock.calls
    const activationDateUpdates = updateCalls.filter(
      (c: any[]) => c[0] === "abapfs.reviewPrompt.firstActivationDate"
    )
    expect(activationDateUpdates).toHaveLength(0)
  })

  test("does not throw on error", () => {
    const { initializeReviewPrompt: init } = require("./reviewPrompt")

    // Pass a broken context
    const brokenCtx = {
      globalState: {
        get: jest.fn().mockImplementation(() => {
          throw new Error("state error")
        }),
        update: jest.fn()
      },
      subscriptions: []
    } as any

    expect(() => init(brokenCtx)).not.toThrow()
  })
})

describe("incrementReviewCounter", () => {
  test("increments counter in globalState", () => {
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")

    const ctx = makeContext()
    let count = 0
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "abapfs.reviewPrompt.usageCount") return count
      return undefined
    })
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      if (key === "abapfs.reviewPrompt.usageCount") count = val
    })

    init(ctx)
    inc()
    inc()
    inc()

    expect(count).toBe(3)
  })

  test("does nothing when context is not initialized", () => {
    // Don't call initializeReviewPrompt — just call incrementReviewCounter directly
    const { incrementReviewCounter: inc } = require("./reviewPrompt")
    expect(() => inc()).not.toThrow()
  })

  test("handles counter increment error silently", () => {
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")

    const ctx = makeContext()
    ;(ctx.globalState.get as jest.Mock).mockImplementation(() => {
      throw new Error("state error")
    })
    ;(ctx.globalState.update as jest.Mock).mockImplementation(() => {})

    init(ctx)
    expect(() => inc()).not.toThrow()
  })
})

describe("review prompt conditions", () => {
  test("prompt is NOT shown when usage count is below threshold (100)", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)

    const ctx = makeContext()
    const state: Record<string, any> = {}
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    // Set activation date far in the past (100 days ago)
    state["abapfs.reviewPrompt.firstActivationDate"] = new Date(
      Date.now() - 100 * 24 * 60 * 60 * 1000
    ).toISOString()
    state["abapfs.reviewPrompt.usageCount"] = 50 // below 100 threshold

    init(ctx)

    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test("prompt is NOT shown when days threshold not met (< 7 days)", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)

    const ctx = makeContext()
    const state: Record<string, any> = {}
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    // Set activation date to today (0 days elapsed)
    state["abapfs.reviewPrompt.firstActivationDate"] = new Date().toISOString()
    state["abapfs.reviewPrompt.usageCount"] = 200 // above threshold

    init(ctx)

    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test("prompt is NOT shown when neverShowAgain is true", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.neverShowAgain": true,
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 100 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)

    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test("prompt IS shown when both usage >= 100 AND days >= 7", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 150,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)

    // The prompt is scheduled with a 5-minute delay
    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("ABAP Remote FS"),
      "⭐ Rate Now",
      "Remind Me Later",
      "Never Show Again"
    )
    jest.useRealTimers()
  })

  test("prompt is NOT shown twice in the same session", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 150,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)

    // Re-evaluate by incrementing counter to a multiple of 10
    state["abapfs.reviewPrompt.usageCount"] = 199
    inc() // becomes 200, triggers evaluateAndSchedule
    jest.runAllTimers()

    // Should still be exactly 1 call due to promptShownThisSession
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
})

describe("review prompt button handlers", () => {
  test("'Rate Now' opens marketplace URL and sets permanent dismissal", async () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")

    // Simulate user clicking "⭐ Rate Now"
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue("⭐ Rate Now")
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    // Wait for the promise chain to settle
    await Promise.resolve()
    await Promise.resolve()

    expect(mockVscode.env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ toString: expect.any(Function) })
    )
    expect(state["abapfs.reviewPrompt.neverShowAgain"]).toBe(true)
    expect(state["abapfs.reviewPrompt.statusBarDismissed"]).toBe(true)
    jest.useRealTimers()
  })

  test("'Never Show Again' sets permanent dismissal without opening URL", async () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")

    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue("Never Show Again")
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    await Promise.resolve()
    await Promise.resolve()

    expect(mockVscode.env.openExternal).not.toHaveBeenCalled()
    expect(state["abapfs.reviewPrompt.neverShowAgain"]).toBe(true)
    expect(state["abapfs.reviewPrompt.statusBarDismissed"]).toBe(true)
    jest.useRealTimers()
  })

  test("'Remind Me Later' resets usage counter and first activation date", async () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")

    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue("Remind Me Later")
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    await Promise.resolve()
    await Promise.resolve()

    // "Remind Me Later" resets both counter and date to undefined
    expect(state["abapfs.reviewPrompt.usageCount"]).toBeUndefined()
    expect(state["abapfs.reviewPrompt.firstActivationDate"]).toBeUndefined()
    // neverShowAgain should NOT be set
    expect(state["abapfs.reviewPrompt.neverShowAgain"]).toBeUndefined()
    jest.useRealTimers()
  })

  test("dismissing prompt (X button / undefined) resets counter like 'Remind Me Later'", async () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")

    // undefined means user dismissed without clicking any button
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    await Promise.resolve()
    await Promise.resolve()

    // Same as "Remind Me Later" — resets tracking
    expect(state["abapfs.reviewPrompt.usageCount"]).toBeUndefined()
    expect(state["abapfs.reviewPrompt.firstActivationDate"]).toBeUndefined()
    jest.useRealTimers()
  })
})

describe("review prompt counter logic", () => {
  test("evaluateAndSchedule is triggered every 10th increment", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      "abapfs.reviewPrompt.usageCount": 0
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)

    // Increment 99 times — should not trigger prompt (count < 100)
    for (let i = 0; i < 99; i++) {
      inc()
    }
    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled()

    // The 100th increment — now count=100, and 100 % 10 === 0, so evaluateAndSchedule runs
    inc()
    jest.runAllTimers()
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test("counter starts at 0 on fresh install (no state)", () => {
    const { initializeReviewPrompt: init, incrementReviewCounter: inc } = require("./reviewPrompt")

    const ctx = makeContext()
    const state: Record<string, any> = {}
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    inc()

    // Counter should go from undefined (0) to 1
    expect(state["abapfs.reviewPrompt.usageCount"]).toBe(1)
  })
})

describe("review prompt status bar", () => {
  test("status bar item is created when prompt is shown and not dismissed", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    const mockBarItem = makeStatusBarItem()
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(mockBarItem)
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    expect(mockVscode.window.createStatusBarItem).toHaveBeenCalled()
    expect(mockBarItem.show).toHaveBeenCalled()
    expect(mockBarItem.text).toContain("Rate ABAP FS")
    jest.useRealTimers()
  })

  test("status bar is NOT created when statusBarDismissed is true", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)
    mockVscode.window.createStatusBarItem = jest.fn().mockReturnValue(makeStatusBarItem())
    mockVscode.commands.registerCommand = jest.fn().mockReturnValue({ dispose: jest.fn() })

    const ctx = makeContext()
    const state: Record<string, any> = {
      "abapfs.reviewPrompt.usageCount": 200,
      "abapfs.reviewPrompt.firstActivationDate": new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      "abapfs.reviewPrompt.statusBarDismissed": true
    }
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)
    jest.runAllTimers()

    expect(mockVscode.window.createStatusBarItem).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test("fresh install: first activation date is recorded, no prompt shown", () => {
    jest.useFakeTimers()
    const { initializeReviewPrompt: init } = require("./reviewPrompt")
    const mockVscode = require("vscode")
    mockVscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined)

    const ctx = makeContext()
    const state: Record<string, any> = {}
    ;(ctx.globalState.get as jest.Mock).mockImplementation((key: string) => state[key])
    ;(ctx.globalState.update as jest.Mock).mockImplementation((key: string, val: any) => {
      state[key] = val
    })

    init(ctx)

    // First activation date should be stored
    expect(state["abapfs.reviewPrompt.firstActivationDate"]).toBeDefined()
    expect(typeof state["abapfs.reviewPrompt.firstActivationDate"]).toBe("string")

    jest.runAllTimers()
    // No prompt — usage count is 0 (or undefined)
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled()
    jest.useRealTimers()
  })
})
