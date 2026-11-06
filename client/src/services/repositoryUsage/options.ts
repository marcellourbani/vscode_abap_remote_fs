import type { Stage, UsageAnalysis } from "./types"
import { inventoryKey, resolveEntries } from "./analysis"

const jobStatusOptions = ["includeReleasedJobs", "includeScheduledJobs"] as const
const jobStatusesChanged = (state: UsageAnalysis, options: Record<string, unknown>) =>
  jobStatusOptions.some(
    field => field in options && (options[field] === true) !== (state[field] === true)
  )

const usageDone = (state: UsageAnalysis, stage: "st03n" | "jobs") =>
  ["complete", "partial"].includes(state.stages?.[stage]?.status || "")
export function canRunDependencies(state: UsageAnalysis) {
  return state.observations.some(
    item =>
      item.seeds.length &&
      (item.source === "jobs" ? usageDone(state, "jobs") : usageDone(state, "st03n"))
  )
}

export function dependencyRetryKeys(state: UsageAnalysis) {
  const inventory = new Set(state.inventory.map(inventoryKey))
  const nonempty = new Set<string>()
  for (const edge of state.edges) {
    if (["Where-used", "Object relations WUL"].includes(edge.source))
      nonempty.add(`WUL:${edge.dependency}`)
    if (edge.source === "Object relations ENV") nonempty.add(`ENV:${edge.caller}`)
  }
  return Object.entries(state.checks)
    .filter(
      ([key, check]) =>
        /^(WUL|ENV):/.test(key) &&
        inventory.has(key.slice(4)) &&
        (check.status === "error" ||
          (check.edgeCount !== undefined ? check.edgeCount === 0 : !nonempty.has(key)))
    )
    .map(([key]) => key)
}

export function reconcileSt03nIssues(state: UsageAnalysis) {
  if (state.run.status === "running") return
  let changed = false
  let promoted = false
  for (const input of state.inputs) {
    if (!input.processed || !["transaction", "rfc-server", "rfc-transaction"].includes(input.kind))
      continue
    const source = input.kind as "transaction" | "rfc-server" | "rfc-transaction"
    const prefix = `${input.id}:${source}:`
    const unresolved = state.observations.filter(
      item => item.inputId === input.id && !item.seeds.length && item.id.startsWith(prefix)
    )
    const resolved = resolveEntries(
      unresolved.map(item => item.id.slice(prefix.length)),
      source,
      state.inventory,
      state.transactions,
      state.functions
    )
    const replacements = new Map(resolved.map(item => [`${input.id}:${item.id}`, item]))
    state.observations = state.observations.map(previous => {
      const item = replacements.get(previous.id)
      if (!item) return previous
      const reason = `${item.reason}; file ${input.name}${input.period ? `; period ${input.period}` : ""}`
      if (item.seeds.length) promoted = true
      if (previous.reason !== reason || item.seeds.length) changed = true
      return {
        ...previous,
        ...item,
        id: previous.id,
        inputId: previous.inputId,
        date: previous.date,
        period: previous.period,
        reason,
        ambiguous: item.ambiguous
      }
    })
    const issues = state.observations
      .filter(item => item.inputId === input.id && !item.seeds.length)
      .map(item => item.reason)
    if (JSON.stringify(input.issues) !== JSON.stringify(issues)) changed = true
    input.issues = issues
  }
  if (!changed) return
  setStageIssues(
    state,
    "st03n",
    state.inputs
      .filter(input => ["transaction", "rfc-server", "rfc-transaction"].includes(input.kind))
      .flatMap(input => input.issues)
  )
  if (promoted) state.dependencyCheckpoint = undefined
  if (!state.stageIssues?.st03n?.length && state.stages?.st03n?.status === "partial") {
    state.stages.st03n.status = "complete"
    if (state.run.stage === "st03n" && state.run.status === "partial") state.run.status = "complete"
  }
}

