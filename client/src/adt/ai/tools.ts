import { ExtensionContext } from "vscode"
import { SearchTool } from "./search"
import { UnitTool } from "./unit"
import { ActivateTool } from "./activate"
import { registerToolWithRegistry } from "../../services/lm-tools/toolRegistry"

export const registerChatTools = (context: ExtensionContext) => {
  context.subscriptions.push(registerToolWithRegistry("abap_activate", new ActivateTool()))
  return // duplicates, I guess
  context.subscriptions.push(registerToolWithRegistry("abap_search", new SearchTool()))
  context.subscriptions.push(registerToolWithRegistry("abap_unit", new UnitTool()))
}
