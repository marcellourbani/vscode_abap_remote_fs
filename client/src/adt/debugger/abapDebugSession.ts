import { DebugConfiguration, DebugSession, Uri } from "vscode"
import { InitializedEvent, LoggingDebugSession, Thread } from "vscode-debugadapter"
import { DEBUGTYPE } from "./abapConfigurationProvider"
import { DebugProtocol } from 'vscode-debugprotocol'
import { getRoot } from "../conections"
import { isAbapFile } from "abapfs"
import { caughtToString } from "../../lib"
import { DebugListener, errorType } from "./debugListener"

export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string,
    debugUser: string,
    terminalMode: boolean
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {
    private closed?: () => void
    private static sessions = new Map<string, AbapDebugSession>()
    public static get activeSessions() {
        return this.sessions.size
    }
    private lasttargetId = 0
    static byConnection(connId: string) {
        return AbapDebugSession.sessions.get(connId)
    }

    constructor(private connId: string, private readonly listener: DebugListener) {
        super(DEBUGTYPE)
        if (AbapDebugSession.sessions.has(connId)) throw new Error(`Debug session already running on ${connId}`)
        AbapDebugSession.sessions.set(connId, this)
        listener.addListener(e => this.sendEvent(e))
    }

    protected dispatchRequest(request: DebugProtocol.Request) {
        super.dispatchRequest(request)
    }
    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source, breakpoints = [] } = args
        const bpps = await this.listener.breakpointManager.setBreakpoints(source, breakpoints)
        response.body = { breakpoints: bpps }
        this.sendResponse(response)
    }


    public async logOut() {
        await this.listener.logout()
        AbapDebugSession.sessions.delete(this.connId)
        if (this.closed) this.closed()
    }
    public onClose(closeCb: () => void) {
        this.closed = closeCb
    }


    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: this.listener.activeServices().map(([id, s]) => new Thread(id, `${s.debuggee.NAME} ${id}`)) }
        this.sendResponse(response)
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
        const service = this.listener.service(args.threadId)
        await service.debuggerStep("stepInto", args.threadId)
        this.sendResponse(response)
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
        const service = this.listener.service(args.threadId)
        await service.debuggerStep("stepContinue", args.threadId)
        if (!response.body) response.body = {}
        response.body.allThreadsContinued = false
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        const service = this.listener.service(args.threadId)
        await service.debuggerStep("stepOver", args.threadId)
        this.sendResponse(response)
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
        const service = this.listener.service(args.threadId)
        await service.debuggerStep("stepReturn", args.threadId)
        this.sendResponse(response)
    }


    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
        await this.logOut()
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        response.success = await this.listener.fireMainLoop()
        if (!response.success) {
            response.message = "Could not attach to process"
        }
        this.sendResponse(response)
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendResponse(response)
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const service = this.listener.service(args.threadId)
        const stackFrames = service.getStack()
        response.body = {
            stackFrames,
            totalFrames: stackFrames.length
        }
        this.sendResponse(response)
    }

    protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
        if (args.source.path) {
            const bps = this.listener.breakpointManager.getBreakpoints(args.source.path)
            response.body = { breakpoints: bps.map(_ => ({ line: args.line, column: 0 })) }
        } else response.body = { breakpoints: [] }

        this.sendResponse(response)
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        response.body = { scopes: await this.listener.variableManager.getScopes(args.frameId) }
        this.sendResponse(response)
    }
    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments, request?: DebugProtocol.Request) {
        const { value, success } = await this.listener.variableManager.setVariable(args.variablesReference, args.name, args.value)
        response.body = { value }
        response.success = success
        this.sendResponse(response)
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {
        response.body = { variables: await this.listener.variableManager.getVariables(args.variablesReference) }
        this.sendResponse(response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request) {
        const v = await this.listener.variableManager.evaluate(args.expression, args.frameId)
        if (v) response.body = v
        else response.success = false
        this.sendResponse(response)
    }

    protected async gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments, request?: DebugProtocol.Request) {
        response.success = false
        const target = this.targets.get(args.targetId)
        this.targets.delete(args.targetId)
        if (target?.instructionPointerReference) {
            try {
                const service = this.listener.service(args.threadId)
                await service.debuggerStep("stepJumpToLine", args.threadId, target.instructionPointerReference)
                response.success = true
            } catch (error) {
                response.message = errorType(error) === "stepNotPossible" ? "Can't jump to this location" : caughtToString(error)
            }
        }
        this.sendResponse(response)
    }
    private targets = new Map<number, DebugProtocol.GotoTarget>()
    protected async gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments, request?: DebugProtocol.Request) {
        response.success = false
        try {

            if (args.source?.path) {
                const uri = Uri.parse(args.source.path)
                const root = getRoot(this.connId)
                const n = await root.getNodeAsync(uri.path)
                if (isAbapFile(n)) {
                    const id = this.lasttargetId++
                    if (!n.object.structure) await n.object.loadStructure()
                    const url = `${n.object.contentsPath()}#start=${args.line}`
                    const target = { id, label: args.source.name || "", line: args.line, instructionPointerReference: url }
                    this.targets.set(id, target)
                    response.success = true
                    response.body = { targets: [target] }
                }
            }
        } catch (error) { /* */ }
        this.sendResponse(response)
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = {
            supportsBreakpointLocationsRequest: true,
            supportsGotoTargetsRequest: true,
            supportsCancelRequest: true,
            supportsStepInTargetsRequest: true,
            supportsConfigurationDoneRequest: true,
            supportsTerminateRequest: true,
            supportsEvaluateForHovers: true,
            supportsSetVariable: true,
        }

        this.sendResponse(response)
        this.sendEvent(new InitializedEvent())
    }

}