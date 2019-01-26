import { window, Uri } from "vscode"
import { ADTClient } from "abap-adt-api"

export async function selectTransport(
  objContentUri: Uri,
  devClass: string,
  client: ADTClient
): Promise<string> {
  const ti = await client.transportInfo(objContentUri.path, devClass)
  //if I have a lock return the locking transport
  // will probably be a task but should be fine

  if (ti.LOCKS) return ti.LOCKS.HEADER.TRKORR

  if (ti.DLVUNIT === "LOCAL") return ""
  const CREATENEW = "Create a new transport"
  let selection = await window.showQuickPick([
    CREATENEW,
    ...ti.TRANSPORTS.map(t => `${t.TRKORR} ${t.AS4TEXT}`)
  ])

  if (!selection) return ""
  if (selection === CREATENEW) {
    const text = await window.showInputBox({ prompt: "Request text" })
    if (!text) return ""
    return await client.createTransport(objContentUri.path, text, ti.DEVCLASS)
  } else return selection.split(" ")[0]
}
