import * as vscode from "vscode"
import { EventEmitter } from "events"
import { RepositoryWorkflowEngine } from "./workflowEngine"
import { WorkflowStore } from "./workflowStore"

export interface RepositoryWorkflowChange {
  workflowId: string
  focus: boolean
  progress?: boolean
}

export class RepositoryWorkflowRuntime extends EventEmitter {
  private static instance: RepositoryWorkflowRuntime | undefined
  readonly store: WorkflowStore
  readonly engine: RepositoryWorkflowEngine
  readonly ready: Promise<void>

  private constructor(context: vscode.ExtensionContext) {
    super()
    this.store = new WorkflowStore(context)
    this.engine = new RepositoryWorkflowEngine(this.store)
    this.engine.on("changed", workflow => this.notifyChanged(workflow.workflowId))
    this.engine.on("progress", workflow => this.notifyChanged(workflow.workflowId, false, true))
    this.ready = this.store.initialize()
  }

  notifyChanged(workflowId: string, focus = false, progress = false) {
    this.emit("changed", { workflowId, focus, progress } satisfies RepositoryWorkflowChange)
  }

  static get(context?: vscode.ExtensionContext) {
    if (!this.instance) {
      if (!context) throw new Error("Repository workflow runtime is not initialized")
      this.instance = new RepositoryWorkflowRuntime(context)
    }
    return this.instance
  }
}
