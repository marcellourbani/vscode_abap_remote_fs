import { describe, expect, it, vi } from "vitest"
import { SapArtifacts } from "./sap-artifacts"
import type { SapSession } from "./sap-session"

function setup(count = 1) {
  const root = {
    getByRole: vi.fn().mockReturnValue({ filter: () => ({ count: async () => count }) }),
    innerText: vi.fn().mockResolvedValue("Rendered spool")
  }
  const sap = {
    openTx: vi.fn(),
    setField: vi.fn(),
    execute: vi.fn(),
    note: vi.fn(),
    captureDownload: vi.fn().mockImplementation(async action => {
      await action()
      return "probe"
    }),
    contentRoot: vi.fn().mockResolvedValue(root),
    selectGridRowByText: vi.fn(),
    clickButton: vi.fn()
  }
  return { sap, artifacts: new SapArtifacts(sap as unknown as SapSession) }
}

describe("SAP artifact verification", () => {
  it("requires a completed download to certify an application-server file", async () => {
    const { sap, artifacts } = setup()
    sap.captureDownload.mockRejectedValue(new Error("Download did not start"))
    await expect(artifacts.verifyAL11FilePresent("/example/file.csv")).rejects.toThrow(
      "Download did not start"
    )
    expect(sap.note).not.toHaveBeenCalled()
  })
  it("runs the download trigger and records success only afterward", async () => {
    const { sap, artifacts } = setup()
    await expect(artifacts.verifyAL11FilePresent("/example/file.csv")).resolves.toBe(true)
    expect(sap.execute).toHaveBeenCalledOnce()
    expect(sap.note).toHaveBeenCalledOnce()
  })
  it.each([0, 2])("rejects ambiguous spool selection (%i matching rows)", async count => {
    const { sap, artifacts } = setup(count)
    await expect(artifacts.captureLatestSpoolForUser("EXAMPLE_USER")).rejects.toThrow(
      "unambiguously"
    )
    expect(sap.clickButton).not.toHaveBeenCalled()
  })
  it("reads spool output from the resolved SAP document", async () => {
    const { artifacts } = setup()
    await expect(artifacts.captureLatestSpoolForUser("EXAMPLE_USER")).resolves.toBe(
      "Rendered spool"
    )
  })
})
