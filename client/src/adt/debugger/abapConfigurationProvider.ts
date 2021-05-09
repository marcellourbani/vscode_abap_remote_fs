import { CancellationToken, DebugConfigurationProvider, WorkspaceFolder } from "vscode";
import { AbapDebugConfiguration } from "./abapDebugSession";

export const DEBUGTYPE = "abap"

export class AbapConfigurationProvider implements DebugConfigurationProvider {
    provideDebugConfigurations(folder: WorkspaceFolder | undefined, token: CancellationToken): AbapDebugConfiguration[] {
        return [{
            name: "Attach to server",
            type: DEBUGTYPE,
            request: "attach",
            connId: "${command:abapfs.pickAdtRootConn}",
            debugUser: "",
            terminalMode: false
        }]
    }
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: AbapDebugConfiguration, token?: CancellationToken): AbapDebugConfiguration {
        const connId = config.connId || folder?.uri.authority || "${command:abapfs.pickAdtRootConn}"
        const defaultconf: AbapDebugConfiguration = {
            name: "Attach to server",
            type: DEBUGTYPE,
            request: "attach",
            connId,
            terminalMode: false,
            debugUser: ""
        }
        return { ...defaultconf, ...config }
    }
}

