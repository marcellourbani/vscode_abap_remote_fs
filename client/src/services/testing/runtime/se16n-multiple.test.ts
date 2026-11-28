import type { SapSession } from "./sap-session"
import { describe, expect, it, vi } from "vitest"
import { Se16nDriver, type Se16nValue } from "./se16n"

function setup(count: number) {
  const sap = { raw: () => ({}), note: vi.fn(), settle: vi.fn() }
  const driver = new Se16nDriver(sap as unknown as SapSession, {
    table: "MARA",
    outputFields: ["MATNR"]
  })
  const value = driver as unknown as {
    applyMultiple(field: string, values: Se16nValue[]): Promise<void>
    resolvedRow: ReturnType<typeof vi.fn>
    click: ReturnType<typeof vi.fn>
    waitModal: ReturnType<typeof vi.fn>
    pressToolbar: ReturnType<typeof vi.fn>
    multiRow: ReturnType<typeof vi.fn>
    setPopupOption: ReturnType<typeof vi.fn>
    setCell: ReturnType<typeof vi.fn>
    commit: ReturnType<typeof vi.fn>
    uploadValues: ReturnType<typeof vi.fn>
    valueOf: ReturnType<typeof vi.fn>
    scrollMultiToTop: ReturnType<typeof vi.fn>
    readRows: ReturnType<typeof vi.fn>
    messageSuffix: ReturnType<typeof vi.fn>
  }
  value.resolvedRow = vi.fn(async () => 1)
  value.click = vi.fn()
  value.waitModal = vi.fn()
  value.pressToolbar = vi.fn()
  value.multiRow = vi.fn(async i => i + 1)
  value.setPopupOption = vi.fn()
  value.setCell = vi.fn()
  value.commit = vi.fn()
  value.uploadValues = vi.fn(async () => true)
  value.valueOf = vi.fn(async () => String(count))
  value.scrollMultiToTop = vi.fn()
  value.readRows = vi.fn(async () => ({ 1: { moreIcon: "s_bgmore" } }))
  value.messageSuffix = vi.fn(async () => "")
  return { value, sap }
}

describe("SE16N multiple-selection decisions", () => {
  it("writes short selections row by row, preserving each option", async () => {
    const { value } = setup(2)
    const values: Se16nValue[] = [{ low: "A" }, { low: "B", high: "D", option: "BT", sign: "E" }]
    await value.applyMultiple("MATNR", values)
    expect(value.uploadValues).not.toHaveBeenCalled()
    expect(value.setPopupOption.mock.calls.map(call => call[2])).toEqual(values)
    expect(value.setCell).toHaveBeenCalledTimes(3)
    expect(value.pressToolbar).toHaveBeenCalledWith("Transfer Data", 1)
  })
  it("uses clipboard only for long plain include-equality lists", async () => {
    const { value } = setup(6)
    await value.applyMultiple(
      "MATNR",
      Array.from({ length: 6 }, (_, i) => ({ low: String(i) }))
    )
    expect(value.uploadValues).toHaveBeenCalledWith(["0", "1", "2", "3", "4", "5"])
    expect(value.setCell).not.toHaveBeenCalled()
  })
  it.each([{ sign: "E" }, { option: "NE" }, { option: "BT", high: "Z" }] as const)(
    "never uses clipboard for non-plain values %j",
    async extra => {
      const { value } = setup(6)
      await value.applyMultiple(
        "MATNR",
        Array.from({ length: 6 }, (_, i) => ({ low: String(i), ...extra }))
      )
      expect(value.uploadValues).not.toHaveBeenCalled()
      expect(value.setPopupOption).toHaveBeenCalledTimes(6)
    }
  )
  it("clears incomplete clipboard input before refilling all values", async () => {
    const { value, sap } = setup(6)
    value.valueOf.mockResolvedValueOnce("2")
    await value.applyMultiple(
      "MATNR",
      Array.from({ length: 6 }, (_, i) => ({ low: String(i) }))
    )
    expect(value.scrollMultiToTop).toHaveBeenCalledOnce()
    expect(value.setCell).toHaveBeenCalledTimes(6)
    expect(value.pressToolbar.mock.calls.filter(call => call[0] === "All Entries")).toHaveLength(2)
    expect(sap.note).toHaveBeenCalledWith(expect.stringContaining("incomplete"))
  })
  it("falls back when clipboard access is unavailable", async () => {
    const { value } = setup(6)
    value.uploadValues.mockResolvedValue(false)
    await value.applyMultiple(
      "MATNR",
      Array.from({ length: 6 }, (_, i) => ({ low: String(i) }))
    )
    expect(value.setCell).toHaveBeenCalledTimes(6)
  })
  it("does not transfer when SAP reports the wrong criterion count", async () => {
    const { value } = setup(1)
    await expect(value.applyMultiple("MATNR", [{ low: "A" }, { low: "B" }])).rejects.toThrow(
      /holds 1 criteria/
    )
    expect(value.pressToolbar).not.toHaveBeenCalledWith("Transfer Data", 1)
  })
  it("rejects a transfer that leaves the More button empty", async () => {
    const { value } = setup(1)
    value.readRows.mockResolvedValue({ 1: { moreIcon: "s_b_more" } })
    await expect(value.applyMultiple("MATNR", [{ low: "A" }])).rejects.toThrow(/not transferred/)
  })
  it("propagates upload errors rather than claiming fallback success", async () => {
    const { value } = setup(6)
    value.uploadValues.mockRejectedValue(new Error("Clipboard dialog stuck"))
    await expect(
      value.applyMultiple(
        "MATNR",
        Array.from({ length: 6 }, (_, i) => ({ low: String(i) }))
      )
    ).rejects.toThrow("Clipboard dialog stuck")
    expect(value.setCell).not.toHaveBeenCalled()
  })
})
