import * as vscode from "vscode"
import * as fs from "fs/promises"
import { createTwoFilesPatch } from "diff"
import { connectedRoots } from "../../config"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"
import { RepositoryWorkflowRuntime } from "../repositoryWorkflow/runtime"
import { defaultWorkflowName, hasCompletionForPlanItem } from "../repositoryWorkflow/workflowStore"
import { objectFolderId } from "../repositoryWorkflow/snapshotService"
import type {
  ObjectSnapshotManifest,
  SnapshotRepresentation,
  SourceComparisonRecord
} from "../repositoryWorkflow/types"

interface WorkflowIdInput {
  workflowId: string
}

interface GetWorkflowInput extends WorkflowIdInput {
  include?: Array<
    | "state"
    | "criteria"
    | "summaries"
    | "artifact"
    | "diff"
    | "assistedApplyObjects"
    | "assistedApplyHistory"
  >
  step?: keyof Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>["steps"]
  artifact?:
    | "sourceDiscovery"
    | "targetDiscovery"
    | "existenceComparison"
    | "sourceComparison"
    | "assistedApplyPlan"
  offset?: number
  limit?: number
  status?: string
  objectName?: string
  objectType?: string
  packageName?: string
  objectKey?: string
  representation?: SnapshotRepresentation
  filePath?: string
  maxFiles?: number
  maxChars?: number
  assistedApplyAction?: "get" | "markDone" | "markPending" | "setDecision"
  assistedApplyObjectKeys?: string[]
  assistedApplyDecision?: "as-is" | "skip" | "needs-human"
  assistedApplyDecisionReason?: string
  includeDone?: boolean
}

class ListRepositoryWorkflowsTool implements vscode.LanguageModelTool<Record<string, never>> {
  async prepareInvocation() {
    return { invocationMessage: "Listing repository workflows" }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    const workflows = await runtime.store.list()
    return result(
      JSON.stringify(
        workflows.map(workflow => ({
          workflowId: workflow.workflowId,
          name: workflow.name,
          sourceConnectionId: workflow.source.connectionId,
          targetConnectionId: workflow.target.connectionId,
          currentStep: workflow.currentStep,
          runState: workflow.runState,
          updatedAt: workflow.updatedAt,
          lastError: workflow.lastError
        })),
        null,
        2
      )
    )
  }
}

