import type { Page } from "@playwright/test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { waitForDomStable, waitForServer } from "./waiters"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("SAP waiters", () => {
  it("checks outer and child documents when persistent requests prevent networkidle", async () => {
    const main = {}
    const child = { waitForFunction: vi.fn() }
    const page = {
      waitForLoadState: vi.fn().mockRejectedValue(new Error("Persistent request")),
      waitForFunction: vi.fn(),
      mainFrame: () => main,
      frames: () => [main, child]
    }
    await waitForServer(page as unknown as Page)
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 1500 })
    expect(page.waitForFunction).toHaveBeenCalledOnce()
    expect(child.waitForFunction).toHaveBeenCalledOnce()
  })
  it("continues with other frames if a frame detaches", async () => {
    const main = {}
    const detached = { waitForFunction: vi.fn().mockRejectedValue(new Error("Detached")) }
    const healthy = { waitForFunction: vi.fn() }
    const page = {
      waitForLoadState: vi.fn(),
      waitForFunction: vi.fn(),
      mainFrame: () => main,
      frames: () => [main, detached, healthy]
    }
    await expect(waitForServer(page as unknown as Page)).resolves.toBeUndefined()
    expect(healthy.waitForFunction).toHaveBeenCalledOnce()
  })
  it("does not wait on invisible busy overlays that retain layout dimensions", async () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 100, height: 20 }) }]
    })
    vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "hidden" }))
    const main = {}
    const page = {
      waitForLoadState: vi.fn(),
      frames: () => [main],
      mainFrame: () => main,
      waitForFunction: vi.fn(async (fn: (selectors: string[]) => boolean, selectors: string[]) => {
        expect(fn(selectors)).toBe(true)
      })
    }
    // The waiter deliberately swallows browser wait errors, so inspect the callback's
    // outcome separately rather than letting its catch swallow an assertion failure.
    await waitForServer(page as unknown as Page)
    const [callback, selectors] = page.waitForFunction.mock.calls[0]
    expect(callback(selectors)).toBe(true)
  })
  it("disconnects installed observers after all documents become quiet", async () => {
    vi.useFakeTimers()
    const disconnect = vi.fn()
    vi.stubGlobal("window", {})
    vi.stubGlobal("document", { body: {} })
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect = disconnect
      }
    )
    const main = {}
    const evaluate = vi.fn(async (fn: (arg?: number) => unknown, arg?: number) => fn(arg))
    const child = { evaluate }
    const page = {
      evaluate,
      frames: () => [main, child],
      mainFrame: () => main,
      waitForTimeout: async (ms: number) => {
        await vi.advanceTimersByTimeAsync(ms)
      }
    }
    await waitForDomStable(page as unknown as Page, 100, 1000)
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
