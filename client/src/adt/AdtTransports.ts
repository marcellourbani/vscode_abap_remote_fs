import { window } from "vscode"
import { ADTClient } from "abap-adt-api"
import { fieldOrder } from "../lib"
import { TransportStatus } from "./abap/AbapObject"

export interface TransportSelection {
  cancelled: boolean
  transport: string
}
export const trSel = (
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
  forCreation: boolean = false,
  current: string | TransportStatus = "",
  transportLayer = ""
): Promise<TransportSelection> {
  const ti = await client.transportInfo(
    objContentPath,
    devClass,
    forCreation ? "I" : ""
  )
  // if I have a lock return the locking transport
  // will probably be a task but should be fine

  if (ti.LOCKS) return trSel(ti.LOCKS.HEADER.TRKORR)

  // if one of the proposals matches the requested, return that
  const curtr = current && ti.TRANSPORTS.find(t => t.TRKORR === current)
  if (curtr) return trSel(curtr.TRKORR)
  // if local, return an empty value
  if (ti.DLVUNIT === "LOCAL") return trSel("")

  // select/create
  const CREATENEW = "Create a new transport"
  const selection = await window.showQuickPick(
    [
      CREATENEW,
      ...ti.TRANSPORTS.sort(fieldOrder("TRKORR", true)).map(
        t => `${t.TRKORR} ${t.AS4TEXT}`
      )
    ],
    { ignoreFocusOut: true }
  )

  if (!selection) return trSel("", true)
  if (selection === CREATENEW) {
    const text = await window.showInputBox({
      prompt: "Request text",
      ignoreFocusOut: true
    })
    if (!text) return trSel("", true)
    return trSel(
      await client.createTransport(
        objContentPath,
        text,
        ti.DEVCLASS,
        transportLayer
      )
    )
  } else return trSel(selection.split(" ")[0])
}