export class GetRepositoryWorkflowTool implements vscode.LanguageModelTool<GetWorkflowInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetWorkflowInput>
  ) {
    const requested = options.input.include?.length
      ? options.input.include.join(", ")
      : options.input.artifact
        ? options.input.artifact
        : "state"
    const action = options.input.assistedApplyAction ?? "get"
    const actionMessage =
      action === "markDone"
        ? `Marking ${(options.input.assistedApplyObjectKeys ?? []).length} Copilot-assisted apply object${(options.input.assistedApplyObjectKeys ?? []).length === 1 ? "" : "s"} done`
        : action === "markPending"
          ? `Resetting ${(options.input.assistedApplyObjectKeys ?? []).length} Copilot-assisted apply object${(options.input.assistedApplyObjectKeys ?? []).length === 1 ? "" : "s"} to pending`
          : `Setting the Copilot decision for ${options.input.objectKey ?? "one assisted-apply object"}`
    return {
      invocationMessage:
        action === "get"
          ? `Reading repository workflow ${requested} for ${options.input.workflowId}`
          : actionMessage
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<GetWorkflowInput>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    const workflow = await runtime.store.get(options.input.workflowId)
    const include = new Set(
      options.input.include?.length
        ? options.input.include
        : options.input.artifact
          ? ["artifact" as const]
          : ["state" as const]
    )
    const response: Record<string, unknown> = { workflowId: workflow.workflowId }
    if (include.has("state"))
      response.workflow = options.input.step
        ? {
            currentStep: workflow.currentStep,
            runState: workflow.runState,
            step: options.input.step,
            stepState: workflow.steps[options.input.step],
            lastError: workflow.lastError
          }
        : workflow
    if (include.has("criteria"))
      response.criteria = await runtime.store.getCriteria(workflow.workflowId)
    if (include.has("summaries")) response.summaries = await readSummaries(runtime, workflow)
    if (include.has("artifact")) {
      if (!options.input.artifact)
        throw new Error("artifact is required when include contains artifact")
      response.artifact = await readArtifact(runtime, workflow, options.input)
    }
    if (include.has("diff")) {
      if (!options.input.objectKey)
        throw new Error("objectKey is required when include contains diff")
      response.diff = await readObjectDiff(runtime, workflow, options.input)
    }
    if (include.has("assistedApplyHistory")) {
      assertCopilotAssistedApplyEnabled(workflow)
      if (!options.input.objectKey)
        throw new Error("objectKey is required when include contains assistedApplyHistory")
      const events = await runtime.store.getAssistedApplyExecutionEvents(
        workflow.workflowId,
        options.input.objectKey
      )
      const offset = Math.max(0, Math.floor(options.input.offset ?? 0))
      const limit = Math.min(200, Math.max(1, Math.floor(options.input.limit ?? 50)))
      response.assistedApplyHistory = {
        objectKey: options.input.objectKey.trim().toUpperCase(),
        total: events.length,
        offset,
        limit,
        returned: events.slice(offset, offset + limit).length,
        hasMore: offset + limit < events.length,
        nextOffset: offset + limit < events.length ? offset + limit : undefined,
        events: events.slice(offset, offset + limit)
      }
    }
    const assistedApplyAction = options.input.assistedApplyAction ?? "get"
    if (assistedApplyAction !== "get" && !include.has("assistedApplyObjects"))
      throw new Error(
        "include must contain assistedApplyObjects when using an assisted-apply action"
      )
    if (include.has("assistedApplyObjects")) {
      assertCopilotAssistedApplyEnabled(workflow)
      let updated = 0
      if (assistedApplyAction !== "get") {
        if (assistedApplyAction === "setDecision") {
          if ((options.input.assistedApplyObjectKeys ?? []).length)
            throw new Error(
              "setDecision accepts exactly one objectKey and does not support batches"
            )
          if (!options.input.objectKey) throw new Error("objectKey is required for setDecision")
          if (!options.input.assistedApplyDecision)
            throw new Error("assistedApplyDecision is required for setDecision")
          if (!options.input.assistedApplyDecisionReason?.trim())
            throw new Error("assistedApplyDecisionReason is required for setDecision")
          await runtime.store.updateCopilotAssistedApplyDecision(
            workflow.workflowId,
            options.input.objectKey,
            options.input.assistedApplyDecision,
            options.input.assistedApplyDecisionReason
          )
          updated = 1
        } else {
          const keys = options.input.assistedApplyObjectKeys ?? []
          if (keys.length > 200)
            throw new Error("At most 200 assisted-apply objects can be updated per call")
          if (assistedApplyAction === "markDone")
            for (const key of keys) {
              const events = await runtime.store.getAssistedApplyExecutionEvents(
                workflow.workflowId,
                key
              )
              const planItem = await runtime.store.getAssistedApplyPlanItem(workflow, key)
              if (!planItem || !hasCompletionForPlanItem(events, planItem))
                throw new Error(
                  `${key.trim().toUpperCase()} cannot be marked done until successful activation is recorded`
                )
            }
          await runtime.store.updateCopilotAssistedApplyStatus(
            workflow.workflowId,
            keys,
            assistedApplyAction === "markDone" ? "done" : "pending"
          )
          updated = new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean)).size
        }
        runtime.notifyChanged(workflow.workflowId)
      }
      response.assistedApplyObjects = {
        action: assistedApplyAction,
        updated,
        ...(await readCopilotAssistedApplyObjects(runtime, workflow, options.input))
      }
    }
    return result(JSON.stringify(response, null, 2))
  }
}

interface CreateWorkflowInput {
  name?: string
  sourceConnectionId: string
  targetConnectionId: string
  description?: string
}

interface UpdateCriteriaInput extends WorkflowIdInput {
  includeNames?: string[]
  excludeNames?: string[]
  packages?: string[]
  includeSubpackages?: boolean
  objectTypes?: string[]
  namespaces?: string[]
  authors?: string[]
  createdFrom?: string
  createdTo?: string
  includeDeleted?: boolean
  includeGenerated?: boolean
  includeTemporary?: boolean
  sourceConcurrency?: number
  targetConcurrency?: number
  verificationConcurrency?: number
}

