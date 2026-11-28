import { describe, expect, it, vi } from "vitest"
import { SapSession } from "./sap-session"

function emptyGrid(cells: number) {
  const session = Object.create(SapSession.prototype) as SapSession
  const internals = session as unknown as {
    content(): unknown
    recordStep: ReturnType<typeof vi.fn>
  }
  internals.content = () => ({ locator: () => ({ count: async () => cells }) })
  internals.recordStep = vi.fn()
  return session
}

describe("session assertions must not produce false passes", () => {
  it.each([1, 2, 10])("rejects an allegedly empty grid with %i visible data cells", async count => {
    await expect(emptyGrid(count).expectGridEmpty()).rejects.toThrow(/visible data cells/)
  })
  it("allows a grid with no data cells", async () => {
    await expect(emptyGrid(0).expectGridEmpty()).resolves.toBeUndefined()
  })
  it("does not record a successful step when a business-error action itself throws", async () => {
    const session = Object.create(SapSession.prototype) as SapSession
    await expect(
      session.expectBusinessError(async () => {
        throw new Error("Action failed")
      }, /expected/)
    ).rejects.toThrow("Action failed")
    // The assertion must release its scope even when its callback throws.
    await expect(session.expectBusinessError(async () => {}, /expected/)).rejects.toThrow(
      /exactly one/
    )
  })
  it("rejects a missing expected message before invoking the callback", async () => {
    const session = Object.create(SapSession.prototype) as SapSession
    const callback = vi.fn()
    await expect(session.expectBusinessError(callback, "  ")).rejects.toThrow(/message is required/)
    expect(callback).not.toHaveBeenCalled()
  })
})
