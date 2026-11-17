import { describe, expect, it } from "vitest"
import { buildSicfReport, SICF_REPORT } from "./sicfReport"
import { archiveFiles } from "./archive"
import { join } from "node:path"

describe("user-triggered SICF installer", () => {
  it("uses verified ICF APIs, explicit transport and truthful risk classification", () => {
    const source = buildSicfReport("ZCFG", "EXAK900001")
    for (const text of [
      "* ABAP FS Customizing 1.0.1",
      "* Adapted from abap-config-mcp (MIT), Copyright (c) 2026 Geert Steyaert.",
      "RISK LEVEL HARMLESS DURATION SHORT",
      "service_from_url(",
      "hostnumber = 0",
      "insert_node(",
      "change_node(",
      "check_service_active(",
      "i_dark_transport = abap_true",
      "VALUE 'EXAK900001'",
      "package = 'ZCFG'",
      "CHANGING transport = request",
      "COMMIT WORK AND WAIT",
      "another handler is assigned",
      "node = 'ZABAPFS_CUST'",
      "handler = 'ZCL_ABAPFS_CUST_ENGINE'",
      "node = 'ZABAPFS_DIAG'",
      "handler = 'ZCL_ABAPFS_DIAG'"
    ])
      expect(source).toContain(text)
    expect(source).not.toContain("\n  *")
    expect(source).not.toContain("RISK LEVEL DANGEROUS")
    expect(source).not.toContain("MODIFY tvarvc")
    expect(source).not.toContain("EEPI2GLFNOLHN7IW9R54I61RZ")
    expect(source).not.toContain("icfserdesc =")
  })
  it.each(["Z';INJECT", "", "Z SPACE"])("refuses invalid package %s", name => {
    expect(() => buildSicfReport(name)).toThrow("Invalid")
  })
  it("refuses invalid transport literals", () => {
    expect(() => buildSicfReport("$TMP", "bad'")).toThrow("Invalid")
  })
  it("accepts local $-prefixed packages", () => {
    expect(buildSicfReport("$LOCAL")).toContain("package = '$LOCAL'")
  })
  it("keeps the installer out of the abapGit payload", () => {
    const files = archiveFiles(join(import.meta.dirname, "../../../media/customizing"))
    expect(Object.keys(files).some(name => name.toUpperCase().includes(SICF_REPORT.name))).toBe(
      false
    )
  })
})
