import { CancellationToken, DebugConfigurationProvider, ExtensionContext, WorkspaceFolder } from "vscode";

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
}

