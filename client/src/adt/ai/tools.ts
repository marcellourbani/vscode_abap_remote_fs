
import { ExtensionContext, lm } from "vscode"
import { SearchTool } from "./search"

export const registerChatTools = (context: ExtensionContext) =>
    context.subscriptions.push(lm.registerTool('abap_search', new SearchTool()))
