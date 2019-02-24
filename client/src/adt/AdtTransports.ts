import { window } from "vscode"
import { ADTClient } from "abap-adt-api"

export interface TransportSelection {
  cancelled: boolean
  transport: string
}
const sel = (
  transport: string,
  cancelled: boolean = false
): TransportSelection => ({
  cancelled,
  transport
})
export async function selectTransport(
  objContentPath: string,
  devClass: string,
  client: ADTClient,
  forCreation: boolean = false
): Promise<TransportSelection> {
  const ti = await client.transportInfo(
    objContentPath,
    devClass,
    forCreation ? "I" : ""
  )
  // if I have a lock return the locking transport
  // will probably be a task but should be fine

  if (ti.LOCKS) return sel(ti.LOCKS.HEADER.TRKORR)

  if (ti.DLVUNIT === "LOCAL") return sel("")
  const CREATENEW = "Create a new transport"
  const selection = await window.showQuickPick([
    CREATENEW,
    ...ti.TRANSPORTS.map(t => `${t.TRKORR} ${t.AS4TEXT}`)
  ])

  if (!selection) return sel("", true)
  if (selection === CREATENEW) {
    const text = await window.showInputBox({ prompt: "Request text" })
    if (!text) return sel("", true)
    return sel(await client.createTransport(objContentPath, text, ti.DEVCLASS))
  } else return sel(selection.split(" ")[0])
}
