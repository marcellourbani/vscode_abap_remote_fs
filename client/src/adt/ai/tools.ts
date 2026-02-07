import { ExtensionContext, lm } from "vscode"
import { SearchTool } from "./search"
import { UnitTool } from "./unit"
import { ActivateTool } from "./activate"

export const registerChatTools = (context: ExtensionContext) => {
  return // duplicates, I guess
  context.subscriptions.push(lm.registerTool("abap_search", new SearchTool()))
  context.subscriptions.push(lm.registerTool("abap_unit", new UnitTool()))
  context.subscriptions.push(lm.registerTool("abap_activate", new ActivateTool()))
}
