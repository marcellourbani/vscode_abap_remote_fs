import * as vscode from "vscode"
import { setContext } from "../../context"
import { availableEngines, readEnvironment } from "./backend"
import { openIntroPanel } from "./introPanel"
import { enginePresentation } from "./presentation"
import { openPlayground } from "./systemOnePlayground"

/**
 * Registers a command per decision engine and publishes which ones are configured.
 *
 * The environment is read once, because the extension host receives its environment at
 * startup and a variable set afterwards does not reach the running process.
 */
export function registerDecisionModels(context: vscode.ExtensionContext): void {
  const configured = availableEngines(readEnvironment())
  setContext("abapfs:jevAvailable", configured.includes("jev"))
  setContext("abapfs:layaAvailable", configured.includes("laya"))

  context.subscriptions.push(
    vscode.commands.registerCommand(enginePresentation("jev").commandId, () =>
      openPlayground("jev")
    ),
    vscode.commands.registerCommand(enginePresentation("laya").commandId, () =>
      openPlayground("laya")
    ),
    vscode.commands.registerCommand("abapfs.decisionModels", () => openIntroPanel())
  )
}
