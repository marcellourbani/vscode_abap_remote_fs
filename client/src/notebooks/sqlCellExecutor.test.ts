jest.mock("./interpolation", () => ({
  interpolateSql: jest.fn((sql: string) => sql),
}), { virtual: false })

import { executeSqlCell } from "./sqlCellExecutor"
import { interpolateSql } from "./interpolation"
import { DEFAULT_MAX_ROWS } from "./types"
import type { CellResult } from "./types"

const mockInterpolateSql = interpolateSql as jest.Mock

function makeClient(runQueryResult?: any): any {
  return {
    runQuery: jest.fn().mockResolvedValue(runQueryResult ?? {
      columns: [{ name: "MATNR", type: "C" }],
      values: [{ MATNR: "MAT001" }],
    }),
  }
}

describe("executeSqlCell — happy paths", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockInterpolateSql.mockImplementation((sql: string) => sql)
  })

  test("executes a simple SELECT and returns rows", async () => {
    const client = makeClient({
      columns: [{ name: "MATNR", type: "C" }, { name: "MBRSH", type: "C" }],
      values: [{ MATNR: "M1", MBRSH: "A" }, { MATNR: "M2", MBRSH: "B" }],
    })
    const result = await executeSqlCell("SELECT matnr, mbrsh FROM mara", client, 0, new Map())
    expect(result.result).toHaveLength(2)
    expect(result.rowCount).toBe(2)
    expect(result.columns).toHaveLength(2)
    expect(result.columns![0].name).toBe("MATNR")
  })

  test("uses DEFAULT_MAX_ROWS when maxRows is not provided", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map())
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_MAX_ROWS,
      true
    )
  })

  test("uses provided maxRows when valid", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), 500)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      500,
      true
    )
  })

  test("caps maxRows to ADT_MAX_ROWS_LIMIT (10_000_000)", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), 999_999_999)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      10_000_000,
      true
    )
  })

  test("falls back to DEFAULT_MAX_ROWS for maxRows=0", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), 0)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_MAX_ROWS,
      true
    )
  })

  test("falls back to DEFAULT_MAX_ROWS for negative maxRows", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), -1)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_MAX_ROWS,
      true
    )
  })

  test("falls back to DEFAULT_MAX_ROWS for Infinity", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), Infinity)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_MAX_ROWS,
      true
    )
  })

  test("returns empty result when client returns null", async () => {
    const client = { runQuery: jest.fn().mockResolvedValue(null) }
    const result = await executeSqlCell("SELECT * FROM mara", client as any, 0, new Map())
    expect(result.result).toEqual([])
    expect(result.rowCount).toBe(0)
    expect(result.columns).toEqual([])
  })

  test("returns empty result when client returns object without columns", async () => {
    const client = { runQuery: jest.fn().mockResolvedValue({}) }
    const result = await executeSqlCell("SELECT * FROM mara", client as any, 0, new Map())
    expect(result.result).toEqual([])
    expect(result.rowCount).toBe(0)
  })

  test("handles string column names (legacy format)", async () => {
    const client = makeClient({
      columns: ["MATNR", "MBRSH"],
      values: [{ MATNR: "M1", MBRSH: "A" }],
    })
    const result = await executeSqlCell("SELECT matnr FROM mara", client, 0, new Map())
    expect(result.columns![0].name).toBe("MATNR")
    expect(result.columns![0].type).toBe("C")
  })

  test("handles column objects with COLUMN_NAME property", async () => {
    const client = makeClient({
      columns: [{ COLUMN_NAME: "MATNR" }],
      values: [],
    })
    const result = await executeSqlCell("SELECT matnr FROM mara", client, 0, new Map())
    expect(result.columns![0].name).toBe("MATNR")
  })

  test("calls interpolateSql with the SQL and cellResults", async () => {
    const client = makeClient()
    const cellResults = new Map<number, CellResult>([[0, { result: "MAT001" }]])
    await executeSqlCell("SELECT * FROM mara WHERE matnr = 'X'", client, 1, cellResults)
    expect(mockInterpolateSql).toHaveBeenCalledWith(
      "SELECT * FROM mara WHERE matnr = 'X'",
      cellResults
    )
  })

  test("floors decimal maxRows", async () => {
    const client = makeClient()
    await executeSqlCell("SELECT * FROM mara", client, 0, new Map(), 3.9)
    expect(client.runQuery).toHaveBeenCalledWith(
      expect.any(String),
      3,
      true
    )
  })

  test("executes WITH statement", async () => {
    const client = makeClient()
    await executeSqlCell("WITH cte AS (SELECT 1) SELECT * FROM cte", client, 0, new Map())
    expect(client.runQuery).toHaveBeenCalled()
  })

  test("returns values array from runQuery", async () => {
    const values = [{ A: 1 }, { A: 2 }, { A: 3 }]
    const client = makeClient({ columns: [{ name: "A", type: "I" }], values })
    const result = await executeSqlCell("SELECT a FROM t", client, 0, new Map())
    expect(result.result).toBe(values)
  })

  test("counts rows correctly when values array has entries", async () => {
    const values = Array.from({ length: 7 }, (_, i) => ({ N: i }))
    const client = makeClient({ columns: [{ name: "N", type: "I" }], values })
    const result = await executeSqlCell("SELECT n FROM t", client, 0, new Map())
    expect(result.rowCount).toBe(7)
  })
})

