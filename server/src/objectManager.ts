import {
  AbapObjectDetail,
  objectIsValid,
  MainProgram
} from "vscode-abap-remote-fs-sharedapi"
import { getObjectDetails, getVSCodeUri } from "./clientapis"
import { syntaxCheck } from "./syntaxcheck"
import { documents } from "./server"

const cache: Map<string, AbapObjectDetail> = new Map()
const vsurlCache: Map<string, string> = new Map()

export function updateInclude(prog: MainProgram) {
  const c = cache.get(prog.includeUri)
  if (c && c.mainProgram !== prog.mainProgramUri) {
    c.mainProgram = prog.mainProgramUri
    const doc = documents.get(prog.includeUri)
    if (doc) syntaxCheck(doc)
  }
}

export async function getObject(uri: string) {
  let object: AbapObjectDetail | undefined = cache.get(uri)
  if (!object) {
    object = await getObjectDetails(uri)
    if (object && objectIsValid(object)) cache.set(uri, object)
  }

  return object
}

export async function vscUrl(
  confKey: string,
  uri: string,
  main: boolean = true
) {
  const key = `${confKey} ${uri} ${main}`
  let vsurl = vsurlCache.get(key)
  if (!vsurl && vsurl !== "") {
    vsurl = await getVSCodeUri(confKey, uri, main)
    vsurlCache.set(key, vsurl)
  }
  return vsurl
}
