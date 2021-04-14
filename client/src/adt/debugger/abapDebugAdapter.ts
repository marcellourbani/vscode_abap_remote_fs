import { DebugConfiguration, DebugSession, Uri } from "vscode";
import { InitializedEvent, LoggingDebugSession } from "vscode-debugadapter";
import { DEBUGTYPE } from "./abapConfigurationProvider";
import { DebugProtocol } from 'vscode-debugprotocol';
import { getClient, getRoot } from "../conections";
import { DebugAttach, Debuggee, isDebugListenerError, session_types } from "abap-adt-api";
import { log, after } from "../../lib";
import { isAbapFile } from "abapfs";
export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {
    private connId: string;
    private active: boolean = false;
    private ideId: string;
    private terminalId: string;
    private username: string

    constructor({ configuration: { connId } }: AbapDebugSessionCfg) {
        super(DEBUGTYPE)
        this.connId = connId
        const client = getClient(this.connId)
        this.terminalId = "71999B60AA6349CF91D0A23773B3C728"
        this.ideId = "796B6D15B9A1BEC388DA0C50010D2F62"
        this.username = client.username.toUpperCase()
    }

    private async mainLoop() {
        this.active = true
        const client = getClient(this.connId)
        const sc = getClient(this.connId, false)
        sc.stateful = session_types.stateful
        sc.adtCoreDiscovery()
        const foo = async (debuggee: Debuggee) => {
            try {
                // await after(130)
                const attach = await sc.debuggerAttach("user", debuggee.DEBUGGEE_ID, this.username, true)
                const bp = attach.reachedBreakpoints[0]
                log(JSON.stringify(bp))
                const stack = await sc.debuggerStackTrace()
                log(JSON.stringify(stack))
                const variables = await sc.debuggerVariables(["SY-SUBRC", "SY"])
                log(JSON.stringify(variables))
                const cvariables = await sc.debuggerChildVariables()
                log(JSON.stringify(cvariables))
                await sc.debuggerStep("stepContinue")
                sc.stateful = session_types.stateless
            } catch (error) {
                log(`${error}`)
                sc.stateful = session_types.stateless
            }
            sc.adtCoreDiscovery()
        }
        while (this.active) {
            try {
                const debuggee = await client.debuggerListen("user", this.terminalId, this.ideId, this.username)
                if (!debuggee) continue
                if (isDebugListenerError(debuggee)) {
                    // reconnect
                    break
                }
                await foo(debuggee)
            } catch (error) {
                log(`${error}`)
            }
        }
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source: { path = "" }, breakpoints = [] } = args
        const client = getClient(this.connId)
        const root = getRoot(this.connId)
        if (path) {
            const uri = Uri.parse(path)
            const node = await root.getNodeAsync(uri.path)
            if (isAbapFile(node)) {
                const objuri = node.object.contentsPath()
                const clientId = `24:${this.connId}${uri.path}` // `582:/A4H_001_developer_en/.adt/programs/programs/ztest/ztest.asprog`
                const bps = breakpoints.map(b => `${objuri}#start=${b.line}`)
                const actualbps = await client.debuggerSetBreakpoints("user", this.terminalId, this.ideId, clientId, bps, this.username)
                log(JSON.stringify(actualbps))
            }
        }
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        response.success = true
        this.mainLoop()
        this.sendResponse(response)
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        response.body.supportsBreakpointLocationsRequest = true
        response.body.supportsCancelRequest = true
        response.body.supportsStepInTargetsRequest = true
        response.body.supportsConfigurationDoneRequest = true
        this.sendResponse(response)
        this.sendEvent(new InitializedEvent());
    }

}