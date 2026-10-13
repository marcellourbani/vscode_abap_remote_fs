import * as vscode from "vscode"
import { RepositoryWorkflowRuntime } from "../repositoryWorkflow/runtime"
import type { ObjectSaveTransportChoice } from "../transportIntentService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

export interface ApplyRepositoryWorkflowObjectInput {
  workflowId: string
  objectKey: string
  transportChoice: ObjectSaveTransportChoice
}

export class ApplyRepositoryWorkflowObjectTool implements vscode.LanguageModelTool<ApplyRepositoryWorkflowObjectInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ApplyRepositoryWorkflowObjectInput>
  ) {
    const choice = options.input.transportChoice
    const transport =
      choice.type === "local"
        ? "the object's local transport status"
        : choice.type === "existing"
          ? `existing request ${choice.number}`
          : `a new request with description "${choice.description}"`
    return {
      invocationMessage: `Applying selected repository object ${options.input.objectKey}`,
      confirmationMessages: {
        title: "Apply Selected Repository Workflow Object",
        message: new vscode.MarkdownString(
          `Stage and save every applicable changed text resource for \`${options.input.objectKey}\` from workflow ` +
            `\`${options.input.workflowId}\` using ${transport}? The object must be in the ` +
            "user-saved Copilot selection with an as-is decision."
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ApplyRepositoryWorkflowObjectInput>,
    token: vscode.CancellationToken
  ) {
    assertToolInvocationAuthorized(options)
    const runtime = RepositoryWorkflowRuntime.get()
    await runtime.ready
    const result = await runtime.engine.applyCopilotAssistedObject(
      options.input.workflowId,
      options.input.objectKey,
      options.input.transportChoice,
      token
    )
    runtime.notifyChanged(options.input.workflowId)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        JSON.stringify(
          {
            workflowId: options.input.workflowId,
            ...result,
            activationRequired: result.status === "succeeded",
            markedDone: false
          },
          null,
          2
        )
      )
    ])
  }
}

export function registerApplyRepositoryWorkflowObjectTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry(
      "abapfs_apply_repository_workflow_object",
      new ApplyRepositoryWorkflowObjectTool()
    )
  )
}
