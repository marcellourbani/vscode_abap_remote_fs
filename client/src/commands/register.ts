import { type ExtensionContext, commands } from "vscode"
import { funWindow as window } from "../services/funMessenger"
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
    context.subscriptions.push(commands.registerCommand(cmd.name, cmd.func.bind(cmd.target)))

  // 🎯 Register Enhancement Commands
  try {
    const { showEnhancementSource } = require("../views/enhancementDecorations")
    context.subscriptions.push(
      commands.registerCommand("abapfs.showEnhancementSource", showEnhancementSource)
    )
  } catch (error) {
    console.warn("⚠️ Failed to register enhancement commands:", error)
  }

  // 🔄 Register SAP System Validator Commands
  try {
    const { SapSystemValidator } = require("../services/sapSystemValidator")
    const validator = SapSystemValidator.getInstance()

    context.subscriptions.push(
      commands.registerCommand("abapfs.retryWhitelist", () => validator.forceRetryWhitelist())
    )

    context.subscriptions.push(
      commands.registerCommand("abapfs.showVpnHelp", () => validator.showVpnHelp())
    )

    context.subscriptions.push(
      commands.registerCommand("abapfs.refreshWhitelist", async () => {
        try {
          await validator.refreshWhitelist()
          window.showInformationMessage("✅ SAP system whitelist refreshed successfully!")
        } catch (error) {
          window.showErrorMessage(`❌ Failed to refresh whitelist: ${error}`)
        }
      })
    )
  } catch (error) {
    console.warn("⚠️ Failed to register SAP validator commands:", error)
  }

  // 📊 Register Compare With Other System Command
  try {
    const { registerCompareWithSystemCommand } = require("./compareWithSystem")
    registerCompareWithSystemCommand(context)
  } catch (error) {
    console.warn("⚠️ Failed to register compare command:", error)
  }
}
