import { describe, expect, it, vi } from "vitest"
import { SapSession } from "./sap-session"
import { detectRuntimeError } from "./dump-detector"

vi.mock("./waiters", () => ({ waitForServer: vi.fn(), waitForDomStable: vi.fn() }))
vi.mock("./popup-guard", () => ({ dismissKnownPopups: vi.fn(), listOpenDialogs: vi.fn() }))
vi.mock("./dump-detector", () => ({ detectRuntimeError: vi.fn(), detectSilentBounce: vi.fn() }))

function sessionWithStatus(text: string, isError: boolean) {
  const session = Object.create(SapSession.prototype) as SapSession
  const internals = session as unknown as {
    statusMessage: () => Promise<{ text: string; isError: boolean }>
    throwOnStatusError: (context: string) => Promise<void>
  }
  internals.statusMessage = vi.fn().mockResolvedValue({ text, isError })
  return { session, action: () => internals.throwOnStatusError("submit") }
}

describe("expectBusinessError", () => {
  it("accepts a matching error for one interaction and restores strict checking", async () => {
    const { session, action } = sessionWithStatus("Enter a valid site", true)
    await expect(session.expectBusinessError(action, /valid site/g)).resolves.toBeUndefined()
    await expect(action()).rejects.toThrow("SAP status error")
  })

  it.each([
    ["Wrong error", true],
    ["Enter a valid site", false],
    ["", false]
  ])("rejects a mismatching status %s (%s)", async (text, isError) => {
    const { session, action } = sessionWithStatus(text, isError)
    await expect(session.expectBusinessError(action, "Enter a valid site")).rejects.toThrow(
      "Expected SAP business error"
    )
  })

  it("does not suppress runtime or action failures and resets on failure", async () => {
    const { session, action } = sessionWithStatus("Invalid site", true)
    await expect(
      session.expectBusinessError(async () => {
        throw new Error("SAP runtime error: session lost")
      }, "Invalid site")
    ).rejects.toThrow("session lost")
    await expect(action()).rejects.toThrow("SAP status error")
  })

  it("requires exactly one checked interaction", async () => {
    const { session, action } = sessionWithStatus("Invalid site", true)
    await expect(session.expectBusinessError(async () => {}, "Invalid site")).rejects.toThrow(
      "exactly one"
    )
    await expect(
      session.expectBusinessError(async () => {
        await action()
        await action()
      }, "Invalid site")
    ).rejects.toThrow("exactly one")
  })

  it("checks real guarded actions and never waives session-loss detection", async () => {
    const { session } = sessionWithStatus("Invalid site", true)
    Object.assign(session, {
      page: { keyboard: { press: vi.fn() } },
      ensureContentFrame: vi.fn(),
      captureSteps: false
    })
    vi.mocked(detectRuntimeError).mockResolvedValue(null)
    await expect(
      session.expectBusinessError(() => session.pressKey("Enter"), "Invalid site")
    ).resolves.toBeUndefined()
    vi.mocked(detectRuntimeError).mockResolvedValue({
      kind: "logon",
      title: "Logon",
      url: "https://example.invalid",
      snippet: "Session expired"
    })
    await expect(
      session.expectBusinessError(() => session.pressKey("Enter"), "Invalid site")
    ).rejects.toThrow("SAP runtime error")
    vi.mocked(detectRuntimeError).mockResolvedValue(null)
    await expect(session.pressKey("Enter")).rejects.toThrow("SAP status error")
  })

  it("rejects nested assertions and empty message strings", async () => {
    const { session, action } = sessionWithStatus("Invalid site", true)
    await expect(session.expectBusinessError(action, " ")).rejects.toThrow("message is required")
    await expect(
      session.expectBusinessError(
        () => session.expectBusinessError(action, "Invalid site"),
        "Invalid site"
      )
    ).rejects.toThrow("cannot be nested")
  })
})
