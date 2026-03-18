import {
  InitializedEvent, LoggingDebugSession,
  StoppedEvent, Thread, Source, TerminatedEvent
} from "@vscode/debugadapter"
import { DebugProtocol } from "@vscode/debugprotocol"
import { DebugRecording, DebugSnapshot, REPLAY_DEBUG_TYPE } from "./types"
import { ReplayVariableManager } from "./replayVariableManager"

const REPLAY_THREAD_ID = 1

/**
 * A read-only debug adapter that replays a recorded ABAP debug session.
 * Supports forward and backward stepping via DAP's supportsStepBack.
 */
export class ReplayDebugSession extends LoggingDebugSession {
  private currentStep = 0
  private variableManager = new ReplayVariableManager()
  private sourceRefMap = new Map<number, string>()
  private nextSourceRef = 1

  constructor(private recording: DebugRecording) {
    super(REPLAY_DEBUG_TYPE)
  }

  private get snapshot(): DebugSnapshot {
    return this.recording.snapshots[this.currentStep]
  }

  private get totalSteps(): number {
    return this.recording.snapshots.length
  }

  // -- Initialization --

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    response.body = {
      supportsStepBack: true,
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsGotoTargetsRequest: false,
      supportsBreakpointLocationsRequest: false,
      supportsCancelRequest: false,
      supportsTerminateRequest: true,
      supportsLoadedSourcesRequest: false,
      // Disable stepping granularity — all forward steps behave identically
      // (advance to next recorded snapshot). VS Code always shows Step Over,
      // Step Into, Step Out buttons but in replay they all do the same thing.
      supportsSteppingGranularity: false
    }
    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    _args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.sendResponse(response)
    if (this.totalSteps === 0) {
      this.sendEvent(new TerminatedEvent())
      return
    }
    // Start at step 0 and immediately show it
    this.sendEvent(new StoppedEvent("entry", REPLAY_THREAD_ID))
  }

  // -- Launch --

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    _args: DebugProtocol.LaunchRequestArguments
  ): void {
    this.currentStep = 0
    this.sendResponse(response)
  }

  // -- Threads --

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [new Thread(REPLAY_THREAD_ID, `⏺ Recording Replay — step ${this.currentStep + 1}/${this.totalSteps} — all step buttons = next step`)]
    }
    this.sendResponse(response)
  }

  // -- Stack Trace --

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments
  ): void {
    const snap = this.snapshot
    const frames: DebugProtocol.StackFrame[] = snap.stack.map((f, idx) => {
      const sourceRef = this.getSourceRef(f.sourcePath)
      const source = new Source(f.name, f.sourcePath)
      source.sourceReference = sourceRef
      return {
        id: idx,
        name: f.name,
        source,
        line: f.line,
        column: 0
      }
    })
    response.body = { stackFrames: frames, totalFrames: frames.length }
    this.sendResponse(response)
  }

  private getSourceRef(path: string): number {
    for (const [ref, p] of this.sourceRefMap) {
      if (p === path) return ref
    }
    const ref = this.nextSourceRef++
    this.sourceRefMap.set(ref, path)
    return ref
  }

  // -- Scopes & Variables --

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    // Scopes are only captured for the top frame (frame 0).
    // For other frames, return empty scopes.
    const isTopFrame = args.frameId === 0
    if (isTopFrame) {
      response.body = { scopes: this.variableManager.getScopes(this.snapshot) }
    } else {
      response.body = { scopes: [] }
    }
    this.sendResponse(response)
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    response.body = {
      variables: this.variableManager.getVariables(args.variablesReference)
    }
    this.sendResponse(response)
  }

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    const result = this.variableManager.evaluate(args.expression, this.snapshot)
    if (result) {
      response.body = result
    } else {
      response.success = false
      response.message = "Variable not found in recording"
    }
    this.sendResponse(response)
  }

  // -- Forward stepping --

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.totalSteps)
  }

  // -- Backward stepping --

  protected stepBackRequest(
    response: DebugProtocol.StepBackResponse,
    _args: DebugProtocol.StepBackArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep - 1)
  }

  protected reverseContinueRequest(
    response: DebugProtocol.ReverseContinueResponse,
    _args: DebugProtocol.ReverseContinueArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(0)
  }

  // -- Navigation --

  private stepTo(target: number): void {
    if (target >= this.totalSteps) {
      this.sendEvent(new TerminatedEvent())
      return
    }
    this.currentStep = Math.max(0, Math.min(target, this.totalSteps - 1))
    this.variableManager.reset()
    this.sendEvent(new StoppedEvent("step", REPLAY_THREAD_ID))
  }

  // -- Lifecycle --

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): void {
    this.sendResponse(response)
  }

  protected terminateRequest(
    response: DebugProtocol.TerminateResponse,
    _args: DebugProtocol.TerminateArguments
  ): void {
    this.sendResponse(response)
    this.sendEvent(new TerminatedEvent())
  }

  // Replay is always stopped, pause is a no-op
  protected pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this.sendResponse(response)
  }

  // -- Breakpoints (no-op for replay) --

  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    response.body = {
      breakpoints: (args.breakpoints || []).map(bp => ({
        verified: false,
        line: bp.line,
        message: "Breakpoints not supported in replay mode"
      }))
    }
    this.sendResponse(response)
  }

  // -- Source --

  protected sourceRequest(
    response: DebugProtocol.SourceResponse,
    args: DebugProtocol.SourceArguments
  ): void {
    const path = args.source?.path
      || (args.sourceReference ? this.sourceRefMap.get(args.sourceReference) : undefined)
      || ""
    const content = this.recording.sources?.[path]
    response.body = { content: content ?? "[source unavailable in recording]" }
    this.sendResponse(response)
  }
}
