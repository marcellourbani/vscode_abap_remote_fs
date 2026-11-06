import { afterEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { UsageStore } from "./store"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})
const make = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-test-"))
  roots.push(root)
  return new UsageStore(root)
}
describe("usage workflow persistence", () => {
  it("rejects duplicate names after trimming and case normalization without changing existing data", async () => {
    const store = await make()
    const existing = await store.create("Quarterly Review")
    await store.update(existing.id, state => {
      state.issues.push("Existing evidence")
    })
    for (const name of ["Quarterly Review", "  quarterly review  ", "QUARTERLY REVIEW"]) {
      await expect(new UsageStore(store.root).create(name)).rejects.toThrow(/already exists/i)
    }
    expect(await store.list()).toHaveLength(1)
    expect((await store.get(existing.id)).issues).toEqual(["Existing evidence"])
  })
  it("rejects blank names and allows reusing a deleted name", async () => {
    const store = await make()
    await expect(store.create("   ")).rejects.toThrow(/name/i)
    const existing = await store.create("Example")
    await store.remove(existing.id)
    expect((await store.create("Example")).name).toBe("Example")
  })
  it("serializes concurrent creation across stores sharing the same directory", async () => {
    const store = await make()
    const results = await Promise.allSettled([
      store.create("Example"),
      new UsageStore(store.root).create(" example ")
    ])
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)
  })
  it("persists every concurrent update and recovers interrupted runs", async () => {
    const store = await make()
    const state = await store.create("Example")
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.update(state.id, current => {
          current.issues.push(String(index))
        })
      )
    )
    expect((await store.get(state.id)).issues).toHaveLength(10)
    await store.update(state.id, current => {
      current.run.status = "running"
    })
    await new UsageStore(store.root).initialize()
    expect((await store.get(state.id)).run.status).toBe("interrupted")
  })
  it("enforces exclusive owned locks and validates ids", async () => {
    const store = await make()
    const state = await store.create("Example")
    await store.lock(state.id)
    await expect(store.lock(state.id)).rejects.toThrow(/running/)
    await expect(store.remove(state.id)).rejects.toThrow(/running/)
    await store.unlock(state.id)
    await store.remove(state.id)
    expect(await store.list()).toEqual([])
    await expect(store.get("../escape")).rejects.toThrow(/id/)
  })
  it("removes persisted input artifacts for either supported extension", async () => {
    const store = await make()
    const state = await store.create("Example")
    const inputId = "a".repeat(64)
    await store.saveOriginal(state.id, inputId, ".xlsx", new Uint8Array([1]))
    await store.saveOriginal(state.id, inputId, ".csv", new Uint8Array([2]))
    await store.removeOriginal(state.id, inputId)
    await expect(
      fs.access(path.join(store.root, state.id, "inputs", `${inputId}.xlsx`))
    ).rejects.toThrow()
    await expect(
      fs.access(path.join(store.root, state.id, "inputs", `${inputId}.csv`))
    ).rejects.toThrow()
  })
})
