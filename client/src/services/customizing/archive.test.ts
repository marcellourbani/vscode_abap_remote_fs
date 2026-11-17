import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"
import { archiveFiles, buildAbapGitArchive, zipFiles } from "./archive"
import { loadPayload } from "./payload"
const assets = fileURLToPath(new URL("../../../media/customizing/", import.meta.url))

describe("offline abapGit archive", () => {
  it("exports the exact resolved direct-deployment source", () => {
    const files = archiveFiles(assets)
    for (const object of loadPayload(assets)) {
      const type = object.type === "CLAS/OC" ? "clas" : "prog"
      expect(files[`src/${object.file}.${type}.abap`]).toBe(object.source)
      expect(files[`src/${object.file}.${type}.xml`]).toContain(object.name)
    }
    expect(files[".abapgit.xml"]).toContain("/src/")
    expect(files.LICENSE).toContain("Copyright (c) 2026 Geert Steyaert")
    expect(files["README.md"]).toContain("SICF")
  })
  it("creates a deterministic ZIP with correct local records and directory offsets", () => {
    const first = buildAbapGitArchive(assets)
    expect(first.equals(buildAbapGitArchive(assets))).toBe(true)
    expect(first.readUInt32LE(0)).toBe(0x04034b50)
    const end = first.length - 22
    expect(first.readUInt32LE(end)).toBe(0x06054b50)
    expect(first.readUInt16LE(end + 10)).toBe(Object.keys(archiveFiles(assets)).length)
    const directory = first.readUInt32LE(end + 16)
    expect(first.readUInt32LE(directory)).toBe(0x02014b50)
    expect(directory + first.readUInt32LE(end + 12)).toBe(end)
  })
  it("preserves Unicode file content in stored entries", () => {
    const buffer = zipFiles({ "guide.md": "Grüße 日本語" })
    const nameSize = buffer.readUInt16LE(26),
      size = buffer.readUInt32LE(18)
    expect(buffer.subarray(30 + nameSize, 30 + nameSize + size).toString()).toBe("Grüße 日本語")
    expect(buffer.readUInt16LE(6)).toBe(0x800)
  })
  it.each(["../escape", "/../escape", "bad\\name", "name\u0000"])(
    "rejects unsafe path %s",
    name => {
      expect(() => zipFiles({ [name]: "x" })).toThrow("Invalid archive")
    }
  )
  it("writes known CRC32 values and matching local/central metadata", () => {
    const buffer = zipFiles({ "example.txt": "123456789", "empty.txt": "" })
    const end = buffer.length - 22,
      directory = buffer.readUInt32LE(end + 16)
    expect(buffer.readUInt32LE(14)).toBe(0xcbf43926)
    expect(buffer.readUInt32LE(directory + 16)).toBe(0xcbf43926)
    let central = directory
    for (let index = 0; index < 2; index++) {
      const local = buffer.readUInt32LE(central + 42)
      const length = buffer.readUInt16LE(central + 28)
      expect(buffer.readUInt32LE(local)).toBe(0x04034b50)
      expect(buffer.readUInt32LE(central + 20)).toBe(buffer.readUInt32LE(local + 18))
      expect(buffer.readUInt32LE(central + 24)).toBe(buffer.readUInt32LE(local + 22))
      expect(buffer.subarray(central + 46, central + 46 + length)).toEqual(
        buffer.subarray(local + 30, local + 30 + length)
      )
      central += 46 + length
    }
    expect(central).toBe(end)
  })
  it("includes correct serializers and program/class attributes", () => {
    const files = archiveFiles(assets)
    for (const [name, source] of Object.entries(files)) {
      if (name.endsWith(".clas.xml")) {
        expect(source).toContain('serializer="LCL_OBJECT_CLAS"')
        expect(source).toContain("<UNICODE>X</UNICODE>")
      }
      if (name.endsWith(".prog.xml")) {
        expect(source).toContain('serializer="LCL_OBJECT_PROG"')
        expect(source).toContain("<SUBC>1</SUBC>")
      }
    }
    expect(Object.keys(files)).toHaveLength(10)
  })
  it("exports neither unresolved placeholders nor donor object identities", () => {
    for (const [name, source] of Object.entries(archiveFiles(assets))) {
      if (!name.endsWith(".abap")) continue
      expect(source).not.toMatch(/\{\{[A-Z_]+\}\}/)
      expect(source).not.toMatch(/zcl_mcp|zmcp_cust_write/i)
    }
  })
  it.each(["/absolute", "C:/absolute", "./relative", "folder//file", "folder/./file", ""])(
    "rejects noncanonical ZIP path %s",
    name => {
      expect(() => zipFiles({ [name]: "content" })).toThrow("Invalid archive")
    }
  )
  it("propagates missing asset errors", () =>
    expect(() => buildAbapGitArchive("missing-assets")).toThrow())
  it("can encode an empty valid ZIP", () => expect(zipFiles({}).readUInt32LE(0)).toBe(0x06054b50))
})
