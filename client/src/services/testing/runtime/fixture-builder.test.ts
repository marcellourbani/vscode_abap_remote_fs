import { describe, expect, it } from "vitest"
import { buildFixture } from "./fixture-builder"

describe("fixture output boundaries", () => {
  it.each(["../escape.csv", "..\\escape.csv", "/escape.csv", "folder/file.csv", "..", ""])(
    "rejects non-filename output %s before writing",
    async filename => {
      await expect(
        buildFixture({ format: "csv", filename, columns: [], rows: [] }, {}, ".")
      ).rejects.toThrow("filename only")
    }
  )
})