export function setStageIssues(state: UsageAnalysis, stage: Stage, issues: string[]) {
  state.stageIssues ??= {}
  state.stageIssues[stage] = [...new Set(issues)]
  state.issues = [...new Set(Object.values(state.stageIssues).flatMap(values => values || []))]
}

export function usageConfirmation(state: UsageAnalysis, message: Record<string, unknown>) {
  const options = message.options as Record<string, unknown> | undefined
  const hasCache =
    Object.keys(state.checks).length > 0 ||
    state.edges.some(edge => !["Owner mapping", "Transaction mapping"].includes(edge.source))
  const warnings: string[] = []
  if (
    options &&
    "dependencyConnectionId" in options &&
    String(options.dependencyConnectionId || "").toLowerCase() !== state.dependencyConnectionId &&
    hasCache
  )
    warnings.push(
      "Changing the dependency system discards its cached checks and relationships. Used/Unclear statuses will be reassessed; direct usage evidence will be kept."
    )
  if (
    options &&
    jobStatusesChanged(state, options) &&
    (state.stages?.jobs ||
      state.jobsCheckpoint ||
      state.observations.some(item => item.source === "jobs"))
  )
    warnings.push(
      "Changing the considered job statuses resets Jobs evidence and progress. Process Jobs again to reassess Used/Unclear statuses. ST03N evidence and dependency caches will be kept."
    )
  if (message.command === "dependencies" && options?.refreshDependencies === true && hasCache)
    warnings.push(
      "Refreshing the dependency cache discards cached checks and relationships and reads them again from SAP. Used/Unclear statuses may change."
    )
  if (message.command === "st03n" || message.command === "jobs") {
    const stage = message.command
    const resuming = ["paused", "interrupted", "failed"].includes(
      state.run.stage === stage ? state.run.status : state.stages?.[stage]?.status || ""
    )
    if (
      !resuming &&
      (state.observations.some(item =>
        stage === "jobs" ? item.source === "jobs" : item.source !== "jobs"
      ) ||
        ["complete", "partial"].includes(state.stages?.[stage]?.status || ""))
    )
      warnings.push(
        `Reprocessing ${stage === "jobs" ? "Jobs" : "ST03N"} replaces its usage evidence and reassesses Used/Unclear statuses. Other usage evidence and dependency caches will be kept.`
      )
  }
  if (message.command === "removeInput") {
    const input = state.inputs.find(item => item.id === message.inputId)
    if (input) {
      const discovery = ["tadir", "enlfdir"].includes(input.kind)
      const stage = discovery
        ? "discovery"
        : ["tbtco", "tbtcp"].includes(input.kind)
          ? "jobs"
          : "st03n"
      if (input.processed || state.stages?.[stage] || (discovery && state.inventory.length))
        warnings.push(
          discovery
            ? `Removing "${input.name}" clears Discovery and all usage/dependency results. The other uploaded files will be kept.`
            : `Removing "${input.name}" resets all ${stage === "jobs" ? "Jobs" : "ST03N"} evidence, not just this file's contribution, and reassesses Used/Unclear statuses. Other usage evidence and dependency caches will be kept.`
        )
    }
  }
  return warnings.length ? warnings.join("\n\n") : undefined
}

