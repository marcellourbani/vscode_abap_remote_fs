import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { resolveProjectRoot } from "./projectRoot"

describe("resolveProjectRoot", () => {
  const originalCwd = process.cwd()
  let tmp: string

  beforeEach(() => {
    // realpathSync resolves macOS's `/var` -> `/private/var` symlink so the
    // string returned by process.cwd() (after chdir) matches our tmp dir.
    tmp = realpathSync(mkdtempSync(resolve(tmpdir(), "projectroot-test-")))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tmp, { recursive: true, force: true })
  })

  test("returns cwd when package.json + 4 source dirs are present", () => {
    writeFileSync(resolve(tmp, "package.json"), JSON.stringify({ name: "vscode-abap-remote-fs" }))
    for (const d of ["client/src", "server/src", "modules/abapfs/src", "modules/abapObject/src"]) {
      mkdirSync(resolve(tmp, d), { recursive: true })
    }
    process.chdir(tmp)
    expect(resolveProjectRoot()).toBe(tmp)
  })

  test("throws when package.json is missing", () => {
    process.chdir(tmp)
    expect(() => resolveProjectRoot()).toThrow(/No package\.json/)
  })

  test("throws when package.json name is wrong", () => {
    writeFileSync(resolve(tmp, "package.json"), JSON.stringify({ name: "some-other-project" }))
    process.chdir(tmp)
    expect(() => resolveProjectRoot()).toThrow(/not "vscode-abap-remote-fs"/)
  })

  test("throws when an expected source dir is missing", () => {
    writeFileSync(resolve(tmp, "package.json"), JSON.stringify({ name: "vscode-abap-remote-fs" }))
    // Only create 3 of the 4 required dirs
    for (const d of ["client/src", "server/src", "modules/abapfs/src"]) {
      mkdirSync(resolve(tmp, d), { recursive: true })
    }
    process.chdir(tmp)
    expect(() => resolveProjectRoot()).toThrow(/modules\/abapObject\/src/)
  })
})
