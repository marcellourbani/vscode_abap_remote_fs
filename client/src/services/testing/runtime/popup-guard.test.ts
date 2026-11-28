import type { Locator, Page } from "@playwright/test"
import { describe, expect, it, vi } from "vitest"
import { dismissKnownPopups, listOpenDialogs } from "./popup-guard"

function popup(title: string, button = "Continue", variant = "aria") {
  let open = true
  const click = vi.fn(async () => {
    open = false
  })
  const missing = { first: () => missing, textContent: async () => null, count: async () => 0 }
  const dismiss = { first: () => dismiss, click, count: async () => (open ? 1 : 0) }
  const dialog = {
    isVisible: async () => open,
    getAttribute: async (name: string) =>
      variant === "aria" && name === "aria-label" ? title : null,
    locator: (selector: string) =>
      selector.includes("TitleText")
        ? { first: () => ({ textContent: async () => title }) }
        : selector === `[title="${button}"]`
          ? dismiss
          : missing,
    getByRole: (_: string, options: { name: string }) =>
      options.name === button ? dismiss : missing,
    waitFor: async () => {
      if (open) throw new Error("Still visible")
    }
  } as unknown as Locator
  return { dialog, click, isOpen: () => open }
}
function pageWith(
  popups: ReturnType<typeof popup>[],
  framePopups: ReturnType<typeof popup>[] = []
) {
  const scope = (items: ReturnType<typeof popup>[]) => ({
    locator: () => ({ all: async () => items.filter(p => p.isOpen()).map(p => p.dialog) })
  })
  const main = {}
  return {
    ...scope(popups),
    mainFrame: () => main,
    frames: () => [main, scope(framePopups)],
    waitForTimeout: vi.fn()
  } as unknown as Page
}

describe("popup safety", () => {
  it.each(["License reminder", "System messages", "Copyright"])(
    "dismisses supported notice %s",
    async title => {
      const notice = popup(title)
      expect(await dismissKnownPopups(pageWith([notice]))).toEqual([
        expect.objectContaining({ title, button: "Continue" })
      ])
      expect(notice.click).toHaveBeenCalledOnce()
    }
  )
  it("supports legacy title elements in a content frame", async () => {
    const notice = popup("License reminder", "Continue", "legacy")
    expect(await dismissKnownPopups(pageWith([], [notice]))).toHaveLength(1)
  })
  it.each(["Exit Document", "Save changes?", "Information", "", "Business validation"])(
    "leaves unknown/interactive dialog alone: %s",
    async title => {
      const question = popup(title)
      expect(await dismissKnownPopups(pageWith([question]))).toEqual([])
      expect(question.click).not.toHaveBeenCalled()
    }
  )
  it("refuses Multiple Logon even when the caller supplies an unsafe override", async () => {
    const logon = popup("Multiple Logon", "End other sessions")
    await expect(
      dismissKnownPopups(pageWith([logon]), [
        { matchTitle: "Multiple Logon", dismissButton: "End other sessions", note: "Unsafe" }
      ])
    ).rejects.toThrow(/will not end another session/)
    expect(logon.click).not.toHaveBeenCalled()
  })
  it("fails loudly if a recognized notice cannot be dismissed", async () => {
    const notice = popup("License", "Different button")
    await expect(dismissKnownPopups(pageWith([notice]))).rejects.toThrow(/could not click/)
  })
  it("honors an explicit extra interrupter without broadening defaults", async () => {
    const notice = popup("Example notice", "Acknowledge")
    const result = await dismissKnownPopups(pageWith([notice]), [
      { matchTitle: "Example notice", dismissButton: "Acknowledge", note: "Verified notice" }
    ])
    expect(result).toHaveLength(1)
  })
  it("enumerates both outer and frame dialogs", async () => {
    expect(await listOpenDialogs(pageWith([popup("Outer")], [popup("Inner")]))).toEqual([
      "Outer",
      "Inner"
    ])
  })
})
