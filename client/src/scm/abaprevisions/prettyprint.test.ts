jest.mock("vscode", () => ({ Uri: {} }), { virtual: true })
jest.mock("../../adt/conections", () => ({}))
jest.mock("../../config", () => ({ RemoteManager: { get: () => ({ byId: () => ({}) }) } }))
jest.mock("../../lib", () => ({ parseAbapFile: () => null }))

import { normalizeAbap } from "./prettyprint"

describe("normalizeAbap", () => {
  test("lowercases ABAP keywords", () => {
    expect(normalizeAbap("DATA lv_test TYPE string.")).toBe("data lv_test type string.")
  })

  test("preserves full-line comments starting with *", () => {
    expect(normalizeAbap("* This is a COMMENT")).toBe("* This is a COMMENT")
  })

  test("preserves inline comments starting with \"", () => {
    const input = '  data lv_x TYPE i. "This IS a Comment'
    const result = normalizeAbap(input)
    expect(result).toContain('"This IS a Comment')
    // The part before comment should be lowered
    expect(result).toMatch(/^\s+data lv_x type i\./)
  })

  test("preserves indented comment lines", () => {
    expect(normalizeAbap('  "Full Line Comment HERE')).toBe('  "Full Line Comment HERE')
  })

  test("preserves string literals", () => {
    const input = "WRITE 'Hello WORLD'."
    const result = normalizeAbap(input)
    expect(result).toBe("write 'Hello WORLD'.")
  })

  test("preserves multiple string literals", () => {
    const input = "CONCATENATE 'HELLO' 'WORLD' INTO lv_result."
    const result = normalizeAbap(input)
    expect(result).toBe("concatenate 'HELLO' 'WORLD' into lv_result.")
  })

  test("handles empty string", () => {
    expect(normalizeAbap("")).toBe("")
  })

  test("handles multiline input", () => {
    const input = "DATA lv_a TYPE i.\n* Comment\nWRITE lv_a."
    const result = normalizeAbap(input)
    expect(result).toBe("data lv_a type i.\n* Comment\nwrite lv_a.")
  })

  test("handles string with inline comment after it", () => {
    const input = `DATA lv_x VALUE 'TEST'. "Keep THIS`
    const result = normalizeAbap(input)
    expect(result).toContain("data lv_x value 'TEST'.")
    expect(result).toContain('"Keep THIS')
  })
})
