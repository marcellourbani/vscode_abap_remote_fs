import { describe, expect, it } from "vitest"
import { isRelativeDateToken, padNumericId, relativeDate, stripLeadingZeros } from "./format"
import { parseFrontmatter } from "./frontmatter"

describe("date and identifier helpers", () => {
  it.each([
    ["today", "2030-01-31"],
    ["+1d", "2030-02-01"],
    ["-31d", "2029-12-31"],
    ["+365d", "2031-01-31"],
    ["not a date", "not a date"]
  ])("resolves %s without mutating the reference", (token, expected) => {
    const reference = new Date(2030, 0, 31, 12)
    expect(relativeDate(token, "YYYY-MM-DD", reference)).toBe(expected)
    expect(reference.getDate()).toBe(31)
  })
  it("handles leap years and all declared formats", () => {
    const date = new Date(2032, 1, 28, 12)
    expect(relativeDate("+1d", "DD.MM.YYYY", date)).toBe("29.02.2032")
    expect(relativeDate("+2d", "MM/DD/YYYY", date)).toBe("03/01/2032")
  })
  it.each(["today", " TODAY ", "+1d", "-99d"])("recognizes date token %s", token => {
    expect(isRelativeDateToken(token)).toBe(true)
  })
  it.each(["tomorrow", "1d", "+1m", "", "2020-01-01"])("does not reinterpret literal %s", token => {
    expect(isRelativeDateToken(token)).toBe(false)
  })
  it("pads without truncating and preserves all-zero external IDs", () => {
    expect(padNumericId(" 12 ", 4)).toBe("0012")
    expect(padNumericId("12345", 4)).toBe("12345")
    expect(stripLeadingZeros("0000")).toBe("0")
    expect(stripLeadingZeros("000123")).toBe("123")
  })
})

describe("frontmatter parsing", () => {
  it("parses CRLF, nested requirements and YAML merge aliases", () => {
    const data = parseFrontmatter(
      '---\r\ndefaults: &defaults\r\n  source: static\r\nrequires:\r\n  - <<: *defaults\r\n    key: sample\r\n    staticValue: "00123"\r\n---\r\nBody'
    )
    expect(data?.requires).toEqual([{ source: "static", key: "sample", staticValue: "00123" }])
  })
  it.each(["no frontmatter", "---\nplain string\n---", "---\nnull\n---"])(
    "returns null for absent/non-object metadata",
    input => {
      expect(parseFrontmatter(input)).toBeNull()
    }
  )
  it("reports malformed YAML instead of silently dropping requirements", () => {
    expect(() => parseFrontmatter("---\nrequires: [\n---")).toThrow()
  })
})
