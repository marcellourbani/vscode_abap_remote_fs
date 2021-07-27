import { commands, DebugConfiguration, DebugSession, Disposable } from "vscode"
import { InitializedEvent, LoggingDebugSession, TerminatedEvent, Thread } from "vscode-debugadapter"
import { DEBUGTYPE } from "./abapConfigurationProvider"
import { DebugProtocol } from 'vscode-debugprotocol'
import { DebugService, isRequestTerminationEvent } from "./debugService"
import { AbapDebugAdapterFactory } from "./AbapDebugAdapterFactory"

export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string,
    debugUser: string,
    terminalMode: boolean
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {
    private sub: Disposable
    private static sessions = new Map<string, AbapDebugSession>()
    static byConnection(connId: string) {
        return AbapDebugSession.sessions.get(connId)
    }

    constructor(private connId: string, private readonly service: DebugService) {
        super(DEBUGTYPE)
        if (AbapDebugSession.sessions.has(connId)) throw new Error(`Debug session already running on ${connId}`)
        AbapDebugSession.sessions.set(connId, this)
        this.sub = service.addListener(e => {
            if (isRequestTerminationEvent(e))
                this.logOut(true)
            else
                this.sendEvent(e)
        })
    }

    protected dispatchRequest(request: DebugProtocol.Request) {
        super.dispatchRequest(request)
    }
    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source, breakpoints = [] } = args
        response.body = { breakpoints: await this.service.setBreakpoints(source, breakpoints) }
        this.sendResponse(response)
    }


    public async logOut(notify = false) {
        AbapDebugSession.sessions.delete(this.connId)
        if (this.service) {
            this.sub.dispose()
            await this.service.logout()
            AbapDebugAdapterFactory.instance.sessionClosed(this)
        }
        if (notify) this.sendEvent(new TerminatedEvent())
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [new Thread(this.service.THREADID, "Single thread")] }
        this.sendResponse(response)
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.service.debuggerStep("stepInto")
        this.sendResponse(response)
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.service.debuggerStep("stepContinue")
        this.sendResponse(response)
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.service.debuggerStep("stepOver")
        this.sendResponse(response)
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        this.service.debuggerStep("stepReturn")
        this.sendResponse(response)
    }


    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
        await this.logOut()
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        this.service.mainLoop()
        response.success = true
        this.sendResponse(response)
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendResponse(response)
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const stackFrames = this.service.getStack()
        response.body = {
            stackFrames,
            totalFrames: stackFrames.length
        }
        this.sendResponse(response)
    }

    protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
        if (args.source.path) {
            const bps = this.service.getBreakpoints(args.source.path)
            response.body = { breakpoints: bps.map(_ => ({ line: args.line, column: 0 })) }
        } else response.body = { breakpoints: [] }

        this.sendResponse(response)
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        response.body = { scopes: await this.service.getScopes(args.frameId) }
        this.sendResponse(response)
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {
        response.body = { variables: await this.service.getVariables(args.variablesReference) }
        this.sendResponse(response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request) {
        const v = await this.service.evaluate(args.expression)
        if (v) response.body = v
        this.sendResponse(response)
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = {
            supportsBreakpointLocationsRequest: true,
            supportsCancelRequest: true,
            supportsStepInTargetsRequest: true,
            supportsConfigurationDoneRequest: true,
            supportsTerminateRequest: true,
            supportsEvaluateForHovers: true
        }

        this.sendResponse(response)
        this.sendEvent(new InitializedEvent())
    }

}