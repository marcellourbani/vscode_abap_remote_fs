import { window, ProgressLocation, CancellationToken, Uri } from "vscode"
import { ADTClient, TransportInfo } from "abap-adt-api"
import { fieldOrder, withp } from "../lib"
import { TransportValidator } from "../api"
import { uriRoot, getClient } from "./conections"
import { isAbapStat, isAbapFolder } from "abapfs"

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

export enum TransportStatus {
  UNKNOWN,
  REQUIRED,
  LOCAL
}

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
  } else return trSel(selection.split(" ")[0] || "")
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

const failedMsg = (token?: CancellationToken) => {
  if (!token?.isCancellationRequested)
    window.showInformationMessage(
      `Operation cancelled due to failed transport validation`
    )
}
const ACCEPT = "Accept"
const CANCEL = "Cancel"
const CONTINUE = "Continue"

const onFailed = async (transport: string) =>
  window.showInformationMessage(`Validation failed`, ACCEPT, CANCEL, CONTINUE)

const onSkipped = async (transport: string) =>
  window.showInformationMessage(`Accept transport?`, ACCEPT, CANCEL).then(r => r === ACCEPT ? trSel(transport) : trSel("", true))

const validate = async (
  transport: string,
  type: string,
  name: string,
  devClass: string
) => {
  if (transportValidators.length > 0)
    return await withp(
      `validating transport ${transport}`,
      async (_, token) => {
        for (const validator of transportValidators) {
          if (token?.isCancellationRequested) return trSel("", true)

          try {
            const outcome = await validator(
              transport,
              type,
              name,
              devClass,
              token
            )
            if (!outcome) {
              if (token?.isCancellationRequested) return onSkipped(transport)
              failedMsg(token)
              return trSel("", true)
            }
          } catch (error) {
            switch (await onFailed(transport)) {
              case ACCEPT:
                return trSel(transport)
              case CANCEL:
                return trSel("", true)
            }
          }
        }
        return trSel(transport)
      },
      ProgressLocation.Notification
    )
  else return trSel(transport)
}

export const transportValidators: TransportValidator[] = []

interface TransportRequired {
  status: TransportStatus.REQUIRED
  transport: string
}

interface TransportSimple {
  status: TransportStatus.LOCAL | TransportStatus.UNKNOWN
}

type TransportDetail = TransportRequired | TransportSimple

const transportStatus = (uri: Uri): TransportDetail => {
  const root = uriRoot(uri)
  const file = root.getNode(uri.path)
  if (!isAbapStat(file)) return { status: TransportStatus.UNKNOWN }
  const status = root.lockManager.lockStatus(uri.path)
  if (status.status === "locked") {
    if (status.IS_LOCAL) return { status: TransportStatus.LOCAL }
    return { status: TransportStatus.REQUIRED, transport: status.CORRNR || "" }
  }
  return { status: TransportStatus.UNKNOWN } // TODO different status?
}

export const selectTransportIfNeeded = async (uri: Uri) => {
  const root = uriRoot(uri)
  const file = root.getNode(uri.path)
  if (!isAbapStat(file)) return trSel("")

  const status = transportStatus(uri)
  switch (status.status) {
    case TransportStatus.LOCAL:
      return trSel("")
    case TransportStatus.REQUIRED:
      const { transport } = status
      const path = isAbapFolder(file)
        ? file.object.path
        : file.object.contentsPath()
      const client = getClient(uri.authority)
      const trsel = await selectTransport(path, "", client, false, transport)
      if (trsel.cancelled) throw new Error("Transport required")
      return trsel

    case TransportStatus.UNKNOWN:
      throw new Error("Unknown transport status. Object not locked?")
  }
}
