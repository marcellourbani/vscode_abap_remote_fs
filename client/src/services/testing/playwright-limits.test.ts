import { normalizeMaxFailures, normalizeMaxTasks, normalizeTcIds } from "./playwright-limits"

describe("normalizeMaxFailures", () => {
  it("defaults to 3 and caps explicit values at 10", () => {
    expect(normalizeMaxFailures(undefined)).toBe(3)
    expect(normalizeMaxFailures(7)).toBe(7)
    expect(normalizeMaxFailures(99)).toBe(10)
  })

  it("rejects non-positive and fractional values", () => {
    expect(() => normalizeMaxFailures(0)).toThrow(/positive integer/)
    expect(() => normalizeMaxFailures(1.5)).toThrow(/positive integer/)
  })
})

describe("normalizeMaxTasks", () => {
  it("defaults to 3 and caps explicit values at 5", () => {
    expect(normalizeMaxTasks(undefined)).toBe(3)
    expect(normalizeMaxTasks(4)).toBe(4)
    expect(normalizeMaxTasks(99)).toBe(5)
  })

  it("rejects non-positive and fractional values", () => {
    expect(() => normalizeMaxTasks(0)).toThrow(/positive integer/)
    expect(() => normalizeMaxTasks(1.5)).toThrow(/positive integer/)
  })
})

describe("normalizeTcIds", () => {
  it("preserves order and removes duplicates", () => {
    expect(normalizeTcIds(["TC-002", "TC-010a-bt", "TC-002"])).toEqual(["TC-002", "TC-010a-bt"])
  })

  it("uses omission for all tests and rejects empty or unsafe IDs", () => {
    expect(normalizeTcIds(undefined)).toBeUndefined()
    expect(() => normalizeTcIds([])).toThrow(/non-empty array/)
    expect(() => normalizeTcIds(["../TC-001"])).toThrow(/invalid test case IDs/)
    expect(() => normalizeTcIds([42 as any])).toThrow(/invalid test case IDs/)
  })
})
