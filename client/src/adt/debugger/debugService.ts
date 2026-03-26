import { ADTClient, Debuggee, DebugStepType, session_types, isAdtError } from "abap-adt-api"
import { newClientFromKey } from "./functions"
import { log, caughtToString, ignore } from "../../lib"
import { DebugProtocol } from "@vscode/debugprotocol"
import { Disposable, EventEmitter } from "vscode"
import { ContinuedEvent, Source, StoppedEvent, ThreadEvent } from "@vscode/debugadapter"
import { vsCodeUri } from "../../langClient"
import { DebugListener, errorType, THREAD_EXITED } from "./debugListener"
import { CapturedStackFrame } from "./replay/types"

interface RawStackEntry {
  adtUri: string
  line: number
  stackPosition: number
  stackUri?: string
}
export const STACK_THREAD_MULTIPLIER = 1000000000000

export interface DebuggerUI {
  Confirmator: (message: string) => Thenable<boolean>
  ShowError: (message: string) => any
}

interface StackFrame extends DebugProtocol.StackFrame {
  stackPosition: number
  stackUri?: string
}

export const idThread = (frameId: number) => Math.floor(frameId / STACK_THREAD_MULTIPLIER)
export const isEnded = (error: any) => errorType(error) === "debuggeeEnded"

export class DebugService {
  private killed = false
  private notifier: EventEmitter<DebugProtocol.Event> = new EventEmitter()
  private listeners: Disposable[] = []
  private _stackTrace: StackFrame[] = []
  private _rawStack: RawStackEntry[] = []
  public threadId: number = 0

  constructor(
    private connId: string,
    private _client: ADTClient,
    private listener: DebugListener,
    readonly debuggee: Debuggee,
    private ui: DebuggerUI
  ) {}

  get client() {
    if (this.killed) throw new Error("Disconnected")
    return this._client
  }
  get stackTrace() {
    return this._stackTrace
  }
  private get mode() {
    return this.listener.mode
  }

  private get username() {
    return this.listener.username
  }

  public static async create(
    connId: string,
    ui: DebuggerUI,
    listener: DebugListener,
    debuggee: Debuggee
  ) {
    log(`DebugService.create: connId="${connId}", debuggee=${debuggee.DEBUGGEE_ID}`)
    const client = await newClientFromKey(connId, { timeout: 7200000 })
    if (!client) throw new Error(`Unable to create client for ${connId}`)
    client.stateful = session_types.stateful
    log(`DebugService.create: running adtCoreDiscovery`)
    await client.adtCoreDiscovery()
    log(`DebugService.create: success`)
    const service = new DebugService(connId, client, listener, debuggee, ui)
    return service
  }
  public async attach() {
    log(`DebugService.attach: attaching to ${this.debuggee.DEBUGGEE_ID}`)
    await this.client.debuggerAttach(this.mode, this.debuggee.DEBUGGEE_ID, this.username, true)
    log(`DebugService.attach: attached, saving settings`)
    // Fire saveSettings in background - not critical for attach
    this.client.debuggerSaveSettings({}).catch(e => {
      log(`debuggerSaveSettings failed: ${caughtToString(e)}`)
    })
    log(`DebugService.attach: updating stack`)
    await this.updateStack()
    log(`DebugService.attach: stack updated, capturing replay`)
    await this.awaitReplayCapture(this.threadId)
    log(`DebugService.attach: done`)
  }

  addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
    return this.notifier.event(listener, thisArg, this.listeners)
  }

  getStack() {
    return this._stackTrace
  }

  private async baseDebuggerStep(threadId: number, stepType: DebugStepType, url?: string) {
    this.notifier.fire(new ContinuedEvent(threadId))
    if (stepType === "stepRunToLine" || stepType === "stepJumpToLine") {
      if (!url) throw new Error(`Debugger step ${stepType} requires a target`)
      return this.client.debuggerStep(stepType, url)
    }
    return this.client.debuggerStep(stepType)
  }

  public async debuggerStep(stepType: DebugStepType, threadId: number, url?: string) {
    try {
      const res = await this.baseDebuggerStep(threadId, stepType, url)
      await this.updateStack()
      await this.awaitReplayCapture(threadId)
      this.notifier.fire(new StoppedEvent("step", threadId))
      return res
    } catch (error) {
      if (!isAdtError(error)) {
        this.ui.ShowError(`Error in debugger stepping: ${caughtToString(error)}`)
      } else {
        if (stepType === "stepRunToLine" || stepType === "stepJumpToLine") throw error
        if (!isEnded(error))
          this.ui.ShowError(error?.message || "unknown error in debugger stepping")
        this.notifier.fire(new ThreadEvent(THREAD_EXITED, threadId))
      }
    }
  }

  private async updateStack() {
    const stackInfo = await this.client.debuggerStackTrace(false).catch(() => undefined)
    this.listener.variableManager.resetHandle(this.threadId)
    const createFrame = (
      path: string,
      line: number,
      id: number,
      stackPosition: number,
      stackUri?: string
    ) => {
      const name = path.replace(/.*\//, "")
      const source = new Source(name, path)
      const frame: StackFrame = { id, name, source, line, column: 0, stackPosition }
      return frame
    }
    if (stackInfo) {
      this._rawStack = stackInfo.stack.map(s => ({
        adtUri: s.uri.uri,
        line: s.line,
        stackPosition: s.stackPosition,
        stackUri: "stackUri" in s ? s.stackUri : undefined
      }))
      const stackp = stackInfo.stack.map(async (s, id) => {
        id = id + this.threadId * STACK_THREAD_MULTIPLIER
        try {
          const path = await vsCodeUri(this.connId, s.uri.uri, true, true)
          const stackUri = "stackUri" in s ? s.stackUri : undefined
          return createFrame(path, s.line, id, s.stackPosition, stackUri)
        } catch (error) {
          log(caughtToString(error))
          return createFrame("unknown", 0, id, NaN)
        }
      })
      this._stackTrace = (await Promise.all(stackp)).filter(s => !!s)
    }
  }

  private async awaitReplayCapture(threadId: number): Promise<void> {
    if (this.killed) return
    if (!this.listener.shouldRecordThread(threadId)) return
    const recorder = this.listener.recorder
    if (!recorder?.isRecording) return
    const stackFrames = this.buildCapturedStack()
    try {
      await recorder.captureSnapshot(this.client, threadId, stackFrames)
    } catch (e) {
      log(`Replay capture error: ${caughtToString(e)}`)
    }
  }

  private buildCapturedStack(): CapturedStackFrame[] {
    return this._stackTrace.map((f, idx) => {
      const raw = this._rawStack[idx]
      return {
        name: f.name,
        sourcePath: f.source?.path || "",
        adtUri: raw?.adtUri || "",
        line: f.line,
        stackPosition: f.stackPosition
      }
    })
  }

  public async logout() {
    if (this.killed) return
    const client = this.client
    this.killed = true
    // Dispose all event listeners to prevent memory leaks
    this.listeners.forEach(l => l.dispose())
    this.listeners = []
    this.notifier.dispose()
    await client.statelessClone.logout().catch(ignore)
    await client.logout()
  }
}
