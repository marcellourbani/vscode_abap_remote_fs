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
  const isContextualInclude = /\/source\/main/i.test(uri)
  const normalizedUri = isContextualInclude
    ? uri.replace(/\/source\/main(?:[?#].*)?$/i, "") || uri
    : uri
  const key = `${confKey} ${normalizedUri} ${main || isContextualInclude}`
  let vsurl = vsurlCache.get(key)
  if (!vsurl && vsurl !== "") {
   // console.log(`vscUrl - requesting for confKey: ${confKey}, uri: ${uri}, main: ${main}`)
    const targetMain = main || isContextualInclude
    vsurl = await getVSCodeUri(confKey, normalizedUri, targetMain)
   // console.log(`vscUrl - getVSCodeUri returned: ${vsurl}`)
    vsurlCache.set(key, vsurl)
  }
  return vsurl
}
