import { afterEach, describe, expect, it, vi } from "vitest"
import { SapSession } from "./sap-session"

afterEach(() => vi.unstubAllGlobals())

function statusSession(text: string, severity?: string, icon = false, legacy = false) {
  const status = {
    className: "lsMessageBar",
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    matches: () => true,
    getAttribute: (name: string) =>
      name === "lsdata"
        ? legacy
          ? `{0:'${text}',1:'${severity ?? ""}'}`
          : JSON.stringify({ 11: { applicationText: text, messageType: severity } })
        : null,
    querySelector: (selector: string) =>
      selector === ".lsMessageBar__text" ? null : icon ? {} : null
  }
  vi.stubGlobal("document", { querySelectorAll: () => [status] })
  vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "visible" }))
  const session = Object.create(SapSession.prototype) as SapSession
  session.contentScope = vi.fn().mockResolvedValue({ evaluate: async (fn: () => unknown) => fn() })
  return session
}

describe("SAP status severity", () => {
  it.each(["No errors found", "Invalid entries were successfully removed"])(
    "does not infer error severity from message words: %s",
    async text => {
      expect(await statusSession(text).statusMessage()).toEqual({ text, isError: false })
    }
  )

  it.each(["S", "I", "W"])("honors explicit non-error severity %s", async severity => {
    expect((await statusSession("Error log created", severity, true).statusMessage()).isError).toBe(
      false
    )
  })

  it.each(["E", "A", "Error", "Abort"])("recognizes structured severity %s", async severity => {
    expect((await statusSession("Please correct input", severity).statusMessage()).isError).toBe(
      true
    )
  })

  it("discovers ARIA alerts without treating their role as error severity", async () => {
    const session = statusSession("Saved successfully")
    const status = document.querySelectorAll("unused")[0]
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) => {
        expect(selector).toContain('[role="alert"]')
        return [status]
      }
    })
    expect(await session.statusMessage()).toEqual({ text: "Saved successfully", isError: false })
  })

  it("recognizes legacy severity and bounded icon fallback", async () => {
    expect((await statusSession("Correct input", "E", false, true).statusMessage()).isError).toBe(
      true
    )
    expect((await statusSession("Correct input", undefined, true).statusMessage()).isError).toBe(
      true
    )
  })
})
