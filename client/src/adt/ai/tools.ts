import { ExtensionContext } from "vscode"
import { ActivateTool } from "./activate"
import { registerToolWithRegistry } from "../../services/lm-tools/toolRegistry"

export const registerChatTools = (context: ExtensionContext) => {
  context.subscriptions.push(registerToolWithRegistry("abapfs_activate_object", new ActivateTool()))
}
