import { DebugConfiguration, DebugSession, Uri } from "vscode";
import { InitializedEvent, LoggingDebugSession } from "vscode-debugadapter";
import { DEBUGTYPE } from "./abapConfigurationProvider";
import { DebugProtocol } from 'vscode-debugprotocol';
import { getClient, getRoot } from "../conections";
import { log } from "../../lib";
import { isAbapFile } from "abapfs";
import { DebugService } from "./debugService";

export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {
    private connId: string;
    service?: DebugService;

    constructor({ configuration: { connId } }: AbapDebugSessionCfg) {
        super(DEBUGTYPE)
        this.connId = connId
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source: { path = "" }, breakpoints = [] } = args
        if (path && this.service) {
            response.body = { breakpoints: await this.service.setBreakpoints(path, breakpoints) }
        }
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        try {
            this.service = await DebugService.create(this.connId)
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