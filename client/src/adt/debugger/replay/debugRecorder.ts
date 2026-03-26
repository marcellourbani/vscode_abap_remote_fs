import { ADTClient } from "abap-adt-api"
import { Uri, workspace } from "vscode"
import { funWindow as window } from "../../../services/funMessenger"
import { log, caughtToString } from "../../../lib"
import {
  DebugSnapshot, DebugRecording, CapturedScope,
  CapturedStackFrame, CapturedVariable, CaptureOptions, DEFAULT_CAPTURE_OPTIONS
} from "./types"
import { captureScopesBatched } from "./variableCapture"

export class DebugRecorder {
  private snapshots: DebugSnapshot[] = []
  private sourceCache = new Map<string, string>()
  private recording = false
  private startTime = 0
  private connId = ""

  get isRecording() { return this.recording }
  get stepCount() { return this.snapshots.length }

  constructor(private options: CaptureOptions = DEFAULT_CAPTURE_OPTIONS) {}

  startRecording(connId: string) {
    this.recording = true
    this.snapshots = []
    this.sourceCache.clear()
    this.startTime = Date.now()
    this.connId = connId
    log(`Replay recorder started for ${connId}`)
  }

  async captureSnapshot(
    client: ADTClient,
    threadId: number,
    stackInfo: CapturedStackFrame[]
  ): Promise<void> {
    if (!this.recording) return

    try {
      const scopes = await captureScopesBatched(client, this.options)
      const changedVars = this.detectChanges(scopes, threadId)
      await this.cacheSources(stackInfo)

      if (!this.recording) return // stopped during async capture
      if (this.snapshots.length >= this.options.maxSteps) {
        this.recording = false
        window.showWarningMessage(
          `Recording stopped: reached ${this.options.maxSteps} step limit`
        )
        return
      }
      this.snapshots.push({
        stepNumber: this.snapshots.length,
        timestamp: Date.now(),
        threadId,
        stack: stackInfo,
        scopes,
        changedVars
      })
    } catch (error) {
      log(`Replay recorder capture failed: ${caughtToString(error)}`)
    }
  }

  private detectChanges(currentScopes: CapturedScope[], threadId: number): string[] {
    // Compare against last snapshot from the same thread to avoid cross-thread noise
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].threadId === threadId) {
        return diffScopeVariables(this.snapshots[i].scopes, currentScopes)
      }
    }
    return []
  }

  private async cacheSources(stack: CapturedStackFrame[]): Promise<void> {
    for (const frame of stack) {
      const key = frame.sourcePath
      if (key && !this.sourceCache.has(key)) {
        try {
          const data = await workspace.fs.readFile(Uri.parse(key))
          this.sourceCache.set(key, Buffer.from(data).toString("utf-8"))
        } catch {
          // source not retrievable — replay will show [source unavailable]
        }
      }
    }
  }

  async stopRecording(): Promise<DebugRecording | undefined> {
    this.recording = false
    if (this.snapshots.length === 0) return undefined
    const recording: DebugRecording = {
      version: 1,
      recordedAt: new Date().toISOString(),
      connectionId: this.connId,
      totalSteps: this.snapshots.length,
      duration: Date.now() - this.startTime,
      snapshots: this.snapshots,
      sources: Object.fromEntries(this.sourceCache)
    }
    log(`Replay recorder stopped: ${this.snapshots.length} steps`)
    this.snapshots = []
    this.sourceCache.clear()
    return recording
  }
}

function diffScopeVariables(
  prev: CapturedScope[],
  curr: CapturedScope[]
): string[] {
  const changed: string[] = []
  const prevMap = buildVarMap(prev)
  const currMap = buildVarMap(curr)

  for (const [key, value] of currMap) {
    const prevValue = prevMap.get(key)
    if (prevValue !== value) changed.push(key)
  }
  return changed
}

function buildVarMap(scopes: CapturedScope[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const scope of scopes) {
    flattenVars(scope.variables, scope.name, map)
  }
  return map
}

function flattenVars(
  vars: CapturedVariable[],
  prefix: string,
  map: Map<string, string>
): void {
  for (const v of vars) {
    const key = `${prefix}.${v.name}`
    map.set(key, v.value)
    if (v.children && !v.skipped) {
      flattenVars(v.children, key, map)
    }
  }
}
