import { funWindow as window } from "../services/funMessenger"
import { pickAdtRoot } from "../config"
import { getOrCreateClient } from "../adt/conections"
import { rapGenPublishService } from "../adt/rapGenerator"
import { caughtToString } from "../lib"

export async function publishServiceBindingCommand() {
  try {
    // Pick system (auto-skips if only one connected)
    const root = await pickAdtRoot()
    if (!root) return
    const connId = root.uri.authority

    // Ask for service binding name
    const name = await window.showInputBox({
      prompt: "Enter the service binding name to publish",
      placeHolder: "e.g. ZUI_MY_SERVICE_O4",
      ignoreFocusOut: true,
      validateInput: v => v?.trim() ? null : "Service binding name is required"
    })
    if (!name) return

    const srvbName = name.trim().toUpperCase()

    await window.withProgress(
      { location: { viewId: "workbench.panel.output" }, title: `Publishing ${srvbName}...` },
      async () => {
        const client = await getOrCreateClient(connId)
        const result = await rapGenPublishService(client, srvbName)
        if (result.severity === "error") {
          const msg = result.longText
            ? `${result.shortText}\n\n${result.longText}`
            : (result.shortText || "Publish failed")
          window.showErrorMessage(msg)
        } else {
          window.showInformationMessage(`Service binding ${srvbName} published successfully`)
        }
      }
    )
  } catch (e: any) {
    window.showErrorMessage(`Publish failed: ${caughtToString(e)}`)
  }
}