class UpdateRepositoryWorkflowCriteriaTool implements vscode.LanguageModelTool<UpdateCriteriaInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateCriteriaInput>
  ) {
    return {
      invocationMessage: "Updating repository workflow criteria",
      confirmationMessages: {
        title: "Update Repository Workflow Criteria",
        message: new vscode.MarkdownString(
          `Update criteria for workflow \`${options.input.workflowId}\`? Existing discovery and downstream artifacts will be invalidated.`
        )
      }
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<UpdateCriteriaInput>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    await showWorkflow(options.input.workflowId)
    const existing = await runtime.store.getCriteria(options.input.workflowId)
    if (!existing) throw new Error("Workflow criteria are missing")
    const { criteriaHash: _criteriaHash, ...base } = existing
    const { workflowId: _workflowId, ...changes } = options.input
    const saved = await runtime.store.saveCriteria(options.input.workflowId, {
      ...base,
      ...changes,
      updatedAt: new Date().toISOString()
    })
    runtime.notifyChanged(options.input.workflowId, true)
    return result(JSON.stringify(saved, null, 2))
  }
}

class CreateRepositoryWorkflowTool implements vscode.LanguageModelTool<CreateWorkflowInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CreateWorkflowInput>
  ) {
    return {
      invocationMessage: "Creating repository comparison workflow",
      confirmationMessages: {
        title: "Create Repository Workflow",
        message: new vscode.MarkdownString(
          `Create a workflow from **${options.input.sourceConnectionId}** to **${options.input.targetConnectionId}**?`
        )
      }
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<CreateWorkflowInput>) {
    assertToolInvocationAuthorized(options)
    const source = options.input.sourceConnectionId.toLowerCase()
    const target = options.input.targetConnectionId.toLowerCase()
    const roots = connectedRoots()
    if (!roots.has(source) || !roots.has(target))
      throw new Error("Source and target must be connected workspace roots")
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    await showWorkflow()
    const workflow = await runtime.store.create({
      name: options.input.name || defaultWorkflowName(source, target),
      description: options.input.description,
      sourceConnectionId: source,
      targetConnectionId: target
    })
    runtime.notifyChanged(workflow.workflowId, true)
    return result(JSON.stringify(workflow, null, 2))
  }
}

interface RunWorkflowInput extends WorkflowIdInput {
  step: "discovery" | "existenceComparison" | "sourceComparison"
  objectKeys?: string[]
  sourceConcurrency?: number
  targetConcurrency?: number
  verificationConcurrency?: number
}

