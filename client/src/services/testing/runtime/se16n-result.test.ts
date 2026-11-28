import { describe, expect, it } from "vitest"
import { isEmptyResultMessage, parseHitCount } from "./se16n"

describe("SE16N result safety", () => {
  it.each(["No values found", "No data found.", "No data selected", "No data available"])(
    "accepts explicit empty results: %s",
    message => {
      expect(isEmptyResultMessage(message)).toBe(true)
    }
  )
  it.each([
    "No data authorization",
    "No data access permitted",
    "No values found: authorization failed",
    ""
  ])("does not turn errors into zero rows: %s", message => {
    expect(isEmptyResultMessage(message)).toBe(false)
  })
  it.each(["", "1,00", "1.00", "NaN", "-1", "1.5"])("rejects ambiguous hit count %s", value => {
    expect(() => parseHitCount(value)).toThrow("unambiguous hit count")
  })
  it("accepts zero and positive integer counts", () => {
    expect(parseHitCount(" 0 ")).toBe(0)
    expect(parseHitCount("1234")).toBe(1234)
    for (const grouped of ["1,234", "1.234", "1 234", "1’234", "1\u00a0234", "1\u202f234"]) {
      expect(parseHitCount(grouped)).toBe(1234)
    }
  })
})
