import * as vm from "vm"
import { wrapAsAsyncFunction } from "./jsCodeWrapper"

async function evaluateCell(code: string, context: vm.Context = {}): Promise<unknown> {
  const wrapped = wrapAsAsyncFunction(code)
  const asyncFunction = new vm.Script(wrapped).runInNewContext(context) as () => Promise<unknown>
  return asyncFunction()
}

describe("wrapAsAsyncFunction", () => {
  test.each([
    ["42", 42],
    ["const value = 2;\nvalue + 1", 3],
    ["const value = 2;\n({ value })", { value: 2 }],
    ["const value = 2;\n({\n  value,\n  doubled: value * 2\n})", { value: 2, doubled: 4 }],
    ["const value = 2;\n[\n  value,\n  value * 2\n]", [2, 4]],
    ["const value = 2;\nvalue +\n  3", 5],
    ["const value = 2;\nvalue // final value", 2],
    ["const value = 2;\nvalue; // final value", 2],
    ["const value = 2;\nvalue;\n// trailing comment", 2],
    ["const value = 2;\nvalue;\n/* trailing block */", 2],
    ["const value = 2; value + 3;", 5],
    ["const value = 2;\n`value: ${value}`", "value: 2"],
    ["const value = 2;\n/ab/.test('abc')", true],
    ["const value = 2;\n(async () => value * 2)()", 4],
    ["const value = await Promise.resolve(2);\nvalue * 2", 4],
    ["\n  const value = 2;\n  value * 2  \n", 4],
    ["const value = 2;\nvalue + 3;\n\n", 5],
    ["const value = 2;\n(value + 3)", 5],
    [
      "const value = 2;\n({ value, nested: { count: value + 1 } })",
      { value: 2, nested: { count: 3 } }
    ],
    ["const value = 2;\nvalue === 2 ? 'yes' : 'no'", "yes"],
    ["const value = 2;\nvalue ?? 9", 2],
    ["const row = { item: { count: 4 } };\nrow?.item?.count", 4],
    ["const value = 2;\n(() => { return value * 2 })()", 4],
    ["function twice(value) { return value * 2 }\ntwice(2)", 4],
    ["class Counter { static count = 4 }\nCounter.count", 4],
    ["function* numbers() { yield 2; yield 4 }\nArray.from(numbers())", [2, 4]],
    ["const values = [1, 2];\nvalues.map(value => value * 2)", [2, 4]],
    ["const values = await Promise.all([Promise.resolve(2), Promise.resolve(4)]);\nvalues", [2, 4]],
    ["const value = 2;\n/* middle */ value + 2 /* end */", 4],
    ["const value = 2;\nvalue + 2\n// return the total", 4],
    ["const value = 2;\nvalue + 2\n/* return the total */", 4],
    ["const value = 2;\n/ab/.test('abc'); // regex", true],
    ["'use strict';\nconst value = 2;\nvalue * 2", 4],
    ["const value = 2;\nvalue + 2; /* trailing */", 4]
  ])("returns the final expression of %s", async (code, expected) => {
    await expect(evaluateCell(code as string)).resolves.toEqual(expected)
  })

  test.each([
    "const value = 2;\nreturn value * 2;",
    "let value = 2;\nreturn value * 2;",
    "var value = 2;\nreturn value * 2;",
    "const value = 2;\nreturn (\n  value * 2\n);",
    "const value = 2;\nif (value > 0) return value * 2;",
    "const value = 2;\nif (value > 0) {\n  return value * 2;\n}",
    "let value = 2;\ntry {\n  return value * 2;\n} finally {\n  value = 3;\n}"
  ])("preserves an explicit cell-level return in %s", async code => {
    await expect(evaluateCell(code)).resolves.toBe(4)
  })

  test("preserves a cell-level return after declarations", async () => {
    await expect(evaluateCell("const count = 3;\nreturn count * 2;")).resolves.toBe(6)
  })

  test("preserves top-level await inside the async cell body", async () => {
    await expect(
      evaluateCell("const count = await Promise.resolve(3);\nreturn count * 2;")
    ).resolves.toBe(6)
  })

  test("returns a top-level await expression when there is no explicit return", async () => {
    await expect(evaluateCell("await Promise.resolve(3)")).resolves.toBe(3)
  })

  test("keeps nested returns distinct from the cell result", async () => {
    const code = "const values = [1, 2].map(value => {\n  return value * 2;\n});\nvalues"
    await expect(evaluateCell(code)).resolves.toEqual([2, 4])
  })

  test.each([
    "",
    "  // only a comment\n",
    "const value = 2;",
    "let value = 2;\nif (value) { value++ }",
    "let value = 0;\nfor (let index = 0; index < 3; index++) value += index;",
    "function twice(value) { return value * 2 }",
    "'use strict';"
  ])("does not invent a result for statement-only code: %s", async code => {
    await expect(evaluateCell(code)).resolves.toBeUndefined()
  })

  test("returns a value from a conditional cell-level return", async () => {
    await expect(
      evaluateCell("const value = 2;\nif (value > 0) return value;\nreturn 0;")
    ).resolves.toBe(2)
  })

  test("preserves a thrown runtime error", async () => {
    await expect(evaluateCell("throw new Error('bad cell')")).rejects.toThrow("bad cell")
  })

  test.each(["const = 1", "return (", "const value = 2;\nvalue +", "import x from 'x'"])(
    "rejects unsupported or malformed cell code: %s",
    code => {
      expect(() => wrapAsAsyncFunction(code)).toThrow()
    }
  )

  test("combines workbook cell results and returns the display value", async () => {
    const code = [
      "const parts = [cells[1], cells[2], cells[3]];",
      "const rows = parts.flatMap(part => part.result.map(record => ({ System: part.system, ...record })));",
      "const counts = parts.map(part => part.system + ': ' + part.result.length).join(', ');",
      "return display.all(",
      "  display.markdown('## ' + rows.length + ' clients (' + counts + ')'),",
      "  display.table(rows, { wrap: true })",
      ");"
    ].join("\n")
    const context = {
      cells: {
        1: { system: "ged100", result: [{ MANDT: "100" }] },
        2: { system: "md2100", result: [{ MANDT: "100" }] },
        3: { system: "btd210", result: [{ MANDT: "210" }] }
      },
      display: {
        all: (...items: unknown[]) => items,
        markdown: (text: string) => ({ text }),
        table: (rows: unknown[]) => ({ rows })
      }
    }
    await expect(evaluateCell(code, context)).resolves.toEqual([
      { text: "## 3 clients (ged100: 1, md2100: 1, btd210: 1)" },
      {
        rows: [
          { System: "ged100", MANDT: "100" },
          { System: "md2100", MANDT: "100" },
          { System: "btd210", MANDT: "210" }
        ]
      }
    ])
  })
})
