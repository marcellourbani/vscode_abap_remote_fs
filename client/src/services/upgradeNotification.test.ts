vi.mock("vscode", () => ({
  window: {
    createStatusBarItem: vi.fn(),
    showInformationMessage: vi.fn().mockResolvedValue(undefined)
  },
  env: { openExternal: vi.fn() },
  Uri: {
    parse: vi.fn(function (url) {
      return { toString: () => url }
    })
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }) }
}))

vi.mock("./lm-tools/toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))

import * as vscode from "vscode"
import { checkUpgradeNotification } from "./upgradeNotification"
import { UPGRADE_NOTIFICATION_FEATURES } from "./upgradeNotificationFeatures"
import type { Mock } from "vitest"

const mockCreateStatusBarItem = vscode.window.createStatusBarItem as Mock
const mockShowInfoMessage = vscode.window.showInformationMessage as Mock
const mockEnvOpenExternal = vscode.env.openExternal as Mock
const mockRegisterCommand = vscode.commands.registerCommand as Mock

function makeStatusBarItem() {
  return {
    text: "",
    tooltip: "",
    command: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  }
}

function makeContext(
  lastVersion?: string,
  upgradeDismissed?: boolean,
  notifiedFeatures?: string[]
) {
  const state: Record<string, any> = {}
  if (lastVersion !== undefined) state["abapfs.lastVersion"] = lastVersion
  if (upgradeDismissed !== undefined) state["abapfs.upgradeStatusBarDismissed"] = upgradeDismissed
  if (notifiedFeatures !== undefined) state["abapfs.notifiedUpgradeFeatures"] = notifiedFeatures

  const subscriptions: any[] = []
  return {
    extension: { packageJSON: { version: "2.1.0" } },
    globalState: {
      get: vi.fn(function (key: string, defaultValue?: any) {
        return state[key] ?? defaultValue
      }),
      update: vi.fn(function (key: string, value: any) {
        state[key] = value
      })
    },
    subscriptions
  } as any as vscode.ExtensionContext
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  const item = makeStatusBarItem()
  mockCreateStatusBarItem.mockReturnValue(item)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("checkUpgradeNotification", () => {
  // ─── Upgrade trigger conditions ────────────────────────────────────────────
  test("triggers custom notification for minor v2 updates", () => {
    const ctx = makeContext("2.0.0")
    checkUpgradeNotification(ctx)
    expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String))
  })

  test("records the feature after showing it", () => {
    const ctx = makeContext("2.0.0")
    checkUpgradeNotification(ctx)

    expect(ctx.globalState.update).toHaveBeenCalledWith("abapfs.notifiedUpgradeFeatures", [
      UPGRADE_NOTIFICATION_FEATURES[0].id
    ])
  })

  test("uses the regular notification after all features have been shown", () => {
    const ctx = makeContext(
      "2.0.0",
      undefined,
      UPGRADE_NOTIFICATION_FEATURES.map(feature => feature.id)
    )
    checkUpgradeNotification(ctx)

    expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    expect(ctx.globalState.update).not.toHaveBeenCalledWith(
      "abapfs.notifiedUpgradeFeatures",
      expect.anything()
    )
  })

  test("opens the configured URL when the custom button is selected", async () => {
    mockShowInfoMessage.mockImplementationOnce(function (_message: string, ...buttons: string[]) {
      return Promise.resolve(buttons[0])
    })

    const ctx = makeContext("2.0.0")
    checkUpgradeNotification(ctx)
    await Promise.resolve()

    expect(mockEnvOpenExternal).toHaveBeenCalledWith({
      toString: expect.any(Function)
    })
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

    const updateCalls = (ctx.globalState.update as Mock).mock.calls
    const versionUpdate = updateCalls.find((c: any[]) => c[0] === "abapfs.lastVersion")
    expect(versionUpdate).toBeDefined()
    expect(versionUpdate![1]).toBe("2.1.0")
  })

  test("updates version even when not upgrading from v1", () => {
    const ctx = makeContext("2.0.5")
    checkUpgradeNotification(ctx)

    const updateCalls = (ctx.globalState.update as Mock).mock.calls
    const versionUpdate = updateCalls.find((c: any[]) => c[0] === "abapfs.lastVersion")
    expect(versionUpdate![1]).toBe("2.1.0")
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
    vi.advanceTimersByTime(1500)
    const textAfterBlink = item.text
    vi.advanceTimersByTime(1500)
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
