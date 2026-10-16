import * as vscode from "vscode"
import { RepositoryWorkflowRuntime } from "../repositoryWorkflow/runtime"
import { isAttemptForPlanItem } from "../repositoryWorkflow/workflowStore"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

interface RecordRepositoryWorkflowObjectActivationInput {
  workflowId: string
  objectKey: string
  attemptId: string
  status: "succeeded" | "failed"
  activationObjectUrls: string[]
  error?: string
}

export class RecordRepositoryWorkflowObjectActivationTool implements vscode.LanguageModelTool<RecordRepositoryWorkflowObjectActivationInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RecordRepositoryWorkflowObjectActivationInput>
  ) {
    return {
      invocationMessage: `Recording ${options.input.status} activation for ${options.input.objectKey}`,
      confirmationMessages: {
        title: "Record Repository Workflow Activation",
        message: new vscode.MarkdownString(
          `Record activation as **${options.input.status}** for \`${options.input.objectKey}\`? ` +
            (options.input.status === "succeeded"
              ? "This will mark the selected object done."
              : "The selected object will remain pending.")
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RecordRepositoryWorkflowObjectActivationInput>
  ) {
    assertToolInvocationAuthorized(options)
    const input = options.input
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    const workflow = await runtime.store.get(input.workflowId)
    if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
      throw new Error("Copilot-assisted apply is not enabled for this workflow")
    const objectKey = input.objectKey.trim().toUpperCase()
    const selection = await runtime.store.getCopilotAssistedApplySelection(
      workflow.workflowId,
      workflow
    )
    if (!selection?.keys.includes(objectKey))
      throw new Error(`${objectKey} is not in the user-saved Copilot-assisted apply selection`)
    const events = await runtime.store.getAssistedApplyExecutionEvents(
      workflow.workflowId,
      objectKey
    )
    const attemptEvents = events.filter(event => event.attemptId === input.attemptId)
    if (!attemptEvents.length)
      throw new Error(`Apply attempt not found for ${objectKey}: ${input.attemptId}`)
    if (!attemptEvents.some(event => event.stage === "apply" && event.status === "succeeded"))
      throw new Error("Activation can be recorded only after a fully verified apply attempt")
    const planItem = await runtime.store.getAssistedApplyPlanItem(workflow, objectKey)
    if (!planItem || !isAttemptForPlanItem(attemptEvents, input.attemptId, planItem))
      throw new Error(
        "The apply attempt does not belong to the current assisted-apply plan. Apply the object again."
      )
    const activationObjectUrls = [
      ...new Set(input.activationObjectUrls.map(url => url.trim()).filter(Boolean))
    ]
    if (!activationObjectUrls.length)
      throw new Error("At least one exact activated object URL is required")
    if (input.status === "failed" && !input.error?.trim())
      throw new Error("An activation error is required when activation failed")
    const event = await runtime.store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
      attemptId: input.attemptId,
      objectKey,
      stage: "activation",
      status: input.status,
      sourceHash: planItem.sourceHash,
      targetHash: planItem.targetHash,
      activationObjectUrls,
      error: input.error?.trim() || undefined
    })
    if (input.status === "succeeded") {
      await runtime.store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
        attemptId: input.attemptId,
        objectKey,
        stage: "completion",
        status: "succeeded",
        sourceHash: planItem.sourceHash,
        targetHash: planItem.targetHash,
        activationObjectUrls
      })
      await runtime.store.updateCopilotAssistedApplyStatus(workflow.workflowId, [objectKey], "done")
    }
    runtime.notifyChanged(workflow.workflowId)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        JSON.stringify(
          {
            workflowId: workflow.workflowId,
            objectKey,
            attemptId: input.attemptId,
            activation: event,
            markedDone: input.status === "succeeded"
          },
          null,
          2
        )
      )
    ])
  }
}

export function registerRecordRepositoryWorkflowObjectActivationTool(
  context: vscode.ExtensionContext
) {
  context.subscriptions.push(
    registerToolWithRegistry(
      "abapfs_record_repository_workflow_object_activation",
      new RecordRepositoryWorkflowObjectActivationTool()
    )
  )
}
