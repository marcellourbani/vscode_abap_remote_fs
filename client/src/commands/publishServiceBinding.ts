import { funWindow as window } from "../services/funMessenger"
import { pickAdtRoot } from "../config"
import { getOrCreateClient, uriRoot } from "../adt/conections"
import { rapGenPublishService } from "../adt/rapGenerator"
import { caughtToString } from "../lib"
import { isAbapStat } from "abapfs"

export async function publishServiceBindingCommand() {
  try {
    // Try to detect service binding from active editor
    const editor = window.activeTextEditor
    let defaultName = ""
    let connId = ""

    if (editor?.document.uri.scheme === "adt") {
      const uri = editor.document.uri
      connId = uri.authority
      try {
        const root = uriRoot(uri)
        const file = root.getNode(uri.path)
        if (isAbapStat(file) && file.object.type === "SRVB/SVB") {
          defaultName = file.object.name
        }
      } catch {
        // ignore
      }
    }

    if (!connId) {
      const root = await pickAdtRoot()
      if (!root) return
      connId = root.uri.authority
    }

    // Ask for service binding name (pre-filled if detected)
    const name = defaultName || await window.showInputBox({
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
