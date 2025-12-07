import { ExtensionContext, lm } from "vscode"
import { SearchTool } from "./search"
import { UnitTool } from "./unit"

export const registerChatTools = (context: ExtensionContext) => {
  context.subscriptions.push(lm.registerTool("abap_search", new SearchTool()))
  context.subscriptions.push(lm.registerTool("abap_unit", new UnitTool()))
}