describe("executeSqlCell — validation errors", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockInterpolateSql.mockImplementation((sql: string) => sql)
  })

  test("throws when SQL is empty", async () => {
    const client = makeClient()
    await expect(executeSqlCell("", client, 0, new Map())).rejects.toThrow("empty")
  })

  test("throws when SQL is only whitespace", async () => {
    const client = makeClient()
    await expect(executeSqlCell("   \n\t  ", client, 0, new Map())).rejects.toThrow("empty")
  })

  test("throws for INSERT statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("INSERT INTO mara VALUES ('X')", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for UPDATE statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("UPDATE mara SET mbrsh = 'A'", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for DELETE statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("DELETE FROM mara WHERE matnr = 'X'", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for DROP statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("DROP TABLE mara", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for CREATE statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("CREATE TABLE test (id int)", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for ALTER statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("ALTER TABLE mara ADD col CHAR(10)", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws for TRUNCATE statement", async () => {
    const client = makeClient()
    await expect(executeSqlCell("TRUNCATE TABLE mara", client, 0, new Map()))
      .rejects.toThrow(/SELECT and WITH/)
  })

  test("throws when SQL contains a semicolon", async () => {
    const client = makeClient()
    await expect(executeSqlCell("SELECT * FROM mara;", client, 0, new Map()))
      .rejects.toThrow(/[Ss]emicolon/)
  })

  test("allows DELETE keyword inside string literals", async () => {
    const client = makeClient()
    // "DELETE" inside a quoted string should pass validation
    await expect(
      executeSqlCell("SELECT * FROM mara WHERE text = 'DELETE is forbidden'", client, 0, new Map())
    ).resolves.toBeDefined()
  })

  test("strips block comments before validation", async () => {
    const client = makeClient()
    // A comment mentioning INSERT shouldn't trip the validator
    await expect(
      executeSqlCell("/* INSERT comment */ SELECT * FROM mara", client, 0, new Map())
    ).resolves.toBeDefined()
  })

  test("strips line comments before validation", async () => {
    const client = makeClient()
    await expect(
      executeSqlCell("SELECT * FROM mara -- INSERT some rows", client, 0, new Map())
    ).resolves.toBeDefined()
  })

  test("case-insensitive first word check (lowercase select)", async () => {
    const client = makeClient()
    await expect(
      executeSqlCell("select * from mara", client, 0, new Map())
    ).resolves.toBeDefined()
  })
})
