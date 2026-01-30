import {
  ClientConfiguration,
  Methods,
  AbapObjectDetail,
  AbapObjectSource,
  StringWrapper,
  UriRequest,
  SearchProgress,
  LogEntry,
  HttpLogEntry
} from "vscode-abap-remote-fs-sharedapi"
import { connection } from "./clientManager"

export async function readConfiguration(key: string) {
  const c = (await connection.sendRequest(Methods.readConfiguration, key)) as
    | ClientConfiguration
    | undefined
  return c
}

export async function getObjectDetails(uri: string) {
  const object = (await connection.sendRequest(Methods.objectDetails, uri)) as
    | AbapObjectDetail
    | undefined
  return object
}

export async function getEditorObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readEditorObjectSource,
    uri
  )) as AbapObjectSource
  return (source && source.source) || ""
}

export async function getObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readObjectSourceOrMain,
    uri
  )) as AbapObjectSource
  return source
}

export async function getVSCodeUri(
  confKey: string,
  uri: string,
  mainInclude: boolean
) {
  const req: UriRequest = { confKey, uri, mainInclude }
  const s = (await connection.sendRequest(Methods.vsUri, req)) as StringWrapper
  return (s && s.s) || ""
}

export async function setSearchProgress(progress: SearchProgress) {
  connection.sendRequest(Methods.setSearchProgress, progress)
}

export async function sendLog(entry: LogEntry) {
  connection.sendRequest(Methods.logCall, entry)
}

export async function sendHttpLog(entry: HttpLogEntry) {
  connection.sendRequest(Methods.logHTTP, entry)
}
