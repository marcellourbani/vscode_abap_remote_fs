import * as vscode from "vscode"
import * as fs from "fs/promises"
import { connectedRoots } from "../../config"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"
import { RepositoryWorkflowRuntime } from "../repositoryWorkflow/runtime"
import { defaultWorkflowName } from "../repositoryWorkflow/workflowStore"

interface WorkflowIdInput {
  workflowId: string
}

interface GetWorkflowInput extends WorkflowIdInput {
  include?: Array<"state" | "criteria" | "summaries" | "artifact">
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

class GetRepositoryWorkflowTool implements vscode.LanguageModelTool<GetWorkflowInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetWorkflowInput>
  ) {
    const requested = options.input.include?.length
      ? options.input.include.join(", ")
      : options.input.artifact
        ? options.input.artifact
        : "state"
    return {
      invocationMessage: `Reading repository workflow ${requested} for ${options.input.workflowId}`
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

class PrepareRepositoryAssistedApplyTool implements vscode.LanguageModelTool<WorkflowIdInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<WorkflowIdInput>
  ) {
    return {
      invocationMessage: `Preparing assisted-apply plan for ${options.input.workflowId}`
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<WorkflowIdInput>) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    await showWorkflow(options.input.workflowId)
    runtime.notifyChanged(options.input.workflowId, true)
    const plan = await runtime.runWithRefreshBatch(options.input.workflowId, () =>
      runtime.engine.prepareAssistedApply(options.input.workflowId)
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
    return result(
      JSON.stringify(
        {
          workflowId: options.input.workflowId,
          eligible: plan.items.filter(item => item.eligible).length,
          blocked: plan.items.filter(item => !item.eligible).length,
          message:
            "Assisted-apply plan prepared. Open the workflow webview to review source and target. Only the user can stage a dirty target editor; saving and activation remain manual."
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
