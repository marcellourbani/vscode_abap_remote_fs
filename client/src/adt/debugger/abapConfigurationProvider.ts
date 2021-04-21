import { CancellationToken, DebugConfigurationProvider, WorkspaceFolder } from "vscode";
import { AbapDebugConfiguration } from "./abapDebugSession";

export const DEBUGTYPE = "abap"

export class AbapConfigurationProvider implements DebugConfigurationProvider {
    provideDebugConfigurations(folder: WorkspaceFolder | undefined, token: CancellationToken) {
        return [{
            name: "Attach to server",
            type: DEBUGTYPE,
            request: "attach",
            connId: "${command:abapfs.pickAdtRootConn}"
        }]
    }
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: Partial<AbapDebugConfiguration>, token?: CancellationToken) {
        const connId = folder?.uri.authority || config.connId || "${command:abapfs.pickAdtRootConn}"
        return {
            name: "Attach to server",
            type: DEBUGTYPE,
            request: "attach",
            connId
        }
    }
}

