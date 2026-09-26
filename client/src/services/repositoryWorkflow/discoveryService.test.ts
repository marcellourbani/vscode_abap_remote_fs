const runQuery = jest.fn()
jest.mock("../../adt/conections", () => ({ getClient: jest.fn(() => ({ runQuery })) }))

import {
  PACKAGE_DISCOVERY_SQL,
  RepositoryDiscoveryService,
  tadirDiscoverySql
} from "./discoveryService"
import { WORKFLOW_SCHEMA_VERSION, RepositoryCriteria } from "./types"

const criteria: RepositoryCriteria = {
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  updatedAt: "2026-09-18T00:00:00.000Z",
  criteriaHash: "hash",
  includeNames: ["Z*", "Y?TEST"],
  excludeNames: ["ZOLD*"],
  packages: ["Z*"],
  includeSubpackages: true,
  objectTypes: ["PROG", "CLAS"],
  namespaces: ["/CUSTOM/"],
  authors: ["O'HARA"],
  createdFrom: "20260101",
  createdTo: "20261231",
  includeDeleted: false,
  includeGenerated: false,
  includeTemporary: false,
  sourceConcurrency: 5,
  targetConcurrency: 5
}

describe("fixed discovery SQL", () => {
  beforeEach(() => runQuery.mockReset())

  it("never embeds user criteria in SAP SQL", () => {
    const sql = tadirDiscoverySql(["ZPKG"])
    expect(sql).toContain("FROM tadir WHERE devclass LIKE 'ZPKG'")
    expect(PACKAGE_DISCOVERY_SQL).toBe("SELECT devclass, parentcl, namespace FROM tdevc")
    expect(sql).not.toContain("O'HARA")
    expect(sql.length).toBeLessThan(255)
    expect(PACKAGE_DISCOVERY_SQL.length).toBeLessThan(255)
  })

  it("escapes an exact package literal", () => {
    expect(tadirDiscoverySql(["Z'PKG"])).toContain("devclass LIKE 'Z''PKG'")
  })

  it("uses package patterns directly in SAP SQL", () => {
    expect(tadirDiscoverySql(["Z*"], "ZCL_*")).toContain(
      "obj_name LIKE 'ZCL\_%' AND devclass LIKE 'Z%'"
    )
  })

  it("runs one TADIR query for package patterns when subpackages are disabled", async () => {
    runQuery
      .mockResolvedValueOnce({
        values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }]
      })
      .mockResolvedValueOnce({
        values: [{ PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZKEEP", DEVCLASS: "ZPKG" }]
      })
    const rows = []
    for await (const page of new RepositoryDiscoveryService().discoverPackages("source100", {
      ...criteria,
      includeNames: ["Z*"],
      packages: ["Z*"],
      includeSubpackages: false,
      objectTypes: ["PROG"],
      namespaces: [],
      authors: [],
      createdFrom: undefined,
      createdTo: undefined
    }))
      rows.push(...page.rows)

    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery.mock.calls[1][0]).toContain("devclass LIKE 'Z%'")
    expect(rows.map(row => row.objectName)).toEqual(["ZKEEP"])
  })

  it("adds one wildcard object-name pattern to the package query", () => {
    const sql = tadirDiscoverySql(["ZPKG"], "Z*ART?COMP*")
    expect(sql).toContain("devclass LIKE 'ZPKG'")
    expect(sql).toContain("obj_name LIKE 'Z%ART_COMP%'")
    expect(sql.length).toBeLessThan(255)
  })

  it("queries only matched packages and applies object filters locally", async () => {
    runQuery
      .mockResolvedValueOnce({
        values: [
          { DEVCLASS: "ZROOT", PARENTCL: "", NAMESPACE: "" },
          { DEVCLASS: "ZCHILD", PARENTCL: "ZROOT", NAMESPACE: "" },
          { DEVCLASS: "SAP", PARENTCL: "", NAMESPACE: "" }
        ]
      })
      .mockResolvedValueOnce({
        values: [
          { PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZKEEP", DEVCLASS: "ZCHILD" },
          { PGMID: "R3TR", OBJECT: "CLAS", OBJ_NAME: "ZDROP", DEVCLASS: "ZCHILD" }
        ]
      })
    const rows = []
    for await (const page of new RepositoryDiscoveryService().discoverPackages("source100", {
      ...criteria,
      packages: ["ZROOT"],
      objectTypes: ["PROG"],
      namespaces: [],
      authors: [],
      createdFrom: undefined,
      createdTo: undefined
    }))
      rows.push(...page.rows)

    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery.mock.calls[1][0]).toContain("devclass LIKE 'ZCHILD'")
    expect(runQuery.mock.calls[1][0]).toContain("obj_name LIKE 'Z%'")
    expect(runQuery.mock.calls[1][0]).toContain("devclass LIKE 'ZROOT'")
    expect(runQuery.mock.calls.some(call => String(call[0]).includes("devclass LIKE 'SAP'"))).toBe(
      false
    )
    expect(rows.map(row => row.objectName)).toEqual(["ZKEEP"])
  })
})