class RunRepositoryWorkflowTool implements vscode.LanguageModelTool<RunWorkflowInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunWorkflowInput>
  ) {
    const detail =
      options.input.step === "discovery"
        ? " and local inventory comparison"
        : options.input.step === "sourceComparison"
          ? options.input.objectKeys
            ? ` for ${options.input.objectKeys.length} selected object${options.input.objectKeys.length === 1 ? "" : "s"}`
            : " for all comparable objects"
          : ""
    const concurrency =
      options.input.step === "sourceComparison" &&
      (options.input.sourceConcurrency || options.input.targetConcurrency)
        ? ` at ${options.input.sourceConcurrency ?? "saved"}/${options.input.targetConcurrency ?? "saved"} source/target concurrency`
        : ""
    return {
      invocationMessage: `Running repository ${options.input.step}${detail}${concurrency}`,
      confirmationMessages: {
        title: "Run Repository Workflow Step",
        message: new vscode.MarkdownString(
          `Run **${options.input.step}${options.input.step === "discovery" ? " and local inventory comparison" : ""}** for workflow \`${options.input.workflowId}\`?`
        )
      }
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<RunWorkflowInput>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    const engine = runtime.engine
    const workflowId = options.input.workflowId
    await showWorkflow(workflowId)
    runtime.notifyChanged(workflowId, true)
    await runtime.runWithRefreshBatch(workflowId, async () => {
      switch (options.input.step) {
        case "discovery": {
          const discovered = await engine.runDiscovery(workflowId)
          if (discovered.steps.discovery.status === "complete")
            await engine.compareExistence(workflowId)
          break
        }
        case "existenceComparison":
          await engine.compareExistence(workflowId)
          break
        case "sourceComparison":
          if (
            options.input.sourceConcurrency ||
            options.input.targetConcurrency ||
            options.input.verificationConcurrency
          ) {
            const criteria = await runtime.store.getCriteria(workflowId)
            if (!criteria) throw new Error("Workflow criteria are missing")
            await runtime.store.saveDownloadConcurrency(
              workflowId,
              options.input.sourceConcurrency ?? criteria.sourceConcurrency,
              options.input.targetConcurrency ?? criteria.targetConcurrency,
              options.input.verificationConcurrency ?? criteria.verificationConcurrency
            )
          }
          await engine.compareSourceCode(workflowId, options.input.objectKeys)
          break
      }
    })
    const workflow = await runtime.store.get(workflowId)
    const pausedByUser = workflow.runState === "paused"
    const partial = workflow.runState === "partial"
    const pauseReason = pausedByUser ? workflow.steps[workflow.currentStep].pauseReason : undefined
    return result(
      JSON.stringify(
        {
          workflowId,
          operation: options.input.step,
          runState: workflow.runState,
          currentStep: workflow.currentStep,
          currentStepState: workflow.steps[workflow.currentStep],
          completedStep: workflow.steps[options.input.step],
          pausedByUser,
          pauseReason,
          ...(pausedByUser
            ? {
                outcome: "paused-by-user",
                automaticRetryAllowed: false,
                message:
                  pauseReason === "panel-closed"
                    ? "The user closed the Repository Comparison Workflow panel, which intentionally stopped this operation. Do not restart it automatically. Inform the user that it is paused and wait for an explicit request to resume."
                    : "The user explicitly paused this operation. Do not restart it automatically. Completed checkpoints and reusable snapshots were preserved."
              }
            : {}),
          ...(partial
            ? {
                outcome: "partial",
                automaticRetryAllowed: false,
                message:
                  "The operation produced partial results because some selected objects could not be downloaded or compared. Do not report clean completion or retry automatically. Ask the user whether to retry incomplete objects."
              }
            : {}),
          ...(options.input.step === "discovery"
            ? { inventoryComparison: workflow.steps.existenceComparison }
            : {}),
          lastError: workflow.lastError
        },
        null,
        2
      )
    )
  }
}

class OpenRepositoryWorkflowTool implements vscode.LanguageModelTool<WorkflowIdInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<WorkflowIdInput>
  ) {
    return {
      invocationMessage: `Opening repository workflow ${options.input.workflowId}`
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<WorkflowIdInput>) {
    assertToolInvocationAuthorized(options)
    await RepositoryWorkflowRuntime.get().ready
    await vscode.commands.executeCommand("abapfs.repositoryWorkflow", options.input.workflowId)
    return result(`Opened repository workflow ${options.input.workflowId}`)
  }
}

interface PrepareAssistedApplyInput extends WorkflowIdInput {
  comparisonBasis?: SnapshotRepresentation
}

class PrepareRepositoryAssistedApplyTool implements vscode.LanguageModelTool<PrepareAssistedApplyInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<PrepareAssistedApplyInput>
  ) {
    return {
      invocationMessage: `Preparing ${options.input.comparisonBasis ?? "formatted"} assisted-apply plan for ${options.input.workflowId}`
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<PrepareAssistedApplyInput>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    await showWorkflow(options.input.workflowId)
    runtime.notifyChanged(options.input.workflowId, true)
    const plan = await runtime.runWithRefreshBatch(options.input.workflowId, () =>
      runtime.engine.prepareAssistedApply(
        options.input.workflowId,
        undefined,
        options.input.comparisonBasis ?? "formatted"
      )
    )
    if (!plan) {
      const workflow = await runtime.store.get(options.input.workflowId)
      return result(
        JSON.stringify(
          {
            workflowId: workflow.workflowId,
            outcome: "paused-by-user",
            pausedByUser: true,
            pauseReason: workflow.steps.assistedApplyPlan.pauseReason,
            automaticRetryAllowed: false,
            message:
              "The user stopped assisted-apply preparation. Do not restart it automatically; inform the user and wait for an explicit request to resume."
          },
          null,
          2
        )
      )
    }
    const workflow = await runtime.store.get(options.input.workflowId)
    return result(
      JSON.stringify(
        {
          workflowId: options.input.workflowId,
          comparisonBasis: plan.comparisonBasis,
          eligible: plan.items.filter(item => item.eligible).length,
          blocked: plan.items.filter(item => !item.eligible).length,
          message:
            workflow.assistedApplyMode === "copilot"
              ? "Assisted-apply plan prepared. The user must select and save the exact Copilot-assisted apply objects in the workflow webview. This tool does not select objects or write to SAP."
              : "Assisted-apply plan prepared. Open the workflow webview to review source and target. Only the user can stage a dirty target editor; saving and activation remain manual."
        },
        null,
        2
      )
    )
  }
}

