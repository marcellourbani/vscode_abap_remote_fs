import { isAbapFile, isAbapFolder } from "abapfs"
import { getClient, getOrCreateRoot } from "../adt/conections"
import { resolveAbapResource } from "./abapResourceDownloadService"
import type { ObjectTransportCheckStatus } from "./repositoryWorkflow/types"

export type { ObjectTransportCheckStatus } from "./repositoryWorkflow/types"

const NO_TRANSPORT_REQUEST_MESSAGE = "No existing request can be used for change recording"

export interface ObjectTransportStatus {
  connectionId: string
  source: string
  workspaceUri: string
  objectPath: string
  status: Exclude<ObjectTransportCheckStatus, "not-checked" | "error">
  transportRequest: string
  transportDescription: string
  checkedAt: string
  transportCheckError?: string
}

export interface ObjectTransportStatusInput {
  connectionId: string
  source: string
  objectType?: string
  packageName?: string
}

export async function getAbapObjectTransportStatus(
  input: ObjectTransportStatusInput
): Promise<ObjectTransportStatus> {
  const connectionId = input.connectionId.trim().toLowerCase()
  if (!connectionId) throw new Error("connectionId is required")
  if (!input.source.trim()) throw new Error("source is required")
  const uri = await resolveAbapResource({
    connectionId,
    source: input.source,
    objectType: input.objectType
  })
  if (uri.scheme !== "adt")
    throw new Error("Transport status is available only for SAP ADT objects")
  const root = await getOrCreateRoot(connectionId)
  const node = await root.getNodeAsync(uri.path)
  if (!isAbapFile(node) && !isAbapFolder(node))
    throw new Error(`Cannot resolve an ABAP object for ${input.source}`)
  const objectPath = isAbapFolder(node) ? node.object.path : node.object.contentsPath()
  let info
  try {
    info = await getClient(connectionId).transportInfo(objectPath, input.packageName ?? "", "")
  } catch (error) {
    if (!isNoTransportRequestError(error)) throw error
    return {
      connectionId,
      source: input.source,
      workspaceUri: uri.toString(),
      objectPath,
      status: "no-transport",
      transportRequest: "",
      transportDescription: "No transport request available",
      checkedAt: new Date().toISOString(),
      transportCheckError: error instanceof Error ? error.message : String(error)
    }
  }
  const transportRequest = info.LOCKS?.HEADER?.TRKORR ?? ""
  const transportDescription =
    info.LOCKS?.HEADER?.AS4TEXT ??
    info.TRANSPORTS?.find(transport => transport.TRKORR === transportRequest)?.AS4TEXT ??
    ""
  return {
    connectionId,
    source: input.source,
    workspaceUri: uri.toString(),
    objectPath,
    status: transportRequest ? "locked" : info.DLVUNIT === "LOCAL" ? "local" : "not-locked",
    transportRequest,
    transportDescription,
    checkedAt: new Date().toISOString()
  }
}

function isNoTransportRequestError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NO_TRANSPORT_REQUEST_MESSAGE)
}
