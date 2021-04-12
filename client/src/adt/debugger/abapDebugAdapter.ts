import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, DebugConfiguration, DebugSession, Uri } from "vscode";
import { InitializedEvent, LoggingDebugSession } from "vscode-debugadapter";
import { DEBUGTYPE } from "./abapConfigurationProvider";
import { DebugProtocol } from 'vscode-debugprotocol';

export interface AbapDebugConfiguration extends DebugConfiguration {
    connId: string
}
export interface AbapDebugSessionCfg extends DebugSession {
    configuration: AbapDebugConfiguration
}

export class AbapDebugSession extends LoggingDebugSession {
    private connId: string;

    constructor({ configuration: { connId } }: AbapDebugSessionCfg) {
        super(DEBUGTYPE)
        this.connId = connId
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        const { source: { path = "" }, breakpoints = [] } = args
        if (path) {
            const uri = Uri.parse(path)
        }
        this.sendResponse(response)
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        response.success = true
        this.sendResponse(response)
    }
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        response.body.supportsBreakpointLocationsRequest = true
        this.sendResponse(response)
        this.sendEvent(new InitializedEvent());
    }

}