function result(text: string) {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)])
}

async function showWorkflow(workflowId?: string): Promise<void> {
  await vscode.commands.executeCommand("abapfs.repositoryWorkflow", workflowId)
}

async function readArtifact(
  runtime: RepositoryWorkflowRuntime,
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>,
  input: GetWorkflowInput
) {
  const paths = {
    sourceDiscovery: ["discovery", "source", "tadir.jsonl"],
    targetDiscovery: ["discovery", "target", "tadir.jsonl"],
    existenceComparison: ["comparison", "existence.jsonl"],
    sourceComparison: ["comparison", "source.jsonl"],
    assistedApplyPlan: ["assisted-apply", "plan.json"]
  }
  const segments = paths[input.artifact!]
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)))
  const rows: Record<string, any>[] = []
  let matched = 0
  const values =
    input.artifact === "assistedApplyPlan"
      ? (JSON.parse(await fs.readFile(runtime.store.artifactPath(workflow, ...segments), "utf8"))
          .items ?? [])
      : runtime.store.readJsonLines<Record<string, any>>(
          runtime.store.artifactPath(workflow, ...segments)
        )
  for await (const row of values) {
    const record = row.source ?? row.target ?? row
    if (input.status && row.status !== input.status) continue
    if (input.objectName && !wildcard(input.objectName).test(record.objectName ?? row.key ?? ""))
      continue
    if (input.objectType && record.objectType !== input.objectType) continue
    if (input.packageName && record.packageName !== input.packageName) continue
    if (matched++ < offset) continue
    rows.push(row)
    if (rows.length >= limit) break
  }
  return { name: input.artifact, offset, limit, returned: rows.length, rows }
}

