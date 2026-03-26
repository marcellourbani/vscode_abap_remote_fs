import { CancellationToken, DebugConfigurationProvider, WorkspaceFolder } from "vscode"
import { AbapDebugConfiguration } from "./abapDebugSession"
import { log } from "../../lib"

export const DEBUGTYPE = "abap"

export class AbapConfigurationProvider implements DebugConfigurationProvider {
  provideDebugConfigurations(
    folder: WorkspaceFolder | undefined,
    token: CancellationToken
  ): AbapDebugConfiguration[] {
    return [
      {
        name: "Attach to server",
        type: DEBUGTYPE,
        request: "attach",
        connId: "${command:abapfs.pickAdtRootConn}",
        debugUser: "",
        terminalMode: false
      }
    ]
  }
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: AbapDebugConfiguration,
    token?: CancellationToken
  ): AbapDebugConfiguration {
    // config.connId may be the literal "${command:...}" string if VS Code
    // didn't evaluate it (e.g., no launch.json, dynamic config).
    // Treat that as unset and fall through to folder authority or picker.
    const rawConnId = config.connId
    const isCommandPlaceholder = typeof rawConnId === "string" && rawConnId.startsWith("${command:")
    const connId = (!rawConnId || isCommandPlaceholder)
      ? (folder?.uri.authority || "${command:abapfs.pickAdtRootConn}")
      : rawConnId
    log(`resolveDebugConfiguration: config.connId="${rawConnId}", folder.authority="${folder?.uri.authority}", resolved connId="${connId}"`)
    const defaultconf: AbapDebugConfiguration = {
      name: "Attach to server",
      type: DEBUGTYPE,
      request: "attach",
      connId,
      terminalMode: false,
      debugUser: ""
    }
    return { ...defaultconf, ...config, connId }
  }
}
