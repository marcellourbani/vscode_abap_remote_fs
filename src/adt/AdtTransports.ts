import { window } from "vscode"
import { ADTClient } from "abap-adt-api"

export async function selectTransport(
  objContentPath: string,
  devClass: string,
  client: ADTClient
): Promise<string> {
  const ti = await client.transportInfo(objContentPath, devClass)
  // if I have a lock return the locking transport
  // will probably be a task but should be fine

  if (ti.LOCKS) return ti.LOCKS.HEADER.TRKORR

  if (ti.DLVUNIT === "LOCAL") return ""
  const CREATENEW = "Create a new transport"
  const selection = await window.showQuickPick([
    CREATENEW,
    ...ti.TRANSPORTS.map(t => `${t.TRKORR} ${t.AS4TEXT}`)
  ])

  if (!selection) return ""
  if (selection === CREATENEW) {
    const text = await window.showInputBox({ prompt: "Request text" })
    if (!text) return ""
    return await client.createTransport(objContentPath, text, ti.DEVCLASS)
  } else return selection.split(" ")[0]
}
