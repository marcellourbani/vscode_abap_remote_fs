import { afterEach, describe, expect, it, vi } from "vitest"
import { Se16nDriver, type Se16nSpec } from "./se16n"
import type { SapSession } from "./sap-session"
import { detectRuntimeError } from "./dump-detector"

vi.mock("./dump-detector", () => ({ detectRuntimeError: vi.fn(async () => null) }))
afterEach(() => vi.clearAllMocks())

function setup(spec: Partial<Se16nSpec> = {}) {
  const page = { title: vi.fn(async () => "Selection") }
  const sap = {
    raw: () => page,
    statusMessage: vi.fn(async () => ({ text: "", isError: false })),
    note: vi.fn()
  }
  const driver = new Se16nDriver(sap as unknown as SapSession, {
    table: "MARA",
    outputFields: ["MATNR"],
    ...spec
  })
  // Replace UI primitives, not the execute orchestration under test.
  const scope = {
    waitForFunction: vi.fn(async () => ({
      jsonValue: async () => ({ title: "Display of Entries Found", message: "", onResult: true })
    }))
  }
  const value = driver as unknown as {
    execute(): Promise<{ hits: number; partial: boolean; rows: string[][] }>
    scope: typeof scope
    pressToolbar: ReturnType<typeof vi.fn>
    valueOf: ReturnType<typeof vi.fn>
    readResultGrid: ReturnType<typeof vi.fn>
  }
  value.scope = scope
  value.pressToolbar = vi.fn()
  value.valueOf = vi.fn(async (sid: string) => (sid.includes("NUMBER") ? "3" : "0.001"))
  value.readResultGrid = vi.fn(async () => ({
    fields: ["MATNR"],
    columns: ["Material"],
    rows: [["1"], ["2"]]
  }))
  return { value, scope, sap, page }
}

describe("SE16N execution orchestration", () => {
  it("reports partial results using SAP count, not visible row count", async () => {
    const { value, sap } = setup({ expect: { exactRows: 3 } })
    expect(await value.execute()).toMatchObject({ hits: 3, partial: true })
    expect(sap.note).toHaveBeenCalledWith("SE16N MARA: 3 entries")
  })
  it("reports a complete visible result without marking it partial", async () => {
    const { value } = setup()
    value.valueOf.mockResolvedValue("2")
    expect(await value.execute()).toMatchObject({ hits: 2, partial: false })
  })
  it.each(["1,234", "1.234", "1 234"])("accepts SAP grouped hit counts %s", async count => {
    const { value } = setup()
    value.valueOf.mockResolvedValue(count)
    expect((await value.execute()).hits).toBe(1234)
  })
  it("does not turn a missing hit count into zero", async () => {
    const { value, sap } = setup({ expect: { empty: true } })
    value.valueOf.mockResolvedValue("")
    await expect(value.execute()).rejects.toThrow(/hit count/)
    expect(sap.note).not.toHaveBeenCalled()
  })
  it("requires requested technical fields even when the count matches", async () => {
    const { value } = setup({ expect: { exactRows: 3 } })
    value.readResultGrid.mockResolvedValue({ fields: ["OTHER"], columns: ["Material"], rows: [] })
    await expect(value.execute()).rejects.toThrow(/missing requested output/)
  })
  it("recognizes explicit empty result with SAP error styling", async () => {
    const { value, sap, scope } = setup({ expect: { empty: true } })
    sap.statusMessage.mockResolvedValue({ text: "No values found", isError: true })
    scope.waitForFunction.mockResolvedValue({
      jsonValue: async () => ({ title: "Selection", message: "No values found", onResult: false })
    })
    expect(await value.execute()).toMatchObject({ hits: 0, rows: [], partial: false })
    expect(value.readResultGrid).not.toHaveBeenCalled()
  })
  it.each(["No data authorization", "No data access", "Invalid selection"])(
    "never treats a SAP error as an empty pass: %s",
    async text => {
      const { value, sap } = setup({ expect: { empty: true } })
      sap.statusMessage.mockResolvedValue({ text, isError: true })
      await expect(value.execute()).rejects.toThrow(text)
      expect(value.readResultGrid).not.toHaveBeenCalled()
    }
  )
  it("propagates detached-frame failures instead of waiting ten minutes", async () => {
    const { value, scope } = setup()
    scope.waitForFunction.mockRejectedValue(new Error("Frame was detached"))
    await expect(value.execute()).rejects.toThrow("Frame was detached")
  })
  it("retries a bounded query wait timeout before reading the result", async () => {
    const { value, scope } = setup()
    scope.waitForFunction.mockRejectedValueOnce(
      Object.assign(new Error("still processing"), { name: "TimeoutError" })
    )
    await expect(value.execute()).resolves.toMatchObject({ hits: 3 })
    expect(scope.waitForFunction).toHaveBeenCalledTimes(2)
  })
  it.each(["dump", "its", "logon"] as const)(
    "does not waive %s when zero rows are expected",
    async kind => {
      const { value } = setup({ expect: { empty: true } })
      vi.mocked(detectRuntimeError).mockResolvedValueOnce({
        kind,
        title: "Failure",
        snippet: "Details",
        url: "https://example.invalid"
      })
      await expect(value.execute()).rejects.toThrow(kind)
    }
  )
  it("respects output-evidence opt-out without removing assertions", async () => {
    const { value, sap } = setup({ evidence: { output: false }, expect: { exactRows: 99 } })
    await expect(value.execute()).rejects.toThrow(/exactly 99/)
    expect(sap.note).not.toHaveBeenCalled()
  })
})
