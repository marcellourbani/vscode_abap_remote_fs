jest.mock("../../adt/conections", () => ({}))
import { sanitizeObjectName } from "./shared"

describe("sanitizeObjectName", () => {
  test("accepts valid SAP object name", () => {
    expect(sanitizeObjectName("ZTEST_REPORT")).toBe("ZTEST_REPORT")
  })

  test("uppercases input", () => {
    expect(sanitizeObjectName("ztest_report")).toBe("ZTEST_REPORT")
  })

  test("trims whitespace", () => {
    expect(sanitizeObjectName("  ZTEST  ")).toBe("ZTEST")
  })

  test("accepts namespaced objects with slashes", () => {
    expect(sanitizeObjectName("/NAMESPACE/OBJECT")).toBe("/NAMESPACE/OBJECT")
  })

  test("accepts percent wildcard for LIKE queries", () => {
    expect(sanitizeObjectName("Z%")).toBe("Z%")
    expect(sanitizeObjectName("Z_TEST%")).toBe("Z_TEST%")
  })

  test("throws for empty string", () => {
    expect(() => sanitizeObjectName("")).toThrow("required")
  })

  test("throws for null/undefined", () => {
    expect(() => sanitizeObjectName(null as any)).toThrow("required")
    expect(() => sanitizeObjectName(undefined as any)).toThrow("required")
  })

  test("throws for non-string input", () => {
    expect(() => sanitizeObjectName(123 as any)).toThrow("must be a string")
  })

  test("throws for SQL injection with single quotes", () => {
    expect(() => sanitizeObjectName("Z'; DROP TABLE--")).toThrow()
  })

  test("throws for SQL comment injection", () => {
    expect(() => sanitizeObjectName("Z--comment")).toThrow()
  })

  test("throws for semicolons", () => {
    expect(() => sanitizeObjectName("ZTEST;DELETE")).toThrow()
  })

  test("throws for special characters", () => {
    expect(() => sanitizeObjectName("Z TEST")).toThrow("Invalid object name")
    expect(() => sanitizeObjectName("Z(TEST)")).toThrow("Invalid object name")
    expect(() => sanitizeObjectName("Z@TEST")).toThrow("Invalid object name")
  })

  test("throws for name exceeding 120 characters", () => {
    const longName = "Z" + "A".repeat(120)
    expect(() => sanitizeObjectName(longName)).toThrow("too long")
  })

  test("accepts exactly 120 characters", () => {
    const name = "Z" + "A".repeat(119)
    expect(sanitizeObjectName(name)).toBe(name)
  })

  test("throws for suspicious SQL keywords", () => {
    expect(() => sanitizeObjectName("DROP")).toThrow("suspicious")
    expect(() => sanitizeObjectName("DELETE")).toThrow("suspicious")
    expect(() => sanitizeObjectName("UPDATE")).toThrow("suspicious")
    expect(() => sanitizeObjectName("INSERT")).toThrow("suspicious")
  })
})
