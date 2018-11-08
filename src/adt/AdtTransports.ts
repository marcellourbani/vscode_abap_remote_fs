import { AbapObject } from "../abap/AbapObject"
import { JSON2AbapXML } from "../abap/JSONToAbapXml"
import { parsetoPromise, getNode, recxml2js } from "./AdtParserBase"
import { mapWith, flat } from "../functions"
import { AdtConnection } from "./AdtConnection"
import { window } from "vscode"

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

export async function getTransportCandidates(
  obj: AbapObject,
  conn: AdtConnection
): Promise<TransportInfo> {
  const response = await conn.request(
    conn.createUri("/sap/bc/adt/cts/transportchecks"),
    "POST",
    {
      body: JSON2AbapXML({ URI: obj.getContentsUri(conn).path })
    }
  )
  const rawdata = await parsetoPromise()(response.body)
  const header = getNode(
    "asx:abap/asx:values/DATA",
    mapWith(recxml2js),
    rawdata
  )[0]

  const TRANSPORTS = getNode(
    "asx:abap/asx:values/DATA/REQUESTS/CTS_REQUEST",
    mapWith(getNode("REQ_HEADER")),
    flat,
    mapWith(recxml2js),
    rawdata
  )
  return { ...header, TRANSPORTS }
}

export async function selectTransport(
  obj: AbapObject,
  conn: AdtConnection
): Promise<string> {
  const ti = await getTransportCandidates(obj, conn)
  const CREATENEW = "Create a new transport"
  let selection = await window.showQuickPick([
    CREATENEW,
    ...ti.TRANSPORTS.map(t => `${t.TRKORR} ${t.AS4TEXT}`)
  ])

  if (!selection) return ""
  if (selection === CREATENEW) {
    const text = await window.showInputBox({ prompt: "Request text" })
    if (!text) return ""
    return createTransport(conn, obj, text, ti.DEVCLASS)
  } else return selection.split(" ")[0]
}
async function createTransport(
  conn: AdtConnection,
  obj: AbapObject,
  REQUEST_TEXT: string,
  DEVCLASS: string
): Promise<string> {
  let uri = obj.getContentsUri(conn)
  const body = JSON2AbapXML({ DEVCLASS, REQUEST_TEXT, REF: uri.path })
  uri = uri.with({ path: "/sap/bc/adt/cts/transports" })
  const response = await conn.request(uri, "POST", { body })
  const transport = response.body.split("/").pop()
  return transport
}
