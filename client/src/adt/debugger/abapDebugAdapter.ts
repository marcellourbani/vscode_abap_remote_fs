import { DebugConfiguration, DebugSession } from "vscode";
import { InitializedEvent, LoggingDebugSession } from "vscode-debugadapter";
import { DEBUGTYPE } from "./abapConfigurationProvider";
import { DebugProtocol } from 'vscode-debugprotocol';
import { DebugService } from "./debugService";
import { AbapDebugAdapterFactory } from "./AbapDebugAdapterFactory";

export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {

    constructor(private connId: string, private readonly service: DebugService) {
        super(DEBUGTYPE)
        service.addListener(e => {
            this.sendEvent(e)
        })
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source, breakpoints = [] } = args
        response.body = { breakpoints: await this.service.setBreakpoints(source, breakpoints) }
        this.sendResponse(response)
    }
    protected dispatchRequest(request: DebugProtocol.Request) {
        super.dispatchRequest(request)
    }

    public async logOut() {
        if (this.service) {
            await this.service.logout()
            AbapDebugAdapterFactory.instance.sessionClosed(this)
        }
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
        await this.logOut()
        super.disconnectRequest(response, args, request)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        try {
            this.service.mainLoop()
            response.success = true
        } catch (error) {
            response.message = `Failed to connect debugger for ${this.connId}:${error.message}`
            response.success = false
        }
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