async function readObjectDiff(
  runtime: RepositoryWorkflowRuntime,
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>,
  input: GetWorkflowInput
) {
  const key = input.objectKey!.toUpperCase()
  const representation = input.representation ?? "formatted"
  let comparison: SourceComparisonRecord | undefined
  for await (const row of runtime.store.readJsonLines<SourceComparisonRecord>(
    runtime.store.artifactPath(workflow, "comparison", "source.jsonl")
  ))
    if (row.key === key) {
      comparison = row
      break
    }
  if (!comparison) throw new Error(`Object ${key} is not present in the source comparison`)
  if (representation === "formatted" && comparison.formattedError)
    throw new Error(`Formatted comparison is unavailable: ${comparison.formattedError}`)

  const id = objectFolderId(key)
  const sourceManifest = await readManifest(
    runtime.store.artifactPath(workflow, "sources", "source", "objects", id, "manifest.json")
  )
  const targetManifest = await readManifest(
    runtime.store.artifactPath(workflow, "sources", "target", "objects", id, "manifest.json")
  )
  if (!sourceManifest || !targetManifest) throw new Error(`Snapshots are missing for ${key}`)
  const sourceFiles = new Set(
    manifestFiles(sourceManifest, representation)
      .filter(file => file.text)
      .map(file => file.path)
  )
  const targetFiles = new Set(
    manifestFiles(targetManifest, representation)
      .filter(file => file.text)
      .map(file => file.path)
  )
  const candidates = diffCandidates(comparison, representation).filter(
    file => sourceFiles.has(file) || targetFiles.has(file)
  )
  const requestedPath = input.filePath?.replace(/\\/g, "/")
  if (requestedPath && !candidates.includes(requestedPath))
    throw new Error(`${requestedPath} is not a changed ${representation} text file for ${key}`)
  const maxFiles = Math.min(10, Math.max(1, Math.floor(input.maxFiles ?? 3)))
  const selected = requestedPath ? [requestedPath] : candidates.slice(0, maxFiles)
  let remainingChars = Math.min(100_000, Math.max(1_000, Math.floor(input.maxChars ?? 30_000)))
  const files: Array<Record<string, unknown>> = []
  for (const relativePath of selected) {
    if (remainingChars <= 0) break
    const source = sourceFiles.has(relativePath)
      ? await fs.readFile(
          snapshotPath(runtime, workflow, "source", id, representation, relativePath),
          "utf8"
        )
      : ""
    const target = targetFiles.has(relativePath)
      ? await fs.readFile(
          snapshotPath(runtime, workflow, "target", id, representation, relativePath),
          "utf8"
        )
      : ""
    const patch = createTwoFilesPatch(
      `target/${relativePath}`,
      `source/${relativePath}`,
      target,
      source,
      "target",
      "source",
      { context: 3 }
    )
    const bounded = boundText(patch, remainingChars)
    remainingChars -= bounded.text.length
    files.push({
      path: relativePath,
      sourcePresent: sourceFiles.has(relativePath),
      targetPresent: targetFiles.has(relativePath),
      patch: bounded.text,
      truncated: bounded.truncated
    })
    if (bounded.truncated) break
  }
  return {
    objectKey: key,
    representation,
    direction: "target-to-source",
    directionDescription:
      "Changes required to make the target match the source; removed lines are target content and added lines are source content.",
    availableFiles: candidates,
    returnedFiles: files.length,
    omittedFiles: candidates.length - files.length,
    truncated: files.some(file => file.truncated) || files.length < candidates.length,
    files
  }
}

async function readCopilotAssistedApplyObjects(
  runtime: RepositoryWorkflowRuntime,
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>,
  input: GetWorkflowInput
) {
  assertCopilotAssistedApplyEnabled(workflow)
  const selection = await runtime.store.getCopilotAssistedApplySelection(workflow.workflowId)
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)))
  if (!selection)
    return {
      saved: false,
      statistics: {
        total: 0,
        done: 0,
        pending: 0,
        decisions: { "as-is": 0, skip: 0, "needs-human": 0 }
      },
      includeDone: !!input.includeDone,
      offset,
      limit,
      returned: 0,
      hasMore: false,
      rows: []
    }
  const plan = JSON.parse(
    await fs.readFile(runtime.store.artifactPath(workflow, "assisted-apply", "plan.json"), "utf8")
  )
  const items = new Map<string, Record<string, any>>(
    (plan.items ?? []).map((item: Record<string, any>) => [item.key, item])
  )
  const completed = new Set(selection.completedKeys ?? [])
  const decisions = selection.decisions ?? {}
  const decisionReasons = selection.decisionReasons ?? {}
  const executionSummaries = await runtime.store.getAssistedApplyExecutionSummaries(
    workflow.workflowId
  )
  const visibleKeys = input.includeDone
    ? selection.keys
    : selection.keys.filter(key => !completed.has(key))
  const rows = visibleKeys.slice(offset, offset + limit).flatMap(key => {
    const item = items.get(key)
    if (!item?.eligible) return []
    return [
      {
        key,
        status: completed.has(key) ? "done" : "pending",
        decision: decisions[key] ?? "needs-human",
        decisionReason: decisionReasons[key] ?? "",
        objectName: item.sourceRecord?.objectName,
        objectType: item.sourceRecord?.objectType,
        packageName: item.sourceRecord?.packageName,
        transportCheckStatus: item.transportCheckStatus ?? "not-checked",
        transportRequest: item.transportRequest ?? "",
        transportDescription: item.transportDescription ?? "",
        transportCheckedAt: item.transportCheckedAt,
        transportCheckError: item.transportCheckError,
        sourceHash: item.sourceHash,
        targetHash: item.targetHash,
        execution: executionSummaries[key]
      }
    ]
  })
  return {
    saved: true,
    updatedAt: selection.updatedAt,
    statistics: {
      total: selection.keys.length,
      done: selection.keys.filter(key => completed.has(key)).length,
      pending: selection.keys.filter(key => !completed.has(key)).length,
      decisions: {
        "as-is": selection.keys.filter(key => decisions[key] === "as-is").length,
        skip: selection.keys.filter(key => decisions[key] === "skip").length,
        "needs-human": selection.keys.filter(
          key => (decisions[key] ?? "needs-human") === "needs-human"
        ).length
      }
    },
    includeDone: !!input.includeDone,
    offset,
    limit,
    returned: rows.length,
    hasMore: offset + limit < visibleKeys.length,
    nextOffset: offset + limit < visibleKeys.length ? offset + limit : undefined,
    rows
  }
}

