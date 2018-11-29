import { JSON2AbapXML } from "../abap/JSONToAbapXml"
import { parsetoPromise, getNode, recxml2js } from "./AdtParserBase"
import { mapWith, flat } from "../functions"
import { AdtConnection } from "./AdtConnection"
import { window, Uri } from "vscode"

interface TransportHeader {
  TRKORR: string
  TRFUNCTION: string
  TRSTATUS: string
  TARSYSTEM: string
  AS4USER: string
  AS4DATE: string
  AS4TIME: string
  AS4TEXT: string
  CLIENT: string
}
interface TransportInfo {
  PGMID: string
  OBJECT: string
  OBJECTNAME: string
  OPERATION: string
  DEVCLASS: string
  CTEXT: string
  KORRFLAG: string
  AS4USER: string
  PDEVCLASS: string
  DLVUNIT: string
  NAMESPACE: string
  RESULT: string
  RECORDING: string
  EXISTING_REQ_ONLY: string
  TRANSPORTS: TransportHeader[]
}
interface ValidateTransportMessage {
  SEVERITY: string
  SPRSL: string
  ARBGB: string
  MSGNR: string
  TEXT: string
}
function throwMessage(msg: ValidateTransportMessage) {
  throw new Error(`${msg.TEXT} (${msg.SEVERITY}${msg.MSGNR}(${msg.ARBGB}))`)
}
export async function getTransportCandidates(
  objContentUri: Uri,
  devClass: string,
  conn: AdtConnection
): Promise<TransportInfo> {
  const response = await conn.request(
    conn.createUri("/sap/bc/adt/cts/transportchecks"),
    "POST",
    {
      body: JSON2AbapXML({
        DEVCLASS: devClass,
        URI: objContentUri.path
      })
    }
  )
  const rawdata = await parsetoPromise()(response.body)
  const header = getNode(
    "asx:abap/asx:values/DATA",
    mapWith(recxml2js),
    rawdata
  )[0]
  const rawMessages = getNode("asx:abap/asx:values/DATA/MESSAGES", rawdata)
  if (rawMessages && rawMessages[0]) {
    const messages = mapWith(
      getNode("CTS_MESSAGE", recxml2js),
      rawMessages
    ) as ValidateTransportMessage[]
    messages.filter(x => x.SEVERITY === "E").map(throwMessage)
  }
  const RAWTRANSPORTS = getNode("asx:abap/asx:values/DATA/REQUESTS", rawdata)
  const TRANSPORTS =
    RAWTRANSPORTS && RAWTRANSPORTS[0]
      ? getNode(
          "CTS_REQUEST",
          mapWith(getNode("REQ_HEADER")),
          flat,
          mapWith(recxml2js),
          RAWTRANSPORTS
        )
      : []

  return { ...header, TRANSPORTS }
}

export async function selectTransport(
  objContentUri: Uri,
  devClass: string,
  conn: AdtConnection
): Promise<string> {
  const ti = await getTransportCandidates(objContentUri, devClass, conn)
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
    return createTransport(conn, objContentUri, text, ti.DEVCLASS)
  } else return selection.split(" ")[0]
}

async function createTransport(
  conn: AdtConnection,
  objUri: Uri,
  REQUEST_TEXT: string,
  DEVCLASS: string
): Promise<string> {
  const body = JSON2AbapXML({ DEVCLASS, REQUEST_TEXT, REF: objUri.path })
  objUri = objUri.with({ path: "/sap/bc/adt/cts/transports" })
  const response = await conn.request(objUri, "POST", { body })
  const transport = response.body.split("/").pop()
  return transport
}
