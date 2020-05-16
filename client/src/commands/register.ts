import { ExtensionContext, commands } from "vscode"
import { abapcmds } from "."
// import/export to resolve dependencies
export { AdtCommands } from "./commands"
export { IncludeProvider } from "../adt/includes"
export { LanguageCommands } from "../langClient"
export { ClassHierarchyLensProvider } from "../adt/classhierarchy"
export { GitCommands } from "../scm/abapGit/commands"
export { AbapRevisionCommands } from "../scm/abaprevisions/commands"

export const registerCommands = (context: ExtensionContext) => {
  for (const cmd of abapcmds)
    context.subscriptions.push(
      commands.registerCommand(cmd.name, cmd.func.bind(cmd.target))
    )
}
