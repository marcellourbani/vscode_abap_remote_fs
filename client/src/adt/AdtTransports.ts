import { window, ProgressLocation, CancellationToken } from "vscode"
import { ADTClient, TransportInfo } from "abap-adt-api"
import { fieldOrder, withp } from "../lib"
import { TransportStatus } from "./abap/AbapObject"
import { TransportValidator } from "../api"
import { CancellationTokenSource } from "vscode-languageclient"

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

async function selectOrCreate(
  tranInfo: TransportInfo,
  objContentPath: string,
  client: ADTClient,
  transportLayer = ""
) {
  // select/create
  const CREATENEW = "Create a new transport"
  const selection = await window.showQuickPick(
    [
      CREATENEW,
      ...tranInfo.TRANSPORTS.sort(fieldOrder("TRKORR", true)).map(
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
        tranInfo.DEVCLASS,
        transportLayer
      )
    )
  } else return trSel(selection.split(" ")[0])
}

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

  let selection = await selectOrCreate(
    ti,
    objContentPath,
    client,
    transportLayer
  )
  if (!selection.cancelled)
    selection = await validate(
      selection.transport,
      ti.OBJECT,
      ti.OBJECTNAME,
      devClass
    )
  return selection
}

const validate = async (
  transport: string,
  type: string,
  name: string,
  devClass: string
) => {
  if (transportValidators.length > 0)
    return await withp(
      "validating",
      async (_, token) => {
        for (const validator of transportValidators) {
          if (token?.isCancellationRequested) return trSel("", true)

          if (!(await validator(transport, type, name, devClass, token))) {
            if (!token?.isCancellationRequested)
              window.showInformationMessage(
                `Operation cancelled due to failed transport validation`
              )
            return trSel("", true)
          }
        }
        return trSel(transport)
      },
      ProgressLocation.Notification
    )
  else return trSel(transport)
}

export const transportValidators: TransportValidator[] = []
