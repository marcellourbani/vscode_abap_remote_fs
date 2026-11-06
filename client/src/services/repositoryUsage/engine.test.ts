import { afterEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
const notification = vi.hoisted(() => vi.fn())
vi.mock("vscode", () => ({ window: { showInformationMessage: notification } }))
vi.mock("../../config", () => ({ connectedRoots: vi.fn() }))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("../lm-tools/shared", () => ({ getOptimalObjectURI: vi.fn() }))
vi.mock("./dependencyWorker", () => ({
  DependencyGraphWorker: class {
    async evaluate(state: UsageAnalysis & { previousUsed?: string[] }, signal: AbortSignal) {
      if (signal.aborted) throw new Error("Analysis paused")
      return usedInventoryKeys(state.inventory, state.observations, state.edges, state.previousUsed)
    }
    async dispose() {}
  }
}))
import { UsageEngine } from "./engine"
import { UsageStore } from "./store"
import { RepositoryUsagePanel } from "./panel"
import { analyse, usedInventoryKeys } from "./analysis"
import { applyOptions } from "./options"
import type { UsageSap } from "./sap"
import type { UsageAnalysis } from "./types"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  )
})
const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-engine-"))
  roots.push(root)
  const store = new UsageStore(root)
  const state = await store.create("Example")
  const sap = {
    packages: vi.fn().mockResolvedValue(["ZPACKAGE"]),
    inventory: vi.fn().mockResolvedValue([]),
    functionModules: vi.fn().mockResolvedValue([]),
    mappings: vi.fn().mockResolvedValue({ transactions: [], functions: [] }),
    findEntries: vi.fn().mockResolvedValue([]),
    jobs: vi.fn(),
    probe: vi.fn().mockResolvedValue(false),
    dependencies: vi.fn().mockResolvedValue({ edges: [], errors: [] })
  }
  const engine = new UsageEngine(store, sap as unknown as UsageSap)
  await store.update(state.id, current => {
    current.connectionId = "example"
    current.dependencyConnectionId = "example"
    current.packages = ["ZPACKAGE"]
    current.stages = { discovery: { status: "complete", elapsedMs: 0 } }
    current.inventory = ["D", "C", "B", "A"].map(name => ({
      pgmid: "R3TR",
      objectType: "PROG",
      objectName: name,
      packageName: "ZPACKAGE"
    }))
  })
  return { store, engine, sap, id: state.id }
}
describe("repository usage engine", { timeout: 20_000 }, () => {
  it("shows an OK-only notice without starting dependencies when selective retry has no matches", async () => {
    const { engine, store, id } = await setup()
    await store.update(id, current => {
      current.checks = { "WUL:R3TR:PROG:B": { status: "complete", edgeCount: 1 } }
      current.edges = [{ caller: "R3TR:PROG:A", dependency: "R3TR:PROG:B", source: "Where-used" }]
    })
    const previous = await store.get(id)
    const dependencies = vi.spyOn(engine, "dependencies")
    const postMessage = vi.fn().mockResolvedValue(true)
    notification.mockClear()
    const panel = Object.create(RepositoryUsagePanel.prototype) as {
      handle(message: Record<string, unknown>): Promise<void>
    }
    Object.assign(panel, {
      runtime: { store, engine, ready: Promise.resolve() },
      selected: id,
      panel: { webview: { postMessage } },
      disposed: false
    })
    await panel.handle({
      command: "dependencies",
      analysisId: id,
      options: { retryFailedOrEmptyDependencies: true }
    })
    expect(notification).toHaveBeenCalledWith(
      "No failed or empty dependency results are available to retry.",
      { modal: true },
      "OK"
    )
    expect(dependencies).not.toHaveBeenCalled()
    const current = await store.get(id)
    expect(current.checks).toEqual(previous.checks)
    expect(current.edges).toEqual(previous.edges)
    expect(current.run).toEqual(previous.run)
    expect(postMessage).toHaveBeenCalledWith({ command: "idle", analysisId: id })
  })
  it("resumes a selective run without retrying completed targets or adding uncached targets", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.concurrency = 1
      current.relations = "unavailable"
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
      current.checks = {
        "WUL:R3TR:PROG:B": { status: "complete", edgeCount: 0 },
        "WUL:R3TR:PROG:C": { status: "complete", edgeCount: 0 }
      }
    })
    sap.dependencies.mockResolvedValue({ edges: [], errors: [] })
    let pause: Promise<void> | undefined
    engine.on("progress", (current: UsageAnalysis) => {
      if (!pause && current.run.completed === 1) pause = engine.pause(id)
    })
    await engine.dependencies(id, true)
    await pause
    const paused = await store.get(id)
    expect(paused.run.status).toBe("paused")
    expect(paused.dependencyCheckpoint!.retryKeys).toEqual(["WUL:R3TR:PROG:B", "WUL:R3TR:PROG:C"])
    await engine.dependencies(id)
    expect(sap.dependencies.mock.calls.map(([, key, direction]) => [key, direction])).toEqual([
      ["R3TR:PROG:B", "WUL"],
      ["R3TR:PROG:C", "WUL"]
    ])
    expect((await store.get(id)).run.status).toBe("complete")
  })
  it("selectively retries failed and empty checks while reassessing cached edges through all passes", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.relations = "available"
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
      current.checks = {
        "WUL:R3TR:PROG:B": { status: "complete", edgeCount: 0 },
        "WUL:R3TR:PROG:C": { status: "complete", edgeCount: 1 },
        "ENV:R3TR:PROG:A": { status: "error", error: "Old failure" }
      }
      current.edges = [{ caller: "R3TR:PROG:B", dependency: "R3TR:PROG:C", source: "Where-used" }]
    })
    sap.dependencies.mockImplementation(
      async (_connection: string, key: string, direction: string) => ({
        edges:
          direction === "WUL" && key === "R3TR:PROG:B"
            ? [{ caller: "R3TR:PROG:A", dependency: key, source: "Where-used" }]
            : [],
        errors: []
      })
    )
    await engine.dependencies(id, true)
    expect(sap.dependencies.mock.calls.map(([, key, direction]) => [key, direction])).toEqual([
      ["R3TR:PROG:B", "WUL"],
      ["R3TR:PROG:A", "ENV"]
    ])
    const current = await store.get(id)
    expect(current.checks["WUL:R3TR:PROG:C"]).toEqual({ status: "complete", edgeCount: 1 })
    expect(current.checks["WUL:R3TR:PROG:B"]).toEqual({ status: "complete", edgeCount: 1 })
    expect(current.checks["ENV:R3TR:PROG:A"]).toEqual({ status: "complete", edgeCount: 0 })
    expect(current.run.dependencyProgress!.history.map(pass => pass.newlyUsed)).toEqual([1, 1, 0])
    expect(
      analyse(current.inventory, current.observations, current.edges)
        .filter(row => row.status === "used")
        .map(row => row.objectName)
    ).toEqual(["C", "B", "A"])
    expect(sap.probe).not.toHaveBeenCalled()
  })
  it("does not repeatedly retry an empty or failed result in subsequent selective passes", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.relations = "unavailable"
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
      current.checks = {
        "WUL:R3TR:PROG:B": { status: "complete", edgeCount: 0 },
        "WUL:R3TR:PROG:C": { status: "error" },
        "WUL:R3TR:PROG:D": { status: "complete", edgeCount: 0 }
      }
    })
    sap.dependencies.mockImplementation(async (_connection: string, key: string) => ({
      edges:
        key === "R3TR:PROG:B"
          ? [{ caller: "R3TR:PROG:A", dependency: key, source: "Where-used" }]
          : [],
      errors: key === "R3TR:PROG:C" ? ["Still unavailable"] : []
    }))
    await engine.dependencies(id, true)
    expect(sap.dependencies).toHaveBeenCalledTimes(3)
    const current = await store.get(id)
    expect(current.run.status).toBe("partial")
    expect(current.run.dependencyProgress!.history.map(pass => pass.newlyUsed)).toEqual([1, 0])
    expect(current.checks["WUL:R3TR:PROG:D"].edgeCount).toBe(0)
  })
  it.each(["S", "P"] as const)(
    "uses undated uploaded status %s only when selected",
    async status => {
      const { engine, store, id } = await setup()
      await store.update(id, current => {
        current.includeReleasedJobs = status === "S"
        current.includeScheduledJobs = status === "P"
        current.inputs = [
          {
            id: "headers",
            kind: "tbtco",
            name: "headers.csv",
            importedAt: "",
            period: "",
            issues: [],
            rows: [
              { JOBNAME: "RELEASED", JOBCOUNT: "1", STATUS: "S", STRTDATE: "00000000" },
              { JOBNAME: "SCHEDULED", JOBCOUNT: "2", STATUS: "P", STRTDATE: "20260231" },
              { JOBNAME: "FINISHED", JOBCOUNT: "3", STATUS: "F", STRTDATE: "00000000" }
            ]
          },
          {
            id: "steps",
            kind: "tbtcp",
            name: "steps.csv",
            importedAt: "",
            period: "",
            issues: [],
            rows: [
              { JOBNAME: "RELEASED", JOBCOUNT: "1", PROGNAME: "A" },
              { JOBNAME: "SCHEDULED", JOBCOUNT: "2", PROGNAME: "B" },
              { JOBNAME: "FINISHED", JOBCOUNT: "3", PROGNAME: "C" }
            ]
          }
        ]
      })
      await engine.processJobs(id)
      const current = await store.get(id)
      expect(current.observations).toHaveLength(1)
      expect(current.observations[0].reason).toContain(`status ${status}`)
      expect(current.jobPrograms).toEqual([{ program: status === "S" ? "A" : "B" }])
      const used = analyse(current.inventory, current.observations, current.edges).filter(
        row => row.status === "used"
      )
      expect(used.map(row => row.objectName)).toEqual([status === "S" ? "A" : "B"])
      expect(used[0].lastObserved).toBeUndefined()
      expect(current.stageIssues?.jobs).toHaveLength(1)
      expect(current.stageIssues?.jobs?.[0]).toContain("Missing job start date for FINISHED")
    }
  )
  it("passes saved job status options to the connected collector", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.includeReleasedJobs = true
      current.includeScheduledJobs = true
    })
    sap.jobs.mockResolvedValue([{ program: "A", status: "S" }])
    await engine.processJobs(id, "example")
    expect(sap.jobs).toHaveBeenCalledWith(
      "example",
      "",
      "",
      expect.any(AbortSignal),
      expect.any(Function),
      expect.objectContaining({ includeReleasedJobs: true, includeScheduledJobs: true })
    )
    const current = await store.get(id)
    expect(current.observations[0].reason).toContain("released job")
    expect(current.observations[0].date).toBeUndefined()
  })
  it.each(["current", "legacy"] as const)(
    "keeps progress and failures across repeated pauses with %s checkpoints",
    async format => {
      const { engine, store, sap, id } = await setup()
      sap.jobs.mockResolvedValue([{ program: "A" }])
      await engine.processJobs(id, "example")
      await store.update(id, current => {
        current.concurrency = 1
      })
      sap.dependencies.mockImplementation(async (_connection: string, key: string) => ({
        edges: [],
        errors: key === "R3TR:PROG:C" ? [] : ["No authorization"]
      }))
      let pause: Promise<void> | undefined
      let stopAt = 1
      const resumedCounts: number[] = []
      engine.on("changed", (current: UsageAnalysis) => {
        if (current.run.status === "running" && current.run.resuming)
          resumedCounts.push(current.run.completed)
      })
      engine.on("progress", (current: UsageAnalysis) => {
        if (!pause && current.run.stage === "dependencies" && current.run.completed === stopAt)
          pause = engine.pause(id)
      })
      await engine.dependencies(id)
      await pause
      expect((await store.get(id)).run.completed).toBe(1)
      expect((await store.get(id)).run.dependencyProgress!.failed).toBe(1)
      if (format === "legacy")
        await store.update(id, current => {
          delete current.dependencyCheckpoint!.attempted
        })
      stopAt = 2
      pause = undefined
      await engine.dependencies(id)
      await pause
      expect((await store.get(id)).run.completed).toBe(2)
      expect((await store.get(id)).run.dependencyProgress!.failed).toBe(1)
      stopAt = Infinity
      pause = undefined
      await engine.dependencies(id)
      const current = await store.get(id)
      expect(sap.dependencies.mock.calls.map(([, key]) => key)).toEqual([
        "R3TR:PROG:D",
        "R3TR:PROG:C",
        "R3TR:PROG:B"
      ])
      expect(current.run.completed).toBe(3)
      expect(current.run.dependencyProgress!.failed).toBe(2)
      expect(current.run.status).toBe("partial")
      expect(resumedCounts).toEqual([1, 2])
      sap.dependencies.mockResolvedValue({ edges: [], errors: [] })
      await engine.dependencies(id)
      expect(sap.dependencies).toHaveBeenCalledTimes(5)
      expect((await store.get(id)).run.status).toBe("complete")
    }
  )
  it("keeps ST03N prefix checkpoints separate when Jobs resolves mappings", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.completedTransactionPrefixes = ["Z"]
    })
    sap.jobs.mockResolvedValue([{ program: "A" }])
    sap.mappings.mockResolvedValue({
      transactions: [],
      functions: [],
      completedTransactionPrefixes: ["A"],
      completedFunctionMappings: []
    })
    await engine.processJobs(id, "example")
    const current = await store.get(id)
    expect(current.completedTransactionPrefixes).toEqual(["Z"])
    expect(current.jobsCheckpoint!.completedTransactionPrefixes).toEqual(["A"])
  })
  it("resumes the frozen dependency pass after all checks finish but before reassessment", async () => {
    const { engine, store, sap, id } = await setup()
    sap.jobs.mockResolvedValue([{ program: "A" }])
    await engine.processJobs(id, "example")
    await store.update(id, current => {
      current.concurrency = 1
    })
    const callers: Record<string, string> = {
      "R3TR:PROG:D": "C",
      "R3TR:PROG:C": "B",
      "R3TR:PROG:B": "A"
    }
    sap.dependencies.mockImplementation(async (_connection: string, key: string) => ({
      edges: [{ caller: `R3TR:PROG:${callers[key]}`, dependency: key, source: "Where-used" }],
      errors: []
    }))
    let pause: Promise<void> | undefined
    engine.on("progress", (current: UsageAnalysis) => {
      if (!pause && current.checks["WUL:R3TR:PROG:B"]?.status === "complete")
        pause = engine.pause(id)
    })
    await engine.dependencies(id)
    await pause
    const paused = await store.get(id)
    expect(paused.run.status).toBe("paused")
    expect(paused.dependencyCheckpoint).toMatchObject({
      pass: 1,
      used: ["R3TR:PROG:A"],
      history: []
    })
    await engine.dependencies(id)
    expect(sap.dependencies).toHaveBeenCalledTimes(3)
    expect(
      (await store.get(id)).run.dependencyProgress!.history.map(summary => summary.newlyUsed)
    ).toEqual([1, 1, 1, 0])
    expect((await store.get(id)).run.status).toBe("complete")
  })
  it("resumes Jobs after collection without querying the job summary again", async () => {
    const { engine, store, sap, id } = await setup()
    sap.jobs.mockResolvedValue([{ program: "A", date: "2026-01-03" }])
    let pause: Promise<void> | undefined
    engine.on("progress", (current: UsageAnalysis) => {
      if (!pause && current.run.activity === "Matching job programs and transactions")
        pause = engine.pause(id)
    })
    await engine.processJobs(id, "example")
    await pause
    expect((await store.get(id)).run.status).toBe("paused")
    expect((await store.get(id)).jobsCheckpoint!.collected).toBe(true)
    await engine.processJobs(id, "example")
    expect(sap.jobs).toHaveBeenCalledTimes(1)
    expect((await store.get(id)).run.status).toBe("complete")
  })
  it.each(["paused", "interrupted"] as const)(
    "resumes %s ST03N without repeating completed mappings or files",
    async status => {
      const { engine, store, sap, id } = await setup()
      await store.update(id, current => {
        current.inputs = ["A", "B"].map(name => ({
          id: name,
          kind: "transaction",
          name: `${name}.csv`,
          rows: [{ OBJECTNAME: name }],
          importedAt: "",
          period: "",
          issues: []
        }))
      })
      let pause: Promise<void> | undefined
      const firstFileStarts: number[] = []
      engine.on("progress", (current: UsageAnalysis) => {
        if (
          current.run.activity === "Matching ST03N extract: A.csv" &&
          !current.inputs[0].processed
        )
          firstFileStarts.push(current.revision)
        if (!pause && current.inputs[0].processed) pause = engine.pause(id)
      })
      await engine.processSt03n(id)
      await pause
      expect((await store.get(id)).run.status).toBe("paused")
      expect((await store.get(id)).inputs[0].processed).toBe(true)
      expect((await store.get(id)).inputs[1].processed).not.toBe(true)
      if (status === "interrupted")
        await store.update(id, current => {
          current.run.status = "interrupted"
          current.stages!.st03n = { status: "complete", elapsedMs: 1000 }
        })
      await engine.processSt03n(id)
      expect(sap.mappings).toHaveBeenCalledTimes(1)
      expect(firstFileStarts).toHaveLength(1)
      const current = await store.get(id)
      expect(current.run.status).toBe("complete")
      expect(current.inputs.every(input => input.processed)).toBe(true)
      expect(current.observations).toHaveLength(2)
      expect(current.run.completed).toBe(2)
    }
  )
  it("ignores out-of-scope transaction-profile names without ADT object searches", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.inputs = [
        {
          id: "transactions",
          kind: "transaction",
          name: "transactions.xlsx",
          importedAt: "",
          period: "",
          issues: [],
          rows: ["A", "STANDARD_REPORT", "SE38", "*"].map(name => ({ OBJECTNAME: name }))
        }
      ]
    })
    sap.mappings.mockResolvedValue({
      transactions: [{ transaction: "STANDARD_ALIAS", program: "A" }],
      functions: []
    })
    await engine.processSt03n(id)
    const current = await store.get(id)
    expect(sap.findEntries).not.toHaveBeenCalled()
    expect(current.observations).toHaveLength(1)
    expect(current.observations[0].keys).toContain("R3TR:PROG:A")
    expect(current.inputs[0].issues).toEqual([])
  })
  it("matches scoped RFC functions and ignores unrelated standard and wildcard rows", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.inventory = [
        { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" },
        {
          pgmid: "LIMU",
          objectType: "FUNC",
          objectName: "Z_FIRST",
          packageName: "ZPACKAGE",
          functionGroup: "ZGROUP"
        }
      ]
      current.inputs = [
        {
          id: "rfc",
          kind: "rfc-server",
          name: "rfc.csv",
          period: "",
          importedAt: "",
          issues: [],
          rows: ["Z_FIRST", "/SSF/OUTSIDE", "STANDARD_FM", "*"].map(name => ({ OBJECTNAME: name }))
        }
      ]
    })
    sap.mappings.mockResolvedValue({
      transactions: [],
      functions: [{ name: "Z_FIRST", group: "ZGROUP" }]
    })
    await engine.processSt03n(id)
    const current = await store.get(id)
    expect(current.observations).toHaveLength(1)
    expect(current.observations[0].seeds).toEqual(["LIMU:FUNC:Z_FIRST"])
    expect(current.inputs[0].issues).toEqual([])
    expect(current.run.status).toBe("complete")
    expect(
      analyse(current.inventory, current.observations, current.edges).map(row => row.status)
    ).toEqual(["used", "used"])
  })
  it("reassesses reverse-order WUL results in later passes using cache without relations", async () => {
    const { engine, store, sap, id } = await setup()
    sap.jobs.mockResolvedValue([{ program: "A" }])
    await engine.processJobs(id, "example")
    await store.update(id, current => {
      current.concurrency = 1
    })
    const callerByObject: Record<string, string> = {
      "R3TR:PROG:D": "C",
      "R3TR:PROG:C": "B",
      "R3TR:PROG:B": "A"
    }
    sap.dependencies.mockImplementation(async (_connection: string, key: string) => ({
      edges: [
        { caller: `R3TR:PROG:${callerByObject[key]}`, dependency: key, source: "Where-used" }
      ],
      errors: []
    }))
    const completedPasses: { pass: number; cached: number; total: number }[] = []
    engine.on("progress", (current: UsageAnalysis) => {
      const progress = current.run.dependencyProgress
      if (progress?.history.at(-1)?.pass === progress?.pass)
        completedPasses.push({
          pass: progress!.pass,
          cached: progress!.cached,
          total: current.run.total!
        })
    })
    await engine.dependencies(id)
    expect(sap.dependencies.mock.calls.map(([, key, direction]) => [key, direction])).toEqual([
      ["R3TR:PROG:D", "WUL"],
      ["R3TR:PROG:C", "WUL"],
      ["R3TR:PROG:B", "WUL"]
    ])
    const current = await store.get(id)
    expect(current.run.dependencyProgress!.history.map(summary => summary.newlyUsed)).toEqual([
      1, 1, 1, 0
    ])
    expect(completedPasses).toEqual([
      { pass: 1, cached: 0, total: 3 },
      { pass: 2, cached: 2, total: 2 },
      { pass: 3, cached: 1, total: 1 },
      { pass: 4, cached: 0, total: 0 }
    ])
    expect(
      analyse(current.inventory, current.observations, current.edges).every(
        row => row.status === "used"
      )
    ).toBe(true)
  })
  it("finishes each inventory pass before following its newly Used frontier", async () => {
    const { engine, store, sap, id } = await setup()
    sap.probe.mockResolvedValue(true)
    sap.jobs.mockResolvedValue([{ program: "A" }])
    await engine.processJobs(id, "example")
    await store.update(id, current => {
      current.concurrency = 1
    })
    const calls: { pass: number; key: string; direction: string }[] = []
    sap.dependencies.mockImplementation(
      async (_connection: string, key: string, direction: string) => {
        calls.push({ pass: (await store.get(id)).run.dependencyProgress!.pass, key, direction })
        const next = { "R3TR:PROG:A": "B", "R3TR:PROG:B": "C", "R3TR:PROG:C": "D" }[key]
        return {
          edges:
            direction === "ENV" && next
              ? [{ caller: key, dependency: `R3TR:PROG:${next}`, source: "Object relations ENV" }]
              : [],
          errors: []
        }
      }
    )
    await engine.dependencies(id)
    expect(calls).toEqual([
      { pass: 1, key: "R3TR:PROG:D", direction: "WUL" },
      { pass: 1, key: "R3TR:PROG:C", direction: "WUL" },
      { pass: 1, key: "R3TR:PROG:B", direction: "WUL" },
      { pass: 1, key: "R3TR:PROG:A", direction: "ENV" },
      { pass: 2, key: "R3TR:PROG:B", direction: "ENV" },
      { pass: 3, key: "R3TR:PROG:C", direction: "ENV" },
      { pass: 4, key: "R3TR:PROG:D", direction: "ENV" }
    ])
    expect(
      (await store.get(id)).run.dependencyProgress!.history.map(summary => summary.newlyUsed)
    ).toEqual([1, 1, 1, 0])
  })
  it("does not query or traverse outside objects returned by inventory dependency checks", async () => {
    const { engine, store, sap, id } = await setup()
    sap.probe.mockResolvedValue(true)
    sap.jobs.mockResolvedValue([{ program: "A" }])
    await engine.processJobs(id, "example")
    await store.update(id, current => {
      current.edges.push({
        caller: "R3TR:PROG:STANDARD",
        dependency: "R3TR:PROG:B",
        source: "Object relations ENV"
      })
    })
    sap.dependencies.mockImplementation(
      async (_connection: string, key: string, direction: string) => ({
        edges:
          key === "R3TR:PROG:A" && direction === "ENV"
            ? [{ caller: key, dependency: "R3TR:PROG:STANDARD", source: "Object relations ENV" }]
            : [],
        errors: []
      })
    )
    await engine.dependencies(id)
    expect(sap.dependencies.mock.calls.every(([, key]) => key !== "R3TR:PROG:STANDARD")).toBe(true)
    const current = await store.get(id)
    expect(
      analyse(current.inventory, current.observations, current.edges).find(
        row => row.objectName === "B"
      )!.status
    ).toBe("unclear")
  })
  it("reuses dependency checks after usage changes and queries only newly needed checks", async () => {
    const { engine, store, sap, id } = await setup()
    sap.probe.mockResolvedValue(true)
    sap.jobs.mockResolvedValue([{ program: "A" }])
    sap.dependencies.mockImplementation(
      async (_connection: string, key: string, direction: string) => ({
        edges:
          direction === "ENV" && ["R3TR:PROG:A", "R3TR:PROG:D"].includes(key)
            ? [
                {
                  caller: key,
                  dependency: key === "R3TR:PROG:A" ? "R3TR:PROG:B" : "R3TR:PROG:C",
                  source: "Object relations ENV"
                }
              ]
            : [],
        errors: []
      })
    )
    await engine.processJobs(id, "example")
    await engine.dependencies(id)
    const previous = await store.get(id)
    const completed = new Set(Object.keys(previous.checks))
    const callCount = sap.dependencies.mock.calls.length
    await engine.reset(id, "jobs")
    expect((await store.get(id)).checks).toEqual(previous.checks)
    sap.jobs.mockResolvedValue([{ program: "D" }])
    await engine.processJobs(id, "example")
    const reassessed = await store.get(id)
    expect(
      analyse(reassessed.inventory, reassessed.observations, reassessed.edges).map(row => [
        row.objectName,
        row.status
      ])
    ).toEqual([
      ["D", "used"],
      ["C", "unclear"],
      ["B", "unclear"],
      ["A", "unclear"]
    ])
    await engine.dependencies(id)
    const freshCalls = sap.dependencies.mock.calls.slice(callCount)
    expect(freshCalls.length).toBeGreaterThan(0)
    for (const [, key, direction] of freshCalls)
      expect(completed.has(`${direction}:${key}`)).toBe(false)
    const current = await store.get(id)
    expect(
      analyse(current.inventory, current.observations, current.edges).map(row => [
        row.objectName,
        row.status
      ])
    ).toEqual([
      ["D", "used"],
      ["C", "used"],
      ["B", "unclear"],
      ["A", "unclear"]
    ])
    expect(sap.probe).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])(
    "reassesses expanded ST03N evidence without repeating cached lookups (relations: %s)",
    async relations => {
      const { engine, store, sap, id } = await setup()
      sap.probe.mockResolvedValue(relations)
      sap.dependencies.mockImplementation(
        async (_connection: string, key: string, direction: string) => {
          const caller = ({ "R3TR:PROG:D": "C", "R3TR:PROG:C": "B" } as Record<string, string>)[key]
          return {
            edges:
              direction === "WUL" && caller
                ? [{ caller: `R3TR:PROG:${caller}`, dependency: key, source: "Where-used" }]
                : [],
            errors: []
          }
        }
      )
      await store.update(id, current => {
        current.inputs = [
          {
            id: "first",
            kind: "transaction",
            name: "first.csv",
            importedAt: "",
            period: "",
            issues: [],
            rows: [{ OBJECTNAME: "A" }]
          }
        ]
      })
      await engine.processSt03n(id)
      await engine.dependencies(id)
      const previous = await store.get(id)
      expect(previous.run.status).toBe("complete")
      expect(
        analyse(previous.inventory, previous.observations, previous.edges)
          .filter(row => row.status === "used")
          .map(row => row.objectName)
      ).toEqual(["A"])
      const completed = new Set(Object.keys(previous.checks))
      const callCount = sap.dependencies.mock.calls.length
      await engine.reset(id, "st03n")
      const reset = await store.get(id)
      expect(reset.checks).toEqual(previous.checks)
      expect(reset.edges).toEqual(previous.edges)
      expect(reset.relations).toBe(previous.relations)
      expect(reset.dependencyCheckpoint).toBeUndefined()
      await store.update(id, current => {
        current.inputs.push({
          id: "additional",
          kind: "transaction",
          name: "additional.csv",
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ OBJECTNAME: "B" }]
        })
      })
      await engine.processSt03n(id)
      await engine.dependencies(id)
      const freshCalls = sap.dependencies.mock.calls.slice(callCount)
      expect(freshCalls.map(([, key, direction]) => [key, direction])).toEqual(
        relations
          ? [
              ["R3TR:PROG:D", "ENV"],
              ["R3TR:PROG:C", "ENV"],
              ["R3TR:PROG:B", "ENV"]
            ]
          : []
      )
      for (const [, key, direction] of freshCalls)
        expect(completed.has(`${direction}:${key}`)).toBe(false)
      const current = await store.get(id)
      expect(current.run.status).toBe("complete")
      expect(current.run.dependencyProgress!.history[0].pass).toBe(1)
      expect(current.run.dependencyProgress!.used).toBe(4)
      expect(current.inputs.every(input => input.processed)).toBe(true)
      expect(
        analyse(current.inventory, current.observations, current.edges).every(
          row => row.status === "used"
        )
      ).toBe(true)
      expect(sap.probe).toHaveBeenCalledTimes(1)
      const finalCallCount = sap.dependencies.mock.calls.length
      await engine.dependencies(id)
      expect(sap.dependencies).toHaveBeenCalledTimes(finalCallCount)
    }
  )
  it("refreshes table rows when changing the dependency system invalidates results", async () => {
    const { engine, store, id } = await setup()
    await store.update(id, current => {
      current.edges = [{ caller: "R3TR:PROG:A", dependency: "R3TR:PROG:B", source: "Where-used" }]
      current.relations = "available"
      current.checks = { "WUL:R3TR:PROG:B": { status: "complete" } }
    })
    const rowUpdates = vi.fn()
    const metadataUpdates = vi.fn()
    engine.on("rows", rowUpdates).on("changed", metadataUpdates)
    await engine.edit(id, current => applyOptions(current, { dependencyConnectionId: "other" }))
    expect(rowUpdates).toHaveBeenCalledTimes(1)
    expect(rowUpdates.mock.calls[0][0].edges).toEqual([])
    expect(rowUpdates.mock.calls[0][0].checks).toEqual({})
    expect(metadataUpdates).not.toHaveBeenCalled()
    await engine.edit(id, current => applyOptions(current, { periodLabel: "New period" }))
    expect(metadataUpdates).toHaveBeenCalledTimes(1)
    expect(rowUpdates).toHaveBeenCalledTimes(1)
  })
  it("publishes discovery rows only after all package and function-module progress", async () => {
    const { engine, store, sap, id } = await setup()
    sap.packages.mockResolvedValue(["ZPACKAGE", "ZOTHER"])
    sap.inventory
      .mockResolvedValueOnce([
        { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
      ])
      .mockResolvedValueOnce([
        { pgmid: "R3TR", objectType: "PROG", objectName: "ZREPORT", packageName: "ZOTHER" }
      ])
    sap.functionModules.mockResolvedValue([
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_FIRST",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      }
    ])
    const rowUpdates = vi.fn()
    const progress = vi.fn((_state: UsageAnalysis) => expect(rowUpdates).not.toHaveBeenCalled())
    engine.on("rows", rowUpdates).on("progress", progress)

    await engine.discover(id, true)

    expect(progress).toHaveBeenCalledTimes(6)
    expect(progress.mock.calls.map(([state]) => state.run.unit)).toEqual([
      "packages",
      "packages",
      "packages",
      "prefix batches",
      "prefix batches",
      "prefix batches"
    ])
    expect(rowUpdates).toHaveBeenCalledTimes(1)
    expect(rowUpdates.mock.calls[0][0]).toEqual(await store.get(id))
    expect(rowUpdates.mock.calls[0][0].run.status).toBe("complete")
    expect(rowUpdates.mock.calls[0][0].inventory).toHaveLength(3)
    expect(rowUpdates.mock.calls[0][0].run).toMatchObject({
      completed: 1,
      total: 1,
      activity: "Reading function modules: Z* (1 function group)",
      unit: "prefix batches"
    })
  })
  it("batches function groups by distinct first characters and checkpoints each batch", async () => {
    const { engine, store, sap, id } = await setup()
    const groups = ["ZFIRST", "ZSECOND", "YFIRST", "/DEMO/FIRST", "/OTHER/SECOND"].map(name => ({
      pgmid: "R3TR",
      objectType: "FUGR",
      objectName: name,
      packageName: "ZPACKAGE"
    }))
    sap.inventory.mockResolvedValue(groups)
    await engine.discover(id, true)
    expect(
      sap.functionModules.mock.calls.map(call =>
        call[1].map((group: { objectName: string }) => group.objectName)
      )
    ).toEqual([["ZFIRST", "ZSECOND"], ["YFIRST"], ["/DEMO/FIRST", "/OTHER/SECOND"]])
    const state = await store.get(id)
    expect(state.completedFunctionGroups).toEqual(
      groups.map(group => `R3TR:FUGR:${group.objectName}`)
    )
    expect(state.run).toMatchObject({ completed: 3, total: 3, unit: "prefix batches" })
    await engine.discover(id)
    expect(sap.functionModules).toHaveBeenCalledTimes(3)
  })
  it("resumes an incomplete prefix using only its unfinished groups", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.inventory = ["ZFIRST", "ZSECOND"].map(name => ({
        pgmid: "R3TR",
        objectType: "FUGR",
        objectName: name,
        packageName: "ZPACKAGE"
      }))
      current.completedPackages = ["ZPACKAGE"]
      current.completedFunctionGroups = ["R3TR:FUGR:ZFIRST"]
    })
    await engine.discover(id)
    expect(sap.inventory).not.toHaveBeenCalled()
    expect(sap.functionModules).toHaveBeenCalledTimes(1)
    expect(
      sap.functionModules.mock.calls[0][1].map((group: { objectName: string }) => group.objectName)
    ).toEqual(["ZSECOND"])
    expect((await store.get(id)).completedFunctionGroups).toEqual([
      "R3TR:FUGR:ZFIRST",
      "R3TR:FUGR:ZSECOND"
    ])
  })
  it.each(["st03n", "jobs", "dependencies"] as const)(
    "%s publishes table rows only when the stage settles",
    async stage => {
      const { engine, store, sap, id } = await setup()
      await store.update(id, current => {
        current.stages!.st03n = { status: "complete", elapsedMs: 0 }
        current.observations = [
          {
            id: "seed",
            source: "transaction",
            keys: ["R3TR:PROG:C"],
            seeds: ["R3TR:PROG:C"],
            reason: "ST03N"
          }
        ]
        current.inputs = ["A", "B"].map(name => ({
          id: name,
          kind: "transaction",
          name: `${name}.csv`,
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ OBJECTNAME: name }]
        }))
      })
      sap.jobs.mockResolvedValue([{ program: "A", date: "2026-01-03" }])
      const rowUpdates = vi.fn()
      const progress = vi.fn(state => {
        expect(rowUpdates).not.toHaveBeenCalled()
        expect(state.run.activity).toEqual(expect.any(String))
      })
      engine.on("rows", rowUpdates).on("progress", progress)

      if (stage === "st03n") await engine.processSt03n(id)
      else if (stage === "jobs") await engine.processJobs(id, "example")
      else await engine.dependencies(id)

      expect(progress).toHaveBeenCalled()
      expect(rowUpdates).toHaveBeenCalledTimes(1)
      expect(rowUpdates.mock.calls[0][0]).toEqual(await store.get(id))
      expect(rowUpdates.mock.calls[0][0].run.status).toBe("complete")
    }
  )
  it("adds FMs to discovery with their function group and saves owner relationships", async () => {
    const { engine, store, sap, id } = await setup()
    sap.inventory.mockResolvedValue([
      { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
    ])
    sap.functionModules.mockResolvedValue([
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_FIRST",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      },
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_SECOND",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      }
    ])
    await engine.discover(id, true)
    const state = await store.get(id)
    expect(state.inventory.map(row => row.objectType)).toEqual(["FUGR", "FUNC", "FUNC"])
    expect(state.functions).toEqual([
      { name: "Z_FIRST", group: "ZGROUP" },
      { name: "Z_SECOND", group: "ZGROUP" }
    ])
    expect(state.edges).toContainEqual({
      caller: "LIMU:FUNC:Z_FIRST",
      dependency: "R3TR:FUGR:ZGROUP",
      source: "Owner mapping"
    })
    expect(state.run.completed).toBe(state.run.total)
  })
  it("keeps discovered FMs when resuming without querying completed groups again", async () => {
    const { engine, store, sap, id } = await setup()
    sap.inventory.mockResolvedValue([
      { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
    ])
    sap.functionModules.mockResolvedValue([
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_FIRST",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      }
    ])
    await engine.discover(id, true)
    await engine.discover(id)
    expect(sap.packages).toHaveBeenCalledTimes(1)
    expect(sap.functionModules).toHaveBeenCalledTimes(1)
    expect((await store.get(id)).inventory.filter(row => row.objectType === "FUNC")).toHaveLength(1)
  })
  it("reuses completed package discovery checkpoints", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.completedPackages = ["ZPACKAGE"]
    })
    await engine.discover(id)
    expect(sap.inventory).not.toHaveBeenCalled()
    expect((await store.get(id)).run.status).toBe("complete")
  })
  it("retries a failed FM lookup without re-reading its completed package", async () => {
    const { engine, store, sap, id } = await setup()
    sap.inventory.mockResolvedValue([
      { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
    ])
    sap.functionModules.mockRejectedValueOnce(new Error("No table access")).mockResolvedValueOnce([
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_FIRST",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      }
    ])
    await expect(engine.discover(id, true)).rejects.toThrow("No table access")
    expect((await store.get(id)).completedFunctionGroups).toEqual([])
    await engine.discover(id)
    expect(sap.inventory).toHaveBeenCalledTimes(1)
    expect(sap.functionModules).toHaveBeenCalledTimes(2)
    expect((await store.get(id)).inventory.filter(row => row.objectType === "FUNC")).toHaveLength(1)
  })
  it("checks relations once and converges despite reverse object order", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.concurrency = 1
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          seeds: ["R3TR:PROG:A"],
          keys: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
    })
    sap.dependencies.mockImplementation(async (_connection, key) => {
      const caller = (
        { "R3TR:PROG:D": "C", "R3TR:PROG:C": "B", "R3TR:PROG:B": "A" } as Record<string, string>
      )[key]
      return {
        edges: caller
          ? [{ caller: `R3TR:PROG:${caller}`, dependency: key, source: "Where-used" }]
          : [],
        errors: []
      }
    })
    await engine.dependencies(id)
    await engine.dependencies(id)
    const state = await store.get(id)
    expect(sap.probe).toHaveBeenCalledTimes(1)
    expect(sap.dependencies).toHaveBeenCalledTimes(3)
    expect(
      analyse(state.inventory, state.observations, state.edges).every(row => row.status === "used")
    ).toBe(true)
  })
  it("keeps independent ST03N reasons when failed jobs add usage", async () => {
    const { engine, store, id } = await setup()
    await store.update(id, current => {
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          seeds: ["R3TR:PROG:A"],
          keys: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
      current.inputs = [
        {
          id: "headers",
          kind: "tbtco",
          name: "headers.xlsx",
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ JOBNAME: "JOB", JOBCOUNT: "1", STATUS: "A", STRTDATE: "20260103" }]
        },
        {
          id: "steps",
          kind: "tbtcp",
          name: "steps.xlsx",
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "A" }]
        }
      ]
    })
    await engine.processJobs(id)
    const state = await store.get(id)
    expect(state.observations).toHaveLength(2)
    expect(state.observations.map(item => item.source).sort()).toEqual(["jobs", "transaction"])
    expect(
      analyse(state.inventory, state.observations, state.edges).find(row => row.objectName === "A")
        ?.lastObserved
    ).toBe("2026-01-03")
  })
  it("keeps job diagnostics after a later ST03N run", async () => {
    const { engine, store, id } = await setup()
    await store.update(id, current => {
      current.inputs = [
        {
          id: "headers",
          kind: "tbtco",
          name: "headers.xlsx",
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: "20260103" }]
        },
        {
          id: "steps",
          kind: "tbtcp",
          name: "steps.xlsx",
          importedAt: "",
          period: "",
          issues: [],
          rows: [
            { JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "A" },
            { JOBNAME: "OTHER", JOBCOUNT: "1", PROGNAME: "B" }
          ]
        },
        {
          id: "st03n",
          kind: "transaction",
          name: "transactions.csv",
          importedAt: "",
          period: "",
          issues: [],
          rows: [{ OBJECTNAME: "A" }]
        }
      ]
    })
    await engine.processJobs(id)
    await engine.processSt03n(id)
    const updated = await store.get(id)
    expect(updated.stageIssues?.jobs).toContain("No TBTCO header for OTHER:00000001")
    expect(updated.issues).toContain("No TBTCO header for OTHER:00000001")
    expect(updated.observations.map(item => item.source).sort()).toEqual(["jobs", "transaction"])
    expect(updated.stages?.st03n?.status).toBe("complete")
  })
  it("waits for in-flight work before pausing and releasing its lock", async () => {
    const { engine, store, sap, id } = await setup()
    let release = () => {}
    let started = () => {}
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    sap.inventory.mockImplementation(async () => {
      started()
      await new Promise<void>(resolve => {
        release = resolve
      })
      return []
    })
    const run = engine.discover(id)
    await entered
    const pause = engine.pause(id)
    await expect(new UsageStore(store.root).lock(id)).rejects.toThrow(/running/)
    release()
    await pause
    await run
    expect((await store.get(id)).run.status).toBe("paused")
    await store.lock(id)
    await store.unlock(id)
  })
  it("does not start another dependency batch after pause and holds the lock until both requests settle", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.concurrency = 2
      current.relations = "unavailable"
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
    })
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    sap.dependencies.mockImplementation(async () => {
      if (sap.dependencies.mock.calls.length === 2) started()
      await gate
      return []
    })
    const run = engine.dependencies(id)
    await entered
    let settled = false
    const pause = engine.pause(id).then(() => {
      settled = true
    })
    await expect(new UsageStore(store.root).lock(id)).rejects.toThrow(/running/)
    expect(settled).toBe(false)
    release()
    await Promise.all([run, pause])
    expect(sap.dependencies).toHaveBeenCalledTimes(2)
    const state = await store.get(id)
    expect(state.run.status).toBe("paused")
    expect(state.checks).toEqual({})
    await store.lock(id)
    await store.unlock(id)
  })
  it("passes cancellation to the capability probe and starts no object checks after it is paused", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
    })
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    let signal: AbortSignal | undefined
    sap.probe.mockImplementation(async (_connection, _key, suppliedSignal) => {
      signal = suppliedSignal
      started()
      await gate
      return true
    })
    const run = engine.dependencies(id)
    await entered
    const pause = engine.pause(id)
    expect(signal?.aborted).toBe(true)
    release()
    await Promise.all([run, pause])
    expect(sap.dependencies).not.toHaveBeenCalled()
    expect((await store.get(id)).relations).toBeUndefined()
  })
  it("keeps failed checks retryable and does not downgrade them to empty results", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.stages!.st03n = { status: "complete", elapsedMs: 0 }
      current.observations = [
        {
          id: "seed",
          source: "transaction",
          keys: ["R3TR:PROG:A"],
          seeds: ["R3TR:PROG:A"],
          reason: "ST03N"
        }
      ]
    })
    sap.dependencies.mockRejectedValue(new Error("No authorization"))
    await engine.dependencies(id)
    expect((await store.get(id)).run.status).toBe("partial")
    sap.dependencies.mockResolvedValue({ edges: [], errors: [] })
    await engine.dependencies(id)
    expect((await store.get(id)).run.status).toBe("complete")
  })
  it("supports discovery uploads without making SAP calls", async () => {
    const { engine, store, sap, id } = await setup()
    await store.update(id, current => {
      current.connectionId = ""
      current.discoveryMode = "upload"
      current.inputs = [
        {
          id: "objects",
          kind: "tadir",
          name: "objects.xlsx",
          rows: [{ PGMID: "R3TR", OBJECT: "FUGR", OBJNAME: "ZGROUP", DEVCLASS: "ZPACKAGE" }],
          period: "",
          importedAt: "",
          issues: []
        },
        {
          id: "functions",
          kind: "enlfdir",
          name: "functions.xlsx",
          rows: [{ AREA: "ZGROUP", FUNCNAME: "Z_FIRST" }],
          period: "",
          importedAt: "",
          issues: []
        }
      ]
    })
    await engine.discover(id, true)
    expect(sap.packages).not.toHaveBeenCalled()
    expect((await store.get(id)).inventory.map(row => row.objectType)).toEqual(["FUGR", "FUNC"])
  })
  it("refuses dependencies before usage is processed", async () => {
    const { engine, sap, id } = await setup()
    await expect(engine.dependencies(id)).rejects.toThrow(/Process ST03N or Jobs first/)
    expect(sap.probe).not.toHaveBeenCalled()
  })
})
