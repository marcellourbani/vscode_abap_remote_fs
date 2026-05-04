jest.mock("vscode", () => ({
  env: { openExternal: jest.fn() },
  Uri: { parse: jest.fn(url => ({ toString: () => url })) },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }) }
}), { virtual: true })

jest.mock("./funMessenger", () => {
  const mockStatusBarItem = {
    text: "",
    tooltip: "",
    command: "",
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn()
  }
  return {
    funWindow: {
      createStatusBarItem: jest.fn().mockReturnValue(mockStatusBarItem),
      showInformationMessage: jest.fn().mockResolvedValue(undefined)
    }
  }
})

import * as vscode from "vscode"
import { checkUpgradeNotification } from "./upgradeNotification"
import { funWindow as window } from "./funMessenger"

const mockCreateStatusBarItem = window.createStatusBarItem as jest.Mock
const mockShowInfoMessage = window.showInformationMessage as jest.Mock
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

function makeContext(lastVersion?: string, upgradeDismissed?: boolean) {
  const state: Record<string, any> = {}
  if (lastVersion !== undefined) state["abapfs.lastVersion"] = lastVersion
  if (upgradeDismissed !== undefined) state["abapfs.upgradeStatusBarDismissed"] = upgradeDismissed

  const subscriptions: any[] = []
  return {
    extension: { packageJSON: { version: "2.1.0" } },
    globalState: {
      get: jest.fn((key: string) => state[key]),
      update: jest.fn((key: string, value: any) => {
        state[key] = value
      })
    },
    subscriptions
  } as any as vscode.ExtensionContext
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  const item = makeStatusBarItem()
  mockCreateStatusBarItem.mockReturnValue(item)
})

afterEach(() => {
  jest.useRealTimers()
})

describe("checkUpgradeNotification", () => {
  // ─── Upgrade trigger conditions ────────────────────────────────────────────

  test("triggers when lastVersion is undefined (fresh install / v1 user)", () => {
    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)
    expect(mockShowInfoMessage).toHaveBeenCalled()
  })

  test("triggers when lastVersion starts with '1.'", () => {
    const ctx = makeContext("1.9.9")
    checkUpgradeNotification(ctx)
    expect(mockShowInfoMessage).toHaveBeenCalled()
  })

  test("does NOT trigger when already on v2", () => {
    const ctx = makeContext("2.0.0")
    checkUpgradeNotification(ctx)
    expect(mockShowInfoMessage).not.toHaveBeenCalled()
  })

  test("does NOT trigger when already on current version", () => {
    const ctx = makeContext("2.1.0")
    checkUpgradeNotification(ctx)
    expect(mockShowInfoMessage).not.toHaveBeenCalled()
  })

  // ─── Version update ────────────────────────────────────────────────────────

  test("always updates stored version to current", () => {
    const ctx = makeContext("1.5.0")
    checkUpgradeNotification(ctx)

    const updateCalls = (ctx.globalState.update as jest.Mock).mock.calls
    const versionUpdate = updateCalls.find((c: any[]) => c[0] === "abapfs.lastVersion")
    expect(versionUpdate).toBeDefined()
    expect(versionUpdate![1]).toBe("2.1.0")
  })

  test("updates version even when not upgrading from v1", () => {
    const ctx = makeContext("2.0.5")
    checkUpgradeNotification(ctx)

    const updateCalls = (ctx.globalState.update as jest.Mock).mock.calls
    const versionUpdate = updateCalls.find((c: any[]) => c[0] === "abapfs.lastVersion")
    expect(versionUpdate![1]).toBe("2.1.0")
  })

  // ─── Notification message ──────────────────────────────────────────────────

  test("notification message mentions v2", () => {
    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    const message = mockShowInfoMessage.mock.calls[0][0] as string
    expect(message).toContain("v2")
  })

  test("notification has 'Open Marketplace Page' button", () => {
    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    const args = mockShowInfoMessage.mock.calls[0]
    expect(args).toContain("Open Marketplace Page")
  })

  // ─── Opening marketplace ───────────────────────────────────────────────────

  test("opens marketplace when 'Open Marketplace Page' is clicked", async () => {
    mockShowInfoMessage.mockResolvedValue("Open Marketplace Page")

    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    // Wait for promise resolution
    await Promise.resolve()

    expect(mockEnvOpenExternal).toHaveBeenCalled()
  })

  test("does not open marketplace when notification is dismissed", async () => {
    mockShowInfoMessage.mockResolvedValue(undefined)

    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    await Promise.resolve()

    expect(mockEnvOpenExternal).not.toHaveBeenCalled()
  })

  // ─── Status bar item ────────────────────────────────────────────────────────

  test("creates blinking status bar item on upgrade", () => {
    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    expect(mockCreateStatusBarItem).toHaveBeenCalled()
  })

  test("does NOT create status bar item when upgrade dismissed", () => {
    const ctx = makeContext(undefined, true) // dismissed = true
    checkUpgradeNotification(ctx)

    expect(mockCreateStatusBarItem).not.toHaveBeenCalled()
  })

  test("does NOT create status bar item when already on v2", () => {
    const ctx = makeContext("2.0.0")
    checkUpgradeNotification(ctx)

    expect(mockCreateStatusBarItem).not.toHaveBeenCalled()
  })

  test("status bar item is shown immediately", () => {
    const item = makeStatusBarItem()
    mockCreateStatusBarItem.mockReturnValue(item)

    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    expect(item.show).toHaveBeenCalled()
  })

  test("status bar item blinks between two states", () => {
    const item = makeStatusBarItem()
    mockCreateStatusBarItem.mockReturnValue(item)

    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    const initialText = item.text
    jest.advanceTimersByTime(1500)
    const textAfterBlink = item.text
    jest.advanceTimersByTime(1500)
    const textAfterSecondBlink = item.text

    // Should have cycled
    expect(textAfterBlink).not.toBe(initialText)
    expect(textAfterSecondBlink).toBe(initialText)
  })

  test("registers marketplace command", () => {
    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    expect(mockRegisterCommand).toHaveBeenCalledWith(
      "abapfs.openUpgradeMarketplace",
      expect.any(Function)
    )
  })

  test("status bar item is added to context subscriptions", () => {
    const item = makeStatusBarItem()
    mockCreateStatusBarItem.mockReturnValue(item)

    const ctx = makeContext(undefined)
    checkUpgradeNotification(ctx)

    expect(ctx.subscriptions.length).toBeGreaterThan(0)
  })
})
