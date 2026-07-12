import {
  ClientConfiguration,
  Methods,
  AbapObjectDetail,
  AbapObjectSource,
  StringWrapper,
  UriRequest,
  SearchProgress
} from "vscode-abap-remote-fs-sharedapi"
import { connection } from "./clientManager"

/**
 * Request the client-side configuration for a given ADT connection key.
 */
export async function readConfiguration(key: string) {
  const c = (await connection.sendRequest(Methods.readConfiguration, key)) as
    | ClientConfiguration
    | undefined
  return c
}

/**
 * Retrieve object metadata for the provided ADT URI from the client extension.
 */
export async function getObjectDetails(uri: string) {
  const object = (await connection.sendRequest(Methods.objectDetails, uri)) as
    | AbapObjectDetail
    | undefined
  return object
}

/**
 * Read the current editor source for the object identified by the given URI.
 */
export async function getEditorObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readEditorObjectSource,
    uri
  )) as AbapObjectSource
  return (source && source.source) || ""
}

/**
 * Read the source for an object, falling back to the main program when needed.
 */
export async function getObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readObjectSourceOrMain,
    uri
  )) as AbapObjectSource
  return source
}

/**
 * Translate an ADT URI into the editor URI that VS Code can open.
 */
export async function getVSCodeUri(confKey: string, uri: string, mainInclude: boolean) {
  const req: UriRequest = { confKey, uri, mainInclude }
  const s = (await connection.sendRequest(Methods.vsUri, req)) as StringWrapper
  return (s && s.s) || ""
}

/**
 * Report progress updates for the current reference search operation.
 */
export async function setSearchProgress(progress: SearchProgress) {
  connection.sendRequest(Methods.setSearchProgress, progress)
}