function assertCopilotAssistedApplyEnabled(
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>
) {
  if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
    throw new Error("Copilot-assisted apply is not enabled for this workflow")
}

function manifestFiles(manifest: ObjectSnapshotManifest, representation: SnapshotRepresentation) {
  return representation === "raw" ? manifest.files : (manifest.formattedFiles ?? [])
}

function diffCandidates(
  comparison: SourceComparisonRecord,
  representation: SnapshotRepresentation
): string[] {
  const values =
    representation === "raw"
      ? [
          ...(comparison.rawAdded ?? comparison.added),
          ...(comparison.rawRemoved ?? comparison.removed),
          ...(comparison.rawChanged ?? comparison.changed)
        ]
      : [
          ...(comparison.formattedAdded ?? []),
          ...(comparison.formattedRemoved ?? []),
          ...(comparison.formattedChanged ?? [])
        ]
  return [...new Set(values)].sort()
}

function snapshotPath(
  runtime: RepositoryWorkflowRuntime,
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>,
  side: "source" | "target",
  id: string,
  representation: SnapshotRepresentation,
  relativePath: string
): string {
  return runtime.store.artifactPath(
    workflow,
    "sources",
    side,
    "objects",
    id,
    representation,
    ...relativePath.split("/")
  )
}

async function readManifest(filePath: string): Promise<ObjectSnapshotManifest | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as ObjectSnapshotManifest
  } catch {
    return undefined
  }
}

function boundText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  const end = value.lastIndexOf("\n", limit)
  return {
    text: `${value.slice(0, end > 0 ? end : limit)}\n... diff truncated ...\n`,
    truncated: true
  }
}

async function readSummaries(
  runtime: RepositoryWorkflowRuntime,
  workflow: Awaited<ReturnType<RepositoryWorkflowRuntime["store"]["get"]>>
) {
  const summaries: Record<string, unknown> = {}
  for (const [name, segments] of Object.entries({
    sourceDiscovery: ["discovery", "source", "summary.json"],
    targetDiscovery: ["discovery", "target", "summary.json"],
    existenceComparison: ["comparison", "existence-summary.json"],
    sourceComparison: ["comparison", "source-summary.json"]
  })) {
    try {
      summaries[name] = JSON.parse(
        await fs.readFile(runtime.store.artifactPath(workflow, ...segments), "utf8")
      )
    } catch {}
  }
  return summaries
}

function wildcard(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i")
}

export function registerRepositoryWorkflowTools(context: vscode.ExtensionContext) {
  RepositoryWorkflowRuntime.get(context)
  context.subscriptions.push(
    registerToolWithRegistry("abapfs_list_repository_workflows", new ListRepositoryWorkflowsTool()),
    registerToolWithRegistry("abapfs_get_repository_workflow", new GetRepositoryWorkflowTool()),
    registerToolWithRegistry(
      "abapfs_create_repository_workflow",
      new CreateRepositoryWorkflowTool()
    ),
    registerToolWithRegistry(
      "abapfs_update_repository_workflow_criteria",
      new UpdateRepositoryWorkflowCriteriaTool()
    ),
    registerToolWithRegistry(
      "abapfs_run_repository_workflow_step",
      new RunRepositoryWorkflowTool()
    ),
    registerToolWithRegistry("abapfs_open_repository_workflow", new OpenRepositoryWorkflowTool()),
    registerToolWithRegistry(
      "abapfs_prepare_repository_assisted_apply",
      new PrepareRepositoryAssistedApplyTool()
    )
  )
}
