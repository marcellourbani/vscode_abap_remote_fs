import { describe, expect, it } from "vitest"
import {
  applyOptions,
  canRunDependencies,
  dependencyRetryKeys,
  resetStage,
  usageConfirmation
} from "./options"
import { reconcileSt03nIssues } from "./options"
import { analyse } from "./analysis"
import type { UsageAnalysis } from "./types"

const state = (): UsageAnalysis => ({
  schemaVersion: 1,
  id: "example",
  name: "Example",
  createdAt: "",
  updatedAt: "",
  revision: 1,
  connectionId: "",
  packages: [],
  includeSubpackages: true,
  discoveryMode: "connected",
  jobMode: "upload",
  jobConnection: "",
  periodLabel: "",
  inventory: [],
  inputs: [],
  observations: [],
  transactions: [],
  functions: [],
  jobPrograms: [],
  edges: [],
  checks: {},
  completedPackages: [],
  completedFunctionGroups: [],
  dependencyConnectionId: "",
  concurrency: 5,
  jobsFrom: "",
  jobsTo: "",
  issues: [],
  stages: {},
  run: { stage: "discovery", status: "idle", completed: 0, elapsedMs: 0 }
})
describe("isolated analysis options and stages", () => {
  it.each([false, true])(
    "reconciles old transaction errors without hiding ambiguity (ambiguous: %s)",
    ambiguous => {
      const current = state()
      current.inventory = [
        { pgmid: "R3TR", objectType: "TRAN", objectName: "ZSTART", packageName: "ZPACKAGE" }
      ]
      if (ambiguous)
        current.inventory.push({
          pgmid: "R3TR",
          objectType: "CLAS",
          objectName: "ZSTART",
          packageName: "ZPACKAGE"
        })
      const reason =
        "ST03N transaction profile: ZSTART; No matching transaction or discovered program; file input.csv"
      current.inputs = [
        {
          id: "input",
          name: "input.csv",
          kind: "transaction",
          rows: [{ OBJECTNAME: "ZSTART" }],
          period: "",
          importedAt: "",
          processed: true,
          issues: [reason]
        }
      ]
      current.observations = [
        {
          id: "input:transaction:ZSTART",
          inputId: "input",
          source: "transaction",
          keys: [],
          seeds: [],
          reason
        }
      ]
      current.stageIssues = { st03n: [reason], jobs: ["Keep job issue"] }
      current.issues = [reason, "Keep job issue"]
      current.stages = { st03n: { status: "partial", elapsedMs: 100 } }
      reconcileSt03nIssues(current)
      expect(current.observations[0].seeds).toEqual(ambiguous ? [] : ["R3TR:TRAN:ZSTART"])
      expect(current.inputs[0].issues).toHaveLength(ambiguous ? 1 : 0)
      expect(current.stageIssues.st03n).toHaveLength(ambiguous ? 1 : 0)
      expect(current.issues).toContain("Keep job issue")
      expect(current.issues).not.toContain(reason)
      expect(current.stages.st03n?.status).toBe(ambiguous ? "partial" : "complete")
    }
  )
  it("does not reconcile saved input issues during an active run", () => {
    const current = state()
    current.run.status = "running"
    current.inputs = [
      {
        id: "input",
        name: "input.csv",
        kind: "transaction",
        rows: [],
        period: "",
        importedAt: "",
        processed: true,
        issues: ["Keep active issue"]
      }
    ]
    reconcileSt03nIssues(current)
    expect(current.inputs[0].issues).toEqual(["Keep active issue"])
  })
  it("selects failed and empty checks without selecting nonempty or out-of-scope results", () => {
    const current = state()
    current.inventory = ["EMPTY", "FAILED", "NONEMPTY"].map(objectName => ({
      pgmid: "R3TR",
      objectType: "PROG",
      objectName,
      packageName: "ZPACKAGE"
    }))
    current.checks = {
      "WUL:R3TR:PROG:EMPTY": { status: "complete", edgeCount: 0 },
      "ENV:R3TR:PROG:FAILED": { status: "error", error: "Lookup failed", edgeCount: 1 },
      "WUL:R3TR:PROG:NONEMPTY": { status: "complete", edgeCount: 2 },
      "WUL:R3TR:PROG:OUTSIDE": { status: "complete", edgeCount: 0 }
    }
    expect(dependencyRetryKeys(current)).toEqual(["WUL:R3TR:PROG:EMPTY", "ENV:R3TR:PROG:FAILED"])
  })
  it("infers legacy empty checks from lookup edges, not owner or transaction mappings", () => {
    const current = state()
    current.inventory = ["A", "B", "C"].map(objectName => ({
      pgmid: "R3TR",
      objectType: "PROG",
      objectName,
      packageName: "ZPACKAGE"
    }))
    current.checks = {
      "WUL:R3TR:PROG:A": { status: "complete" },
      "WUL:R3TR:PROG:B": { status: "complete" },
      "WUL:R3TR:PROG:C": { status: "complete" },
      "ENV:R3TR:PROG:A": { status: "complete" },
      "ENV:R3TR:PROG:B": { status: "complete" }
    }
    current.edges = [
      { caller: "R3TR:PROG:A", dependency: "R3TR:PROG:B", source: "Where-used" },
      { caller: "R3TR:PROG:A", dependency: "R3TR:PROG:C", source: "Object relations WUL" },
      { caller: "R3TR:PROG:A", dependency: "R3TR:PROG:C", source: "Object relations ENV" },
      { caller: "R3TR:TRAN:ZSTART", dependency: "R3TR:PROG:A", source: "Transaction mapping" }
    ]
    expect(dependencyRetryKeys(current)).toEqual(["WUL:R3TR:PROG:A", "ENV:R3TR:PROG:B"])
  })
  it.each(["includeReleasedJobs", "includeScheduledJobs"] as const)(
    "persists %s and resets only job evidence when it changes",
    field => {
      const current = state()
      current.stages = {
        jobs: { status: "complete", elapsedMs: 1 },
        st03n: { status: "complete", elapsedMs: 2 }
      }
      current.observations = [
        { id: "job", source: "jobs", keys: [], seeds: [], reason: "Job" },
        { id: "st03n", source: "transaction", keys: [], seeds: [], reason: "ST03N" }
      ]
      current.checks = { "WUL:R3TR:PROG:ZTEST": { status: "complete" } }
      current.jobsCheckpoint = {
        source: "old",
        collected: true,
        mappingsReady: true,
        completedTransactionPrefixes: []
      }
      expect(usageConfirmation(current, { command: "save", options: { [field]: true } })).toContain(
        "resets Jobs evidence"
      )
      applyOptions(current, { [field]: true })
      expect(current[field]).toBe(true)
      expect(current.observations.map(item => item.id)).toEqual(["st03n"])
      expect(current.jobsCheckpoint).toBeUndefined()
      expect(current.stages?.jobs).toBeUndefined()
      expect(current.stages?.st03n?.status).toBe("complete")
      expect(current.checks).toHaveProperty("WUL:R3TR:PROG:ZTEST")
      current.stages!.jobs = { status: "complete", elapsedMs: 3 }
      applyOptions(current, { [field]: true })
      expect(current.stages?.jobs?.status).toBe("complete")
      applyOptions(current, { [field]: false })
      expect(current[field]).toBe(false)
      expect(current.stages?.jobs).toBeUndefined()
    }
  )
  it("accepts up to 20 concurrent SAP checks and rejects invalid values", () => {
    const current = state()
    applyOptions(current, { concurrency: 20 })
    expect(current.concurrency).toBe(20)
    for (const concurrency of [0, 21, 1.5])
      expect(() => applyOptions(current, { concurrency })).toThrow("between 1 and 20")
  })
  it("does not confirm first-time processing or initial dependency selection", () => {
    const current = state()
    expect(usageConfirmation(current, { command: "st03n" })).toBeUndefined()
    expect(usageConfirmation(current, { command: "jobs" })).toBeUndefined()
    expect(
      usageConfirmation(current, {
        command: "save",
        options: { dependencyConnectionId: "example" }
      })
    ).toBeUndefined()
    expect(
      usageConfirmation(current, {
        command: "dependencies",
        options: { refreshDependencies: true }
      })
    ).toBeUndefined()
  })
  it("does not ask to replace evidence when resuming a paused ST03N attempt", () => {
    const current = state()
    current.run = { stage: "st03n", status: "paused", completed: 1, total: 2, elapsedMs: 1000 }
    current.observations = [
      {
        id: "file:A",
        source: "transaction",
        keys: ["R3TR:PROG:A"],
        seeds: ["R3TR:PROG:A"],
        reason: "ST03N"
      }
    ]
    expect(usageConfirmation(current, { command: "st03n" })).toBeUndefined()
    resetStage(current, "st03n")
    expect(current.completedTransactionPrefixes).toEqual([])
    expect(current.st03nMappingsReady).toBe(false)
  })
  it.each(["st03n", "jobs"] as const)("confirms replacing existing %s evidence", stage => {
    const current = state()
    current.stages = { [stage]: { status: "complete", elapsedMs: 1000 } }
    expect(usageConfirmation(current, { command: stage })).toContain("reassesses Used/Unclear")
    expect(usageConfirmation(current, { command: stage })).toContain(
      "dependency caches will be kept"
    )
  })
  it("confirms dependency-system changes and explicit cache refresh only when cached results exist", () => {
    const current = state()
    current.dependencyConnectionId = "example"
    current.checks = { "WUL:R3TR:PROG:ZTEST": { status: "complete" } }
    expect(
      usageConfirmation(current, {
        command: "save",
        options: { dependencyConnectionId: "example" }
      })
    ).toBeUndefined()
    expect(
      usageConfirmation(current, { command: "save", options: { dependencyConnectionId: "other" } })
    ).toContain("Changing the dependency system")
    expect(
      usageConfirmation(current, {
        command: "dependencies",
        options: { refreshDependencies: true }
      })
    ).toContain("reads them again from SAP")
    expect(
      usageConfirmation(current, {
        command: "dependencies",
        options: { refreshDependencies: false }
      })
    ).toBeUndefined()
    expect(current.dependencyConnectionId).toBe("example")
    expect(current.checks).toHaveProperty("WUL:R3TR:PROG:ZTEST")
  })
  it("explains that removing a processed extract resets its entire evidence stage", () => {
    const current = state()
    current.inputs = [
      {
        id: "file",
        name: "jobs.xlsx",
        kind: "tbtco",
        rows: [],
        importedAt: "",
        period: "",
        issues: [],
        processed: true
      }
    ]
    expect(usageConfirmation(current, { command: "removeInput", inputId: "file" })).toContain(
      "resets all Jobs evidence"
    )
    current.inputs[0].kind = "tadir"
    expect(usageConfirmation(current, { command: "removeInput", inputId: "file" })).toContain(
      "clears Discovery and all usage/dependency results"
    )
    current.inputs[0].processed = false
    expect(usageConfirmation(current, { command: "removeInput", inputId: "file" })).toBeUndefined()
  })
  it("saves individual fields without replacing unrelated options", () => {
    const first = state(),
      second = state()
    applyOptions(first, { connectionId: "EXAMPLE", packages: "z*, /demo/*" })
    applyOptions(first, { concurrency: 3 })
    expect(first.connectionId).toBe("example")
    expect(first.packages).toEqual(["Z*", "/DEMO/*"])
    expect(second.connectionId).toBe("")
    expect(second.packages).toEqual([])
  })
  it("invalidates an empty discovery's prepared package list when its scope changes", () => {
    const current = state()
    current.discoveryPackages = ["ZOLD"]
    current.completedPackages = ["ZOLD"]
    applyOptions(current, { packages: "ZNEW" })
    expect(current.discoveryPackages).toBeUndefined()
    expect(current.completedPackages).toEqual([])
  })
  it("requires resetting discovery before changing a completed inventory's scope", () => {
    const current = state()
    current.inventory = [
      { pgmid: "R3TR", objectType: "PROG", objectName: "ZTEST", packageName: "ZPACKAGE" }
    ]
    expect(() => applyOptions(current, { packages: "ZOTHER" })).toThrow(/reset discovery/i)
    expect(current.packages).toEqual([])
  })
  it("permits ST03N and jobs independently but gates dependencies on processed usage and a used seed", () => {
    const current = state()
    expect(canRunDependencies(current)).toBe(false)
    current.stages = { jobs: { status: "complete", elapsedMs: 0 } }
    expect(canRunDependencies(current)).toBe(false)
    current.observations = [
      {
        id: "job",
        source: "jobs",
        keys: ["R3TR:PROG:ZTEST"],
        seeds: ["R3TR:PROG:ZTEST"],
        reason: "Job"
      }
    ]
    expect(canRunDependencies(current)).toBe(true)
    current.stages = { st03n: { status: "partial", elapsedMs: 0 } }
    current.observations[0].source = "transaction"
    expect(canRunDependencies(current)).toBe(true)
  })
  it("resets only one usage stage and preserves the other stage's evidence", () => {
    const current = state()
    current.observations = [
      {
        id: "st03n",
        source: "transaction",
        keys: ["R3TR:PROG:A"],
        seeds: ["R3TR:PROG:A"],
        reason: "ST03N"
      },
      { id: "job", source: "jobs", keys: ["R3TR:PROG:B"], seeds: ["R3TR:PROG:B"], reason: "Job" }
    ]
    current.stages = {
      discovery: { status: "complete", elapsedMs: 1 },
      st03n: { status: "complete", elapsedMs: 2 },
      jobs: { status: "complete", elapsedMs: 3 },
      dependencies: { status: "complete", elapsedMs: 4 }
    }
    resetStage(current, "jobs")
    expect(current.observations.map(item => item.id)).toEqual(["st03n"])
    expect(current.stages?.st03n?.status).toBe("complete")
    expect(current.stages?.jobs).toBeUndefined()
    expect(current.stages?.dependencies).toBeUndefined()
  })
  it("resets discovery and all results without deleting uploaded files", () => {
    const current = state()
    current.inventory = [
      { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
    ]
    current.inputs = [
      {
        id: "file",
        name: "objects.xlsx",
        kind: "tadir",
        rows: [],
        importedAt: "",
        period: "",
        processed: true,
        issues: []
      }
    ]
    current.completedPackages = ["ZPACKAGE"]
    resetStage(current, "discovery")
    expect(current.inventory).toEqual([])
    expect(current.completedPackages).toEqual([])
    expect(current.inputs).toHaveLength(1)
    expect(current.inputs[0].processed).toBe(false)
  })
  it("retains dependency caches on usage reset but recalculates Used from remaining evidence", () => {
    const current = state()
    current.inventory = ["A", "B"].map(name => ({
      pgmid: "R3TR",
      objectType: "PROG",
      objectName: name,
      packageName: "ZPACKAGE"
    }))
    current.observations = [
      {
        id: "job",
        source: "jobs",
        keys: ["R3TR:PROG:A"],
        seeds: ["R3TR:PROG:A"],
        reason: "Job"
      }
    ]
    current.edges = [{ caller: "R3TR:PROG:A", dependency: "R3TR:PROG:B", source: "Where-used" }]
    current.checks = { "WUL:R3TR:PROG:B": { status: "complete" } }
    current.relations = "available"
    expect(
      analyse(current.inventory, current.observations, current.edges).map(row => row.status)
    ).toEqual(["used", "used"])
    resetStage(current, "jobs")
    expect(current.edges).toHaveLength(1)
    expect(current.checks["WUL:R3TR:PROG:B"].status).toBe("complete")
    expect(current.relations).toBe("available")
    expect(
      analyse(current.inventory, current.observations, current.edges).map(row => row.status)
    ).toEqual(["unclear", "unclear"])
    resetStage(current, "dependencies")
    expect(current.edges).toEqual([])
    expect(current.checks).toEqual({})
    expect(current.relations).toBeUndefined()
  })
  it("clears stale dependency diagnostics when resetting their upstream usage stage", () => {
    const current = state()
    current.stageIssues = { st03n: ["Keep this input issue"], dependencies: ["Old lookup failure"] }
    current.issues = ["Keep this input issue", "Old lookup failure"]
    resetStage(current, "jobs")
    expect(current.stageIssues.dependencies).toBeUndefined()
    expect(current.issues).toEqual(["Keep this input issue"])
  })
})
