import { describe, expect, it } from "vitest"
import { gridValueMatches } from "./sap-session"

describe("grid value read-back", () => {
  it.each([
    ["18", "8"],
    ["80", "8"],
    ["ABC123", "ABC"],
    ["old", ""],
    ["", "8"]
  ])("rejects unrelated or uncleared values %s vs %s", (actual, expected) => {
    expect(gridValueMatches(actual, expected)).toBe(false)
  })
  it.each([
    ["8.00", "8"],
    ["0008", "8"],
    ["0.0", "-0"],
    ["", ""],
    ["ABC", "ABC"]
  ])("accepts exact/equivalent values %s vs %s", (actual, expected) => {
    expect(gridValueMatches(actual, expected)).toBe(true)
  })
})
