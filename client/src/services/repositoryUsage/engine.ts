import { EventEmitter } from "events"
import { inventoryKey, objectKey, resolveEntries } from "./analysis"
import { DependencyGraphWorker } from "./dependencyWorker"
import { jobObservations, discoveryInventory } from "./imports"
import { programObservations } from "./jobs"
import { canRunDependencies, dependencyRetryKeys, resetStage, setStageIssues } from "./options"
import { abortIfNeeded } from "./query"
import { UsageSap, deduplicateInventory } from "./sap"
import { UsageStore } from "./store"
import type { DependencyEdge, Stage, UsageAnalysis } from "./types"

interface ActiveRun {
  controller: AbortController
  settled: Promise<void>
  settle: () => void
}
export class UsageEngine extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>()
  constructor(
    readonly store: UsageStore,
    private readonly sap = new UsageSap()
  ) {
    super()
  }

  async edit(id: string, edit: (state: UsageAnalysis) => void) {
    if (this.active.has(id)) throw new Error("Pause the active analysis before changing inputs")
    await this.store.lock(id)
    try {
      let withRows = false
      const state = await this.store.update(id, current => {
        const { inventory, observations, edges } = current
        edit(current)
        withRows =
          current.inventory !== inventory ||
          current.observations !== observations ||
          current.edges !== edges
      })
      this.emit(withRows ? "rows" : "changed", state)
      return state
    } finally {
      await this.store.unlock(id)
    }
  }

  async pause(id: string) {
    const active = this.active.get(id)
    if (active) {
      active.controller.abort()
      await active.settled
    }
  }

  private async progress(
    id: string,
    completed: number,
    total?: number,
    activity?: string,
    unit?: string
  ) {
    const state = await this.store.update(id, current => {
      current.run.completed = completed
      current.run.total = total
      current.run.activity = activity
      current.run.unit = unit
    })
    this.emit("progress", state)
  }

  private async run(id: string, stage: Stage, operation: (signal: AbortSignal) => Promise<void>) {
    if (this.active.has(id)) throw new Error("This analysis is already running")
    let settle = () => {}
    const active = {
      controller: new AbortController(),
      settled: new Promise<void>(resolve => {
        settle = resolve
      }),
      settle: () => settle()
    }
    this.active.set(id, active)
    let locked = false
    try {
      await this.store.lock(id)
      locked = true
      const state = await this.store.update(id, current => {
        const resume = ["paused", "interrupted", "failed"].includes(
          current.run.stage === stage ? current.run.status : current.stages?.[stage]?.status || ""
        )
        const elapsedMs =
          current.run.stage === stage
            ? current.run.elapsedMs
            : current.stages?.[stage]?.elapsedMs || 0
        const previousRun = resume && current.run.stage === stage ? current.run : undefined
        current.run = {
          stage,
          status: "running",
          completed: previousRun?.completed || 0,
          total: previousRun?.total,
          unit: previousRun?.unit,
          dependencyProgress: previousRun?.dependencyProgress,
          resuming: resume,
          activity: {
            discovery: "Finding packages",
            st03n: "Resolving transaction and function-module names",
            jobs: "Reading background job history",
            dependencies: "Checking dependency support"
          }[stage],
          elapsedMs: resume ? elapsedMs : 0,
          startedAt: new Date().toISOString()
        }
      })
      this.emit("changed", state)
      abortIfNeeded(active.controller.signal)
      await operation(active.controller.signal)
      abortIfNeeded(active.controller.signal)
      const completed = await this.store.update(id, current => {
        current.run.status =
          current.stageIssues?.[stage]?.length ||
          (stage === "dependencies" &&
            Object.values(current.checks).some(check => check.status === "error"))
            ? "partial"
            : "complete"
      })
      this.emit("changed", completed)
    } catch (error) {
      if (locked) {
        const failed = await this.store.update(id, current => {
          current.run.status = active.controller.signal.aborted ? "paused" : "failed"
          current.run.error = active.controller.signal.aborted
            ? undefined
            : String(error instanceof Error ? error.message : error)
        })
        this.emit("changed", failed)
      }
      if (!active.controller.signal.aborted) throw error
    } finally {
      try {
        if (locked) {
          const state = await this.store.update(id, current => {
            if (current.run.startedAt)
              current.run.elapsedMs += Math.max(0, Date.now() - Date.parse(current.run.startedAt))
            current.run.startedAt = undefined
            current.stages = {
              ...current.stages,
              [stage]: { status: current.run.status, elapsedMs: current.run.elapsedMs }
            }
          })
          this.emit("rows", state)
        }
      } finally {
        if (locked) await this.store.unlock(id)
        this.active.delete(id)
        active.settle()
      }
    }
  }

  async discover(id: string, restart = false) {
    return this.run(id, "discovery", async signal => {
      let state = await this.store.get(id)
      if (restart)
        state = await this.store.update(id, current => {
          const run = current.run
          resetStage(current, "discovery")
          current.run = run
        })
      if (state.discoveryMode === "upload") {
        const files = state.inputs.filter(
          input => input.kind === "tadir" || input.kind === "enlfdir"
        )
        if (!files.some(input => input.kind === "tadir"))
          throw new Error("Upload a TADIR object list first")
        await this.progress(id, 0, files.length, "Reading uploaded repository extracts", "files")
        const result = discoveryInventory(
          files.filter(input => input.kind === "tadir").flatMap(input => input.rows),
          files.filter(input => input.kind === "enlfdir").flatMap(input => input.rows)
        )
        abortIfNeeded(signal)
        const updated = await this.store.update(id, current => {
          current.inventory = result.inventory
          current.functions = result.functions
          current.completedFunctionMappings = []
          setStageIssues(current, "discovery", result.issues)
          current.inputs
            .filter(input => input.kind === "tadir" || input.kind === "enlfdir")
            .forEach(input => {
              input.processed = true
              input.issues = []
            })
          this.metadataEdges(current)
          current.run.completed = files.length
          current.run.total = files.length
        })
        this.emit("progress", updated)
        return
      }
      if (!state.connectionId) throw new Error("Select a connected system for discovery")
      const packages =
        state.discoveryPackages ||
        (await this.sap.packages(
          state.connectionId,
          state.packages,
          state.includeSubpackages,
          signal
        ))
      if (!packages.length) throw new Error("No packages match the supplied patterns")
      if (!state.discoveryPackages)
        state = await this.store.update(id, current => {
          current.discoveryPackages = packages
        })
      const done = new Set(state.completedPackages)
      await this.progress(id, done.size, packages.length, "Reading repository objects", "packages")
      for (const packageName of packages) {
        abortIfNeeded(signal)
        if (done.has(packageName)) continue
        const rows = await this.sap.inventory(state.connectionId, packageName, signal)
        done.add(packageName)
        const updated = await this.store.update(id, current => {
          current.inventory = deduplicateInventory([...current.inventory, ...rows])
          current.completedPackages = [...done]
          current.run.completed = done.size
          current.run.total = packages.length
        })
        this.emit("progress", updated)
      }
      state = await this.store.get(id)
      const groups = state.inventory.filter(row => row.objectType === "FUGR")
      const completedGroups = new Set(state.completedFunctionGroups)
      const batches = new Map<string, typeof groups>()
      for (const group of groups) {
        const prefix = group.objectName[0]
        const batch = batches.get(prefix)
        if (batch) batch.push(group)
        else batches.set(prefix, [group])
      }
      let completedBatches = [...batches.values()].filter(batch =>
        batch.every(group => completedGroups.has(inventoryKey(group)))
      ).length
      await this.progress(
        id,
        completedBatches,
        batches.size,
        "Reading function modules",
        "prefix batches"
      )
      for (const [prefix, batch] of batches) {
        abortIfNeeded(signal)
        const pendingGroups = batch.filter(group => !completedGroups.has(inventoryKey(group)))
        if (!pendingGroups.length) continue
        await this.progress(
          id,
          completedBatches,
          batches.size,
          `Reading function modules: ${prefix}* (${pendingGroups.length} function ${pendingGroups.length === 1 ? "group" : "groups"})`,
          "prefix batches"
        )
        const modules = await this.sap.functionModules(state.connectionId, pendingGroups, signal)
        abortIfNeeded(signal)
        pendingGroups.forEach(group => completedGroups.add(inventoryKey(group)))
        const updated = await this.store.update(id, current => {
          current.inventory = deduplicateInventory([...current.inventory, ...modules])
          current.functions = [
            ...new Map(
              [
                ...current.functions,
                ...modules.map(module => ({
                  name: module.objectName,
                  group: module.functionGroup!
                }))
              ].map(item => [item.name, item])
            ).values()
          ]
          current.completedFunctionGroups = [...completedGroups]
          this.metadataEdges(current)
          current.run.completed = ++completedBatches
          current.run.total = batches.size
        })
        this.emit("progress", updated)
      }
    })
  }

  async processSt03n(id: string) {
    return this.run(id, "st03n", async signal => {
      let state = await this.store.get(id)
      const inputs = state.inputs.filter(input =>
        ["transaction", "rfc-server", "rfc-transaction"].includes(input.kind)
      )
      if (!inputs.length) throw new Error("Upload at least one ST03N extract")
      this.requireDiscovery(state)
      if (!state.connectionId)
        throw new Error(
          "Choose a connected repository system to look up transaction and function-module names"
        )
      const resume = state.run.resuming === true
      if (!resume)
        state = await this.store.update(id, current => {
          current.completedTransactionPrefixes = []
          current.st03nMappingsReady = false
          current.inputs
            .filter(input => inputs.some(item => item.id === input.id))
            .forEach(input => {
              input.processed = false
            })
        })
      const completedFiles = resume ? inputs.filter(input => input.processed).length : 0
      await this.progress(
        id,
        completedFiles,
        inputs.length,
        "Resolving transaction and function-module names",
        "files"
      )
      const mappings =
        resume && state.st03nMappingsReady
          ? { transactions: state.transactions, functions: state.functions }
          : await this.sap.mappings(state, signal, {
              transactionNames: inputs
                .filter(input => input.kind !== "rfc-server")
                .flatMap(input => input.rows.map(row => row.OBJECTNAME)),
              functionNames: inputs
                .filter(input => input.kind === "rfc-server")
                .flatMap(input => input.rows.map(row => row.OBJECTNAME)),
              resume,
              checkpoint: async (snapshot, activity) => {
                state = await this.store.update(id, current => {
                  Object.assign(current, snapshot)
                  current.run.activity = activity
                })
                this.emit("progress", state)
              }
            })
      abortIfNeeded(signal)
      state = await this.store.update(id, current => {
        Object.assign(current, mappings)
        current.st03nMappingsReady = true
      })
      const relevantFunctions = new Set([
        ...state.inventory.filter(row => row.objectType === "FUNC").map(row => row.objectName),
        ...mappings.functions.map(item => item.name)
      ])
      const relevantEntries = new Set(
        state.inventory
          .filter(row => ["PROG", "TRAN"].includes(row.objectType))
          .map(row => row.objectName)
      )
      for (const item of mappings.transactions)
        if (relevantEntries.has(item.transaction) || relevantEntries.has(item.program)) {
          relevantEntries.add(item.transaction)
          relevantEntries.add(item.program)
        }
      let completed = completedFiles
      for (const input of inputs) {
        abortIfNeeded(signal)
        if (resume && input.processed) continue
        await this.progress(
          id,
          completed,
          inputs.length,
          `Matching ST03N extract: ${input.name}`,
          "files"
        )
        const source = input.kind as "transaction" | "rfc-server" | "rfc-transaction"
        const names = input.rows
          .map(row => row.OBJECTNAME)
          .filter(name =>
            (source === "rfc-server" ? relevantFunctions : relevantEntries).has(
              name.trim().toUpperCase()
            )
          )
        const observations = resolveEntries(
          names,
          source,
          state.inventory,
          mappings.transactions,
          mappings.functions
        ).map(item => ({
          ...item,
          id: `${input.id}:${item.id}`,
          inputId: input.id,
          period: input.period,
          reason: `${item.reason}; file ${input.name}${input.period ? `; period ${input.period}` : ""}`
        }))
        const issues = observations.filter(item => !item.seeds.length).map(item => item.reason)
        const updated = await this.store.update(id, current => {
          current.observations = current.observations
            .filter(item => item.inputId !== input.id)
            .concat(observations)
          current.dependencyCheckpoint = undefined
          const saved = current.inputs.find(item => item.id === input.id)!
          saved.processed = true
          saved.issues = issues
          setStageIssues(
            current,
            "st03n",
            current.inputs
              .filter(item => ["transaction", "rfc-server", "rfc-transaction"].includes(item.kind))
              .flatMap(item => item.issues)
          )
          this.metadataEdges(current)
          current.run.completed = ++completed
          current.run.total = inputs.length
        })
        this.emit("progress", updated)
      }
    })
  }

  async processJobs(id: string, connection?: string) {
    return this.run(id, "jobs", async signal => {
      let state = await this.store.get(id)
      this.requireDiscovery(state)
      if (!state.connectionId)
        throw new Error(
          "Choose a connected repository system to look up job programs and transactions"
        )
      let result: ReturnType<typeof jobObservations>
      let programs: UsageAnalysis["jobPrograms"]
      let headers: Record<string, string>[] = []
      let steps: Record<string, string>[] = []
      const source = JSON.stringify([
        connection || "upload",
        state.jobsFrom,
        state.jobsTo,
        state.includeReleasedJobs === true,
        state.includeScheduledJobs === true,
        state.inputs.filter(input => ["tbtco", "tbtcp"].includes(input.kind)).map(input => input.id)
      ])
      const resume = state.run.resuming === true && state.jobsCheckpoint?.source === source
      if (!resume)
        state = await this.store.update(id, current => {
          current.jobsCheckpoint = {
            source,
            collected: false,
            mappingsReady: false,
            completedTransactionPrefixes: []
          }
        })
      if (!connection) {
        const headerFiles = state.inputs.filter(input => input.kind === "tbtco")
        const stepFiles = state.inputs.filter(input => input.kind === "tbtcp")
        if (!headerFiles.length || !stepFiles.length)
          throw new Error("Upload both TBTCO and TBTCP extracts")
        headers = headerFiles.flatMap(input => input.rows)
        steps = stepFiles.flatMap(input => input.rows)
      }
      if (state.jobsCheckpoint!.collected) programs = state.jobPrograms
      else if (connection) {
        programs = await this.sap.jobs(
          connection,
          state.jobsFrom,
          state.jobsTo,
          signal,
          (done, total) =>
            this.progress(id, done, total, "Reading background job programs", "programs"),
          state
        )
      } else {
        result = jobObservations(headers, steps, state.inventory, [], state)
        programs = result.observations.map(item => ({
          program: item.seeds.find(key => key.startsWith("R3TR:PROG:"))!.slice(10),
          date: item.date
        }))
      }
      state = await this.store.update(id, current => {
        current.jobPrograms = programs
        current.jobsCheckpoint!.collected = true
      })
      abortIfNeeded(signal)
      await this.progress(
        id,
        0,
        programs.length,
        "Matching job programs and transactions",
        "programs"
      )
      const mappings = state.jobsCheckpoint!.mappingsReady
        ? { transactions: state.transactions, functions: state.functions }
        : await this.sap.mappings(
            {
              ...state,
              completedTransactionPrefixes: state.jobsCheckpoint!.completedTransactionPrefixes
            },
            signal,
            {
              transactionNames: programs.map(item => item.program),
              functionNames: [],
              resume,
              checkpoint: async (snapshot, activity) => {
                state = await this.store.update(id, current => {
                  current.transactions = snapshot.transactions
                  current.functions = snapshot.functions
                  current.completedFunctionMappings = snapshot.completedFunctionMappings
                  current.jobsCheckpoint!.completedTransactionPrefixes =
                    snapshot.completedTransactionPrefixes
                  current.run.activity = activity
                })
                this.emit("progress", state)
              }
            }
          )
      state = await this.store.update(id, current => {
        current.transactions = mappings.transactions
        current.functions = mappings.functions
        if ("completedFunctionMappings" in mappings)
          current.completedFunctionMappings = mappings.completedFunctionMappings
        if ("completedTransactionPrefixes" in mappings)
          current.jobsCheckpoint!.completedTransactionPrefixes =
            mappings.completedTransactionPrefixes
        current.jobsCheckpoint!.mappingsReady = true
      })
      abortIfNeeded(signal)
      result = connection
        ? {
            observations: programObservations(programs, state.inventory, mappings.transactions),
            issues: []
          }
        : jobObservations(headers, steps, state.inventory, mappings.transactions, state)
      state = await this.store.update(id, current => {
        current.jobPrograms = programs
        current.observations = current.observations
          .filter(item => item.source !== "jobs")
          .concat(result.observations)
        current.dependencyCheckpoint = undefined
        setStageIssues(current, "jobs", result.issues)
        current.inputs
          .filter(input => ["tbtco", "tbtcp"].includes(input.kind))
          .forEach(input => {
            input.processed = true
          })
        this.metadataEdges(current)
        current.run.completed = programs.length
        current.run.total = programs.length
      })
      this.emit("progress", state)
    })
  }

  private requireDiscovery(state: UsageAnalysis) {
    if (
      !state.inventory.length ||
      !["complete", "partial"].includes(state.stages?.discovery?.status || "")
    )
      throw new Error("Finish Discovery before processing usage")
  }

  async reset(id: string, stage: Stage) {
    return this.edit(id, state => {
      resetStage(state, stage)
    })
  }

  private metadataEdges(state: UsageAnalysis) {
    const edges: DependencyEdge[] = state.edges.filter(
      edge => edge.source !== "Owner mapping" && edge.source !== "Transaction mapping"
    )
    for (const item of state.functions)
      edges.push({
        caller: objectKey("FUNC", item.name),
        dependency: objectKey("FUGR", item.group),
        source: "Owner mapping"
      })
    for (const item of state.transactions)
      if (item.program) {
        const caller = objectKey("TRAN", item.transaction),
          dependency = objectKey("PROG", item.program)
        edges.push(
          { caller, dependency, source: "Transaction mapping" },
          { caller: dependency, dependency: caller, source: "Transaction mapping" }
        )
      }
    state.edges = uniqueEdges(edges)
  }

  async dependencies(id: string, retryFailedOrEmpty = false) {
    const graph = new DependencyGraphWorker()
    try {
      return await this.run(id, "dependencies", async signal => {
        let state = await this.store.get(id)
        this.requireDiscovery(state)
        if (!canRunDependencies(state))
          throw new Error(
            "Process ST03N or Jobs first and find at least one Used object. Without a starting point, where-used cannot mark any more objects Used."
          )
        const connection = state.dependencyConnectionId
        if (!connection) throw new Error("Select a dependency system")
        if (!state.relations) {
          const first =
            state.inventory.find(row => ["PROG", "CLAS", "FUGR"].includes(row.objectType)) ||
            state.inventory[0]
          abortIfNeeded(signal)
          const available = await this.sap.probe(connection, inventoryKey(first), signal)
          abortIfNeeded(signal)
          state = await this.store.update(id, current => {
            current.relations = available ? "available" : "unavailable"
          })
          this.emit("changed", state)
        }
        const checkpoint =
          !retryFailedOrEmpty && state.run.resuming ? state.dependencyCheckpoint : undefined
        const retryKeys = retryFailedOrEmpty
          ? new Set(dependencyRetryKeys(state))
          : checkpoint?.retryKeys
            ? new Set(checkpoint.retryKeys)
            : undefined
        const attempted = new Set(
          checkpoint?.attempted || (checkpoint ? Object.keys(state.checks) : [])
        )
        if (!checkpoint)
          state = await this.store.update(id, current => {
            current.dependencyCheckpoint = undefined
          })
        let used = new Set(checkpoint?.used || (await graph.evaluate(state, signal)))
        let frontier = new Set(checkpoint?.frontier || used)
        let pass = checkpoint ? checkpoint.pass - 1 : 0
        const history: NonNullable<UsageAnalysis["run"]["dependencyProgress"]>["history"] = [
          ...(checkpoint?.history || [])
        ]
        for (;;) {
          abortIfNeeded(signal)
          pass++
          const tasks: { key: string; direction: "ENV" | "WUL" }[] = retryKeys
            ? [...retryKeys].map(key => ({
                key: key.slice(4),
                direction: key.startsWith("ENV:") ? "ENV" : "WUL"
              }))
            : state.inventory
                .filter(row => !used.has(inventoryKey(row)))
                .map(row => ({ key: inventoryKey(row), direction: "WUL" }))
          if (!retryKeys && state.relations === "available")
            for (const key of frontier) {
              if (
                key.startsWith("R3TR:FUGR:") &&
                !state.observations.some(item => item.seeds.includes(key))
              )
                continue
              tasks.push({ key, direction: "ENV" })
            }
          const pending = tasks.filter(
            task =>
              !attempted.has(`${task.direction}:${task.key}`) &&
              (retryKeys || state.checks[`${task.direction}:${task.key}`]?.status !== "complete")
          )
          const cached = tasks.filter(
            task =>
              state.checks[`${task.direction}:${task.key}`]?.status === "complete" &&
              (!retryKeys || attempted.has(`${task.direction}:${task.key}`))
          ).length
          const failed = tasks.filter(task => {
            const key = `${task.direction}:${task.key}`
            return attempted.has(key) && state.checks[key]?.status === "error"
          }).length
          state = await this.store.update(id, current => {
            current.dependencyCheckpoint = {
              used: [...used],
              frontier: [...frontier],
              pass,
              attempted: [...attempted],
              retryKeys: retryKeys ? [...retryKeys] : undefined,
              history: [...history]
            }
            current.run.completed = cached + failed
            current.run.total = tasks.length
            current.run.activity = `Pass ${pass}: checking inventory dependencies`
            current.run.unit = "checks"
            current.run.dependencyProgress = {
              pass,
              used: used.size,
              unclear: current.inventory.length - used.size,
              newlyUsed: 0,
              cached,
              failed,
              history: [...history]
            }
          })
          this.emit("progress", state)
          for (let offset = 0; offset < pending.length; offset += state.concurrency) {
            abortIfNeeded(signal)
            const batch = pending.slice(offset, offset + state.concurrency)
            const results = await Promise.all(
              batch.map(async task => {
                const checkKey = `${task.direction}:${task.key}`
                attempted.add(checkKey)
                try {
                  const result = await this.sap.dependencies(
                    connection,
                    task.key,
                    task.direction,
                    state.relations === "available",
                    signal
                  )
                  return { checkKey, ...result }
                } catch (error) {
                  return {
                    checkKey,
                    edges: [] as DependencyEdge[],
                    errors: [String(error instanceof Error ? error.message : error)]
                  }
                }
              })
            )
            abortIfNeeded(signal)
            state = await this.store.update(id, current => {
              for (const result of results) {
                current.checks[result.checkKey] = result.errors.length
                  ? {
                      status: "error",
                      error: result.errors.join("; "),
                      edgeCount: uniqueEdges(result.edges).length
                    }
                  : { status: "complete", edgeCount: uniqueEdges(result.edges).length }
                current.edges.push(...result.edges)
              }
              current.dependencyCheckpoint!.attempted = [...attempted]
              current.run.completed = cached + failed + offset + batch.length
              current.run.dependencyProgress!.failed += results.filter(
                result => result.errors.length
              ).length
            })
            this.emit("progress", state)
          }
          const reassessed = new Set(
            await graph.evaluate({ ...state, previousUsed: [...used] }, signal)
          )
          const newlyUsed = new Set([...reassessed].filter(key => !used.has(key)))
          used = reassessed
          history.push({
            pass,
            newlyUsed: newlyUsed.size,
            used: used.size,
            unclear: state.inventory.length - used.size
          })
          state = await this.store.update(id, current => {
            current.edges = uniqueEdges(current.edges)
            current.dependencyCheckpoint = {
              used: [...used],
              frontier: [...newlyUsed],
              pass: pass + 1,
              attempted: [...attempted],
              retryKeys: retryKeys ? [...retryKeys] : undefined,
              history: [...history]
            }
            current.run.dependencyProgress = {
              ...current.run.dependencyProgress!,
              used: used.size,
              unclear: current.inventory.length - used.size,
              newlyUsed: newlyUsed.size,
              history: [...history]
            }
          })
          this.emit("progress", state)
          if (!newlyUsed.size) break
          frontier = newlyUsed
        }
      })
    } finally {
      await graph.dispose()
    }
  }
}

export const uniqueEdges = (edges: DependencyEdge[]) => [
  ...new Map(
    edges
      .filter(edge => edge.caller !== edge.dependency)
      .map(edge => [`${edge.caller}|${edge.dependency}|${edge.source}`, edge])
  ).values()
]
