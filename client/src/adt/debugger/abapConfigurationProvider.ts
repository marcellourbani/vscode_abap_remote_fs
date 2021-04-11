import { CancellationToken, DebugConfigurationProvider, ExtensionContext, WorkspaceFolder } from "vscode";

export const DEBUGTYPE = "abap"

export class AbapConfigurationProvider implements DebugConfigurationProvider {
    provideDebugConfigurations(folder: WorkspaceFolder, token: CancellationToken) {
        return [{
            name: "Attach to server",
            type: DEBUGTYPE,
            request: "attach"
        }]
    }
}

