vi.mock("vscode", () => ({
  window: {
    createStatusBarItem: vi.fn(),
    showInformationMessage: vi.fn()
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
  Disposable: vi.fn().mockImplementation(function (fn: () => void) {
    return { dispose: fn }
  })
}))

vi.mock("../lib", () => ({ log: vi.fn() }))
vi.mock("../commands", () => ({
  command: vi.fn(function () {
    return (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => descriptor
  })
}))

import * as vscode from "vscode"
import { showWelcomeWalkthrough } from "./walkthroughService"
import * as __$mock_lib from "../lib"
import type { Mock } from "vitest"

const mockExecuteCommand = vscode.commands.executeCommand as Mock
const mockLog = __$mock_lib.log as unknown as Mock

function makeContext(walkthroughShown?: boolean) {
  const state: Record<string, any> = {}
  if (walkthroughShown !== undefined) {
    state["abapfs.walkthroughShown"] = walkthroughShown
  }
  const subscriptions: any[] = []
  return {
    globalState: {
      get: vi.fn(function (key: string) {
        return state[key]
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe("showWelcomeWalkthrough", () => {
  test("does nothing when walkthrough already shown", () => {
    const ctx = makeContext(true)
    showWelcomeWalkthrough(ctx)

    vi.runAllTimers()

    expect(ctx.globalState.update).not.toHaveBeenCalled()
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  test("marks walkthrough as shown when first time", () => {
    const ctx = makeContext(false)
    showWelcomeWalkthrough(ctx)

    expect(ctx.globalState.update).toHaveBeenCalledWith("abapfs.walkthroughShown", true)
  })

  test("marks walkthrough as shown when state key is undefined (first install)", () => {
    const ctx = makeContext(undefined)
    showWelcomeWalkthrough(ctx)

    expect(ctx.globalState.update).toHaveBeenCalledWith("abapfs.walkthroughShown", true)
  })

  test("opens walkthrough after 5 second delay", () => {
    const ctx = makeContext(false)
    showWelcomeWalkthrough(ctx)

    // Before delay
    expect(mockExecuteCommand).not.toHaveBeenCalled()

    // After 5s delay
    vi.advanceTimersByTime(5000)

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "workbench.action.openWalkthrough",
      "murbani.vscode-abap-remote-fs#abapfs.gettingStarted",
      false
    )
  })

  test("logs message after opening walkthrough", () => {
    const ctx = makeContext(false)
    showWelcomeWalkthrough(ctx)

    vi.advanceTimersByTime(5000)

    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("walkthrough"))
  })

  test("does not open walkthrough before 5 seconds elapsed", () => {
    const ctx = makeContext(false)
    showWelcomeWalkthrough(ctx)

    vi.advanceTimersByTime(4999)
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  test("does not call commands when already shown even after timer fires", () => {
    const ctx = makeContext(true)
    showWelcomeWalkthrough(ctx)

    vi.advanceTimersByTime(10000)
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  test("uses the correct extension qualified ID", () => {
    const ctx = makeContext(false)
    showWelcomeWalkthrough(ctx)

    vi.advanceTimersByTime(5000)

    const callArg = mockExecuteCommand.mock.calls[0][1] as string
    expect(callArg).toContain("murbani.vscode-abap-remote-fs")
    expect(callArg).toContain("abapfs.gettingStarted")
  })
})