export function resetStage(state: UsageAnalysis, stage: Stage) {
  state.dependencyCheckpoint = undefined
  if (stage === "discovery" || stage === "jobs") state.jobsCheckpoint = undefined
  if (stage === "discovery" || stage === "st03n") {
    state.completedTransactionPrefixes = []
    state.st03nMappingsReady = false
  }
  if (stage === "discovery") {
    state.inventory = []
    state.observations = []
    state.transactions = []
    state.functions = []
    state.jobPrograms = []
    state.completedPackages = []
    state.discoveryPackages = undefined
    state.completedFunctionGroups = []
    state.completedFunctionMappings = []
    state.edges = []
    state.stages = {}
    state.stageIssues = {}
    state.inputs.forEach(input => {
      input.processed = false
      input.issues = []
    })
  } else {
    if (stage === "st03n") {
      state.observations = state.observations.filter(item => item.source === "jobs")
      state.inputs
        .filter(input => ["transaction", "rfc-server", "rfc-transaction"].includes(input.kind))
        .forEach(input => {
          input.processed = false
          input.issues = []
        })
    }
    if (stage === "jobs") {
      state.observations = state.observations.filter(item => item.source !== "jobs")
      state.jobPrograms = []
      state.inputs
        .filter(input => ["tbtco", "tbtcp"].includes(input.kind))
        .forEach(input => {
          input.processed = false
          input.issues = []
        })
    }
    if (state.stages) {
      delete state.stages[stage]
      delete state.stages.dependencies
    }
    if (state.stageIssues) {
      delete state.stageIssues[stage]
      delete state.stageIssues.dependencies
    }
    if (stage === "dependencies")
      state.edges = state.edges.filter(edge =>
        ["Owner mapping", "Transaction mapping"].includes(edge.source)
      )
  }
  if (stage === "discovery" || stage === "dependencies") {
    state.checks = {}
    state.relations = undefined
  }
  state.issues = [
    ...new Set(Object.values(state.stageIssues || {}).flatMap(values => values || []))
  ]
  state.run = { stage, status: "idle", completed: 0, elapsedMs: 0 }
}

export function applyOptions(state: UsageAnalysis, options: Record<string, unknown>) {
  const next = { ...state, stages: { ...state.stages }, stageIssues: { ...state.stageIssues } }
  if ("connectionId" in options)
    next.connectionId = String(options.connectionId || "").toLowerCase()
  if ("packages" in options)
    next.packages = [
      ...new Set(
        String(options.packages || "")
          .split(/[,\n]+/)
          .map(value => value.trim().toUpperCase())
          .filter(Boolean)
      )
    ]
  if ("includeSubpackages" in options) next.includeSubpackages = options.includeSubpackages === true
  for (const field of ["discoveryMode", "jobMode"] as const)
    if (field in options) {
      if (!["connected", "upload"].includes(String(options[field])))
        throw new Error("Choose connected system or uploaded files")
      next[field] = options[field] as "connected" | "upload"
    }
  const discoveryChanged =
    next.connectionId !== state.connectionId ||
    JSON.stringify(next.packages) !== JSON.stringify(state.packages) ||
    next.includeSubpackages !== state.includeSubpackages ||
    next.discoveryMode !== state.discoveryMode
  if (state.inventory.length && discoveryChanged)
    throw new Error("Reset Discovery before changing its system, packages or source")
  if (discoveryChanged) {
    next.discoveryPackages = undefined
    next.completedPackages = []
    next.completedFunctionGroups = []
    next.completedFunctionMappings = []
  }
  if (usageDone(state, "jobs") && "jobMode" in options && next.jobMode !== state.jobMode)
    throw new Error("Reset Jobs before changing its source")
  if ("concurrency" in options) {
    const concurrency = Number(options.concurrency)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
      throw new Error("Concurrent SAP checks must be between 1 and 20")
    next.concurrency = concurrency
  }
  if ("dependencyConnectionId" in options) {
    next.dependencyConnectionId = String(options.dependencyConnectionId || "").toLowerCase()
    if (next.dependencyConnectionId !== state.dependencyConnectionId) {
      resetStage(next, "dependencies")
      next.stages = { ...state.stages }
      delete next.stages.dependencies
    }
  }
  if ("jobConnection" in options)
    next.jobConnection = String(options.jobConnection || "").toLowerCase()
  for (const field of ["jobsFrom", "jobsTo", "periodLabel"] as const)
    if (field in options) next[field] = String(options[field] || "")
  if (
    jobStatusesChanged(state, options) &&
    (state.stages?.jobs ||
      state.jobsCheckpoint ||
      state.observations.some(item => item.source === "jobs"))
  )
    resetStage(next, "jobs")
  for (const field of jobStatusOptions) if (field in options) next[field] = options[field] === true
  Object.assign(state, next)
